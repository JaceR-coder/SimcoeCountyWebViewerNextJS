"use client";

/**
 * "LHRS Range" scope - resolve Point A and Point B on the same highway and use the highway section
 * between them as the report scope. Ported from the legacy ReportLhrsScope.jsx, but backed by this
 * app's own /api/public/lhrs routes (Phase 4 - see tools/LHRS/lhrsApi.ts) instead of the Node WebApi.
 */

import React, { useEffect, useRef, useState } from "react";
import { transform } from "ol/proj";
import { unByKey } from "ol/Observable";
import { Vector as VectorLayer } from "ol/layer";
import { Vector as VectorSource } from "ol/source";
import { Icon, Stroke, Style, Text, Fill } from "ol/style";
import { GeoJSON } from "ol/format";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import type { EventsKey } from "ol/events";
import { useMapStore } from "@/stores/mapStore";
import { LayerManager } from "@/utils/openlayers/LayerManager";
import { getPublicPath } from "@/utils/getPublicPath";
import { showMessage } from "@/utils/helpersUI";
import { type LHRSPointResult, type LHRSVersion, resolveApiUrl, getVersions, byXYMulti, byMDistance, byBasepoint, linearByMDistance, dedupeByHwy } from "@/components/tools/LHRS/lhrsApi";
import lhrsConfig from "@/components/tools/LHRS/config.json";
import { PredicatePicker } from "./ReportControls";
import type { SpatialPredicate } from "./payload";

type PointId = "A" | "B";
type EntryMode = "map" | "hwy" | "basepoint" | "latlong";

const ENTRY_MODES: { value: EntryMode; label: string }[] = [
  { value: "map", label: "Select on Map" },
  { value: "hwy", label: "Enter Hwy + Distance" },
  { value: "basepoint", label: "Enter Basepoint + Offset" },
  { value: "latlong", label: "Enter Lat/Long" },
];

const INPUT_LABELS: Record<Exclude<EntryMode, "map">, [string, string]> = {
  hwy: ["Hwy", "Distance (km)"],
  basepoint: ["Basepoint", "Offset (km)"],
  latlong: ["Lat", "Long"],
};

const geojson = new GeoJSON();
const marker = (file: string) => new Style({ image: new Icon({ anchor: [0.5, 1], src: getPublicPath(`/images/lhrs/${file}`) }) });
const sectionStyle = (label: string) =>
  new Style({
    stroke: new Stroke({ color: [0, 255, 255, 0.8], width: 6 }),
    text: label ? new Text({ text: label, font: "bold 14px sans-serif", placement: "line", fill: new Fill({ color: "#000" }), stroke: new Stroke({ color: "#fff", width: 3 }) }) : undefined,
  });

interface PointState {
  mode: EntryMode;
  inputs: [string, string];
  resolved?: LHRSPointResult;
  choices?: LHRSPointResult[];
  resolving: boolean;
}

const emptyPoint = (): PointState => ({ mode: "map", inputs: ["", ""], resolving: false });

export default function LhrsRangeScope(props: {
  rangeGeoJSON?: object;
  predicate: SpatialPredicate;
  distance: string;
  onPredicateChange: (p: SpatialPredicate) => void;
  onDistanceChange: (d: string) => void;
  onRangeChange: (geojson4326: object | undefined) => void;
}) {
  const map = useMapStore((s) => s.map);
  const setActiveToolId = useMapStore((s) => s.setActiveToolId);
  const apiUrl = resolveApiUrl(lhrsConfig.apiUrl);

  const [versions, setVersions] = useState<LHRSVersion[]>([]);
  const [version, setVersion] = useState("");
  const [snapping, setSnapping] = useState(String(lhrsConfig.defaultSnappingDistance));
  const [points, setPoints] = useState<Record<PointId, PointState>>({ A: emptyPoint(), B: emptyPoint() });
  const [mapTarget, setMapTarget] = useState<PointId>("A");
  const [sectionKm, setSectionKm] = useState<number | undefined>();

  const layersRef = useRef<Record<PointId | "section", VectorLayer<VectorSource>> | null>(null);
  const stateRef = useRef({ points, version, snapping, mapTarget });
  stateRef.current = { points, version, snapping, mapTarget };
  const onRangeChangeRef = useRef(props.onRangeChange);
  onRangeChangeRef.current = props.onRangeChange;

  const snap = () => {
    const n = parseInt(stateRef.current.snapping, 10);
    return Number.isFinite(n) && n > 0 ? n : lhrsConfig.defaultSnappingDistance;
  };

  const patchPoint = (id: PointId, patch: Partial<PointState>) => setPoints((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  const setMarker = (id: PointId, lat?: number, long?: number) => {
    const source = layersRef.current?.[id].getSource();
    source?.clear();
    if (lat !== undefined && long !== undefined) source?.addFeature(new Feature({ geometry: new Point(transform([long, lat], "EPSG:4326", "EPSG:3857")) }));
  };

  const drawSection = (geom3857?: string, label = "") => {
    const source = layersRef.current?.section.getSource();
    source?.clear();
    if (!geom3857 || !source) return undefined;
    const geometry = geojson.readGeometry(geom3857);
    const feature = new Feature({ geometry });
    feature.setStyle(sectionStyle(label));
    source.addFeature(feature);
    return geometry;
  };

  // Re-resolve the section whenever both points are known
  const updateRange = async (next: Record<PointId, PointState>) => {
    const a = next.A.resolved;
    const b = next.B.resolved;
    if (!a || !b || a.hwy !== b.hwy) {
      drawSection();
      setSectionKm(undefined);
      onRangeChangeRef.current(undefined);
      return;
    }
    try {
      const result = await linearByMDistance(apiUrl, { version: stateRef.current.version, snappingDistance: snap(), hwy: a.hwy, fromDistance: a.m_distance, toDistance: b.m_distance });
      if (!result?.geom || !(result.section_length > 0)) {
        drawSection();
        setSectionKm(undefined);
        onRangeChangeRef.current(undefined);
        return;
      }
      const geometry = drawSection(result.geom, `${result.section_length.toFixed(3)} km`);
      setSectionKm(result.section_length);
      if (geometry) {
        onRangeChangeRef.current(geojson.writeGeometryObject(geometry, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }));
        map?.getView().fit(geometry.getExtent(), { padding: [80, 80, 80, 80], duration: 600, maxZoom: 16 });
      }
    } catch (err) {
      showMessage("LHRS", (err as Error).message, "error", 3000);
    }
  };

  const applyResolved = (id: PointId, resolved?: LHRSPointResult, choices?: LHRSPointResult[]) => {
    const next = { ...stateRef.current.points, [id]: { ...stateRef.current.points[id], resolved, choices, resolving: false } };
    setPoints(next);
    if (resolved) setMarker(id, resolved.latitude_in, resolved.longitude_in);
    else if (!choices) setMarker(id);
    if (id === "A" && resolved && next.B.mode === "map") setMapTarget("B");
    updateRange(next);
  };

  const resolveLatLong = async (id: PointId, lat: number, long: number) => {
    if (!stateRef.current.version) return;
    patchPoint(id, { resolving: true });
    try {
      const rows = dedupeByHwy(await byXYMulti(apiUrl, { version: stateRef.current.version, snappingDistance: snap(), lat, long }));
      if (rows.length === 1) applyResolved(id, rows[0]);
      else if (rows.length > 1) {
        applyResolved(id, undefined, rows);
        setMarker(id, lat, long);
        showMessage("Multiple Highways Found", "This location is near more than one highway - choose the correct one.", "warning", 4000);
      } else {
        applyResolved(id, undefined);
        showMessage("Not Found", "Location is outside the snapping threshold. Pick a location closer to a highway or increase it.", "warning", 4000);
      }
    } catch (err) {
      patchPoint(id, { resolving: false });
      showMessage("LHRS", (err as Error).message, "error", 3000);
    }
  };

  const resolveEntry = async (id: PointId) => {
    const p = stateRef.current.points[id];
    const [first, second] = p.inputs.map((v) => v.trim());
    const n2 = parseFloat(second);
    if (p.mode === "latlong") {
      const n1 = parseFloat(first);
      if (!Number.isNaN(n1) && !Number.isNaN(n2)) resolveLatLong(id, n1, n2);
      return;
    }
    if (!first || Number.isNaN(n2) || !stateRef.current.version) return;
    patchPoint(id, { resolving: true });
    try {
      const req = { version: stateRef.current.version, snappingDistance: snap() };
      const result = p.mode === "hwy" ? await byMDistance(apiUrl, { ...req, hwy: first, distance: n2 }) : await byBasepoint(apiUrl, { ...req, basepoint: parseFloat(first), offset: n2 });
      if (!result) showMessage("Not Found", "No LHRS data found.", "warning", 3000);
      applyResolved(id, result ?? undefined);
    } catch (err) {
      patchPoint(id, { resolving: false });
      showMessage("LHRS", (err as Error).message, "error", 3000);
    }
  };

  const resolveLatLongRef = useRef(resolveLatLong);
  resolveLatLongRef.current = resolveLatLong;

  useEffect(() => {
    getVersions(apiUrl)
      .then((rows) => {
        setVersions(rows);
        setVersion((rows.find((r) => r.current) ?? rows[0])?.lhrs_version ?? "");
      })
      .catch((err) => showMessage("LHRS", `Could not load LHRS versions: ${(err as Error).message}`, "error", 4000));
  }, [apiUrl]);

  useEffect(() => {
    if (!map) return;
    const mk = (style: Style, z: number) => new VectorLayer({ source: new VectorSource(), style, zIndex: z });
    const layers = { A: mk(marker("marker-a.png"), 500), B: mk(marker("marker-b.png"), 500), section: mk(sectionStyle(""), 499) };
    layersRef.current = layers;
    const ids = [
      LayerManager.addLayer(layers.section, "Tools", "Spatial Report LHRS Section", { visible: true }),
      LayerManager.addLayer(layers.A, "Tools", "Spatial Report LHRS A", { visible: true }),
      LayerManager.addLayer(layers.B, "Tools", "Spatial Report LHRS B", { visible: true }),
    ];
    // A previously resolved range (panel reopened) - show it even though the points aren't kept
    if (props.rangeGeoJSON) {
      const geometry = geojson.readGeometry(props.rangeGeoJSON, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" });
      const f = new Feature({ geometry });
      layers.section.getSource()?.addFeature(f);
    }
    // Map clicks resolve points while this scope is shown, so suppress property/identify clicks
    setActiveToolId("spatialreport-lhrs");
    const key: EventsKey = map.on("click", (evt) => {
      const { points: p, mapTarget: target } = stateRef.current;
      const id: PointId | null = p.A.mode === "map" && p.B.mode === "map" ? target : p.A.mode === "map" ? "A" : p.B.mode === "map" ? "B" : null;
      if (!id) return;
      const [long, lat] = transform(evt.coordinate, "EPSG:3857", "EPSG:4326");
      resolveLatLongRef.current(id, lat, long);
    });
    return () => {
      unByKey(key);
      setActiveToolId(null);
      ids.forEach((id) => id && LayerManager.removeLayer(id));
      layersRef.current = null;
    };
    // props.rangeGeoJSON intentionally read once on mount (restore only)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, setActiveToolId]);

  const clearRange = () => {
    setPoints({ A: emptyPoint(), B: emptyPoint() });
    setMapTarget("A");
    setMarker("A");
    setMarker("B");
    drawSection();
    setSectionKm(undefined);
    props.onRangeChange(undefined);
  };

  const bothMap = points.A.mode === "map" && points.B.mode === "map";
  const a = points.A.resolved;
  const b = points.B.resolved;

  const renderPoint = (id: PointId) => {
    const p = points[id];
    const labels = p.mode === "map" ? null : INPUT_LABELS[p.mode];
    return (
      <div className="border border-base-300 rounded p-2 space-y-1">
        <div className="flex items-center gap-2 text-xs">
          <strong>Point {id}</strong>
          {p.resolving && <span className="loading loading-spinner loading-xs" />}
          {p.resolved && (
            <span className="text-base-content/70">
              Hwy {p.resolved.hwy}, {p.resolved.m_distance.toFixed(3)} km
            </span>
          )}
        </div>
        <select
          className="select select-bordered select-xs w-full"
          value={p.mode}
          aria-label={`Point ${id} entry`}
          onChange={(e) => {
            const mode = e.target.value as EntryMode;
            patchPoint(id, { mode, choices: undefined, inputs: ["", ""] });
            if (mode === "map") setMapTarget(id);
          }}
        >
          {ENTRY_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {p.mode === "map" &&
          (bothMap ? (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="radio" className="radio radio-xs" checked={mapTarget === id} onChange={() => setMapTarget(id)} />
              Click on map to set Point {id}
            </label>
          ) : (
            <p className="text-xs text-base-content/70">Click on map to set Point {id}.</p>
          ))}
        {labels && (
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              resolveEntry(id);
            }}
          >
            {labels.map((label, i) => (
              <input
                key={label}
                className="input input-bordered input-xs w-full"
                placeholder={label}
                aria-label={`Point ${id} ${label}`}
                value={p.inputs[i]}
                onChange={(e) => patchPoint(id, { inputs: (i === 0 ? [e.target.value, p.inputs[1]] : [p.inputs[0], e.target.value]) as [string, string] })}
              />
            ))}
            <button type="submit" className="btn btn-xs btn-primary" disabled={!version || p.resolving}>
              Find
            </button>
          </form>
        )}
        {p.choices && p.choices.length > 1 && (
          <select
            className="select select-bordered select-xs select-warning w-full"
            defaultValue=""
            aria-label={`Point ${id} highway`}
            onChange={(e) => applyResolved(id, p.choices!.find((c) => c.hwy === e.target.value))}
          >
            <option value="" disabled>
              Multiple highways found - choose one...
            </option>
            {p.choices.map((c) => (
              <option key={c.hwy} value={c.hwy}>
                Hwy {c.hwy} ({c.m_distance.toFixed(3)} km)
              </option>
            ))}
          </select>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <select className="select select-bordered select-xs w-full" value={version} onChange={(e) => setVersion(e.target.value)} aria-label="LHRS version" disabled={!versions.length}>
          {versions.length === 0 && <option value="">Loading LHRS versions...</option>}
          {versions.map((v) => (
            <option key={v.lhrs_version} value={v.lhrs_version}>
              {v.lhrs_version_title}
              {v.current ? " (current)" : ""}
            </option>
          ))}
        </select>
        <input type="number" min={1} className="input input-bordered input-xs max-w-[7rem]" value={snapping} onChange={(e) => setSnapping(e.target.value)} title="Snapping distance (m)" aria-label="Snapping distance (m)" />
      </div>
      {renderPoint("A")}
      {renderPoint("B")}
      {a && b && a.hwy !== b.hwy && <p className="text-xs text-warning">Point A and Point B must be on the same highway to define a range.</p>}
      {sectionKm !== undefined && <p className="text-xs">Section length: {sectionKm.toFixed(3)} km</p>}
      {props.rangeGeoJSON && sectionKm === undefined && !a && !b && <p className="text-xs text-base-content/70">Using the previously selected LHRS range.</p>}
      {(a || b || props.rangeGeoJSON) && (
        <button type="button" className="btn btn-xs btn-ghost" onClick={clearRange}>
          Clear Range
        </button>
      )}
      <PredicatePicker label="LHRS range match rule" predicate={props.predicate} distance={props.distance} onPredicateChange={props.onPredicateChange} onDistanceChange={props.onDistanceChange} />
    </div>
  );
}
