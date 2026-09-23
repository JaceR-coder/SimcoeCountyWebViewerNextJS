"use client";

/**
 * LHRS Tool Component
 * Ported from SimcoeCountyWebViewer lhrsmto/LHRSMTO.jsx (a superset of the plain lhrs/LHRS.jsx
 * tool - same lookups plus CLRS / SmartCL fields and a highway picker for ambiguous clicks).
 *
 * Locate a point by map click, lat/long, highway + M distance or basepoint + offset, and get its
 * LHRS / CLRS / SmartCL referencing. With two points on the same highway, the section between
 * them is drawn and measured. Backend: /api/public/lhrs/* (see lhrsApi.ts).
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { FaMapMarkerAlt, FaCopy, FaExternalLinkAlt, FaSearch } from "react-icons/fa";
import PanelComponent from "@/components/PanelComponent";
import { useMapStore } from "@/stores/mapStore";
import { useMyMapsStore, createMyMapsItem } from "@/stores/myMapsStore";
import { useEventStore } from "@/stores/eventStore";
import { featureToGeoJSON } from "@/utils/myMapsHelpers";
import { activateTab, showMessage } from "@/utils/helpersUI";
import { getPublicPath } from "@/utils/getPublicPath";
import { LayerManager } from "@/utils/openlayers/LayerManager";

import { transform } from "ol/proj";
import { Vector as VectorLayer } from "ol/layer";
import { Vector as VectorSource } from "ol/source";
import { Icon, Style, Stroke, Text, Fill } from "ol/style";
import { GeoJSON } from "ol/format";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import { unByKey } from "ol/Observable";
import type { EventsKey } from "ol/events";
import type { Coordinate } from "ol/coordinate";
import type { Geometry } from "ol/geom";

import toolConfig from "./config.json";
import {
  type LHRSPointResult,
  type LHRSVersion,
  resolveApiUrl,
  getVersions,
  byXYMulti,
  byBasepoint,
  byMDistance,
  linearByMDistance,
  dedupeByHwy,
  buildSmartCLReportUrl,
} from "./lhrsApi";

interface LHRSToolProps {
  name?: string;
  helpLink?: string;
  hideHeader?: boolean;
  onClose: () => void;
  onSidebarVisibility?: () => void;
  config?: Record<string, unknown>;
  /** { coordinate: [x, y] } in EPSG:3857 when opened from the map's right-click menu */
  options?: Record<string, unknown>;
}

type PointId = "A" | "B";
type EntryMode = "selectPoint" | "enterLatLong" | "enterHwy" | "enterBasepoint" | "enterDistanceFromA";

interface Section {
  length: number;
  feature: Feature<Geometry>;
}

const ENTRY_MODES: { value: EntryMode; label: string }[] = [
  { value: "selectPoint", label: "Select on Map" },
  { value: "enterLatLong", label: "Enter Lat/Long" },
  { value: "enterHwy", label: "Enter Hwy/Distance" },
  { value: "enterBasepoint", label: "Enter Basepoint/Offset" },
  { value: "enterDistanceFromA", label: "Enter Distance from Point A" },
];

const INPUT_LABELS: Record<Exclude<EntryMode, "selectPoint">, [string, string | null]> = {
  enterLatLong: ["Latitude", "Longitude"],
  enterHwy: ["Hwy", "M Dist. (km)"],
  enterBasepoint: ["Basepoint", "Offset (km)"],
  enterDistanceFromA: ["M Dist. From A (km)", null],
};

const markerStyle = (file: string) =>
  new Style({
    image: new Icon({ anchor: [0.5, 1], src: getPublicPath(`/images/lhrs/${file}`) }),
  });

const sectionStyle = (label: string) =>
  new Style({
    stroke: new Stroke({ color: [0, 255, 255, 0.8], width: 6 }),
    text: new Text({
      text: label,
      font: "bold 16px sans-serif",
      placement: "line",
      fill: new Fill({ color: "#000" }),
      stroke: new Stroke({ color: "#fff", width: 3 }),
    }),
  });

const fmt = (n: number | null | undefined, digits = 3) => (n === null || n === undefined || Number.isNaN(Number(n)) ? "" : Number(n).toFixed(digits));

export default function LHRSTool({ name = "LHRS", helpLink, hideHeader = false, onClose, onSidebarVisibility, config, options }: LHRSToolProps) {
  const { map, setActiveToolId } = useMapStore();

  const apiUrl = resolveApiUrl((config?.apiUrl as string | undefined) ?? toolConfig.apiUrl);
  const smartclConfig = (config?.smartcl as typeof toolConfig.smartcl | undefined) ?? toolConfig.smartcl;

  const [versions, setVersions] = useState<LHRSVersion[]>([]);
  const [version, setVersion] = useState<string>("");
  const [snapping, setSnapping] = useState<string>(String((config?.defaultSnappingDistance as number | undefined) ?? toolConfig.defaultSnappingDistance));
  const [mode, setMode] = useState<EntryMode>("selectPoint");
  const [activePoint, setActivePoint] = useState<PointId>("A");
  const [inputA, setInputA] = useState("");
  const [inputB, setInputB] = useState("");
  const [points, setPoints] = useState<Record<PointId, LHRSPointResult | null>>({ A: null, B: null });
  const [hwyChoices, setHwyChoices] = useState<LHRSPointResult[]>([]);
  const [section, setSection] = useState<Section | null>(null);
  const [busy, setBusy] = useState(false);

  // Latest values for async callbacks / map handlers without re-binding them
  const stateRef = useRef({ version, snapping, activePoint, mode, points });
  stateRef.current = { version, snapping, activePoint, mode, points };
  const requestSeq = useRef<Record<PointId, number>>({ A: 0, B: 0 });

  const layersRef = useRef<{ A: VectorLayer<VectorSource>; B: VectorLayer<VectorSource>; section: VectorLayer<VectorSource> } | null>(null);
  const layerIdsRef = useRef<string[]>([]);
  const clickKeyRef = useRef<EventsKey | null>(null);

  // ---------------------------------------------------------------------------
  // Map graphics
  // ---------------------------------------------------------------------------
  const placeMarker = useCallback((pointId: PointId, lat: number | null, long: number | null) => {
    const source = layersRef.current?.[pointId].getSource();
    if (!source) return;
    source.clear();
    if (lat === null || long === null) return;
    source.addFeature(new Feature({ geometry: new Point(transform([long, lat], "EPSG:4326", "EPSG:3857")) }));
  }, []);

  const zoomTo = useCallback(
    (lat: number, long: number) => {
      map?.getView().animate({ center: transform([long, lat], "EPSG:4326", "EPSG:3857"), duration: 300 });
    },
    [map],
  );

  const snapDistance = () => {
    const n = parseInt(stateRef.current.snapping, 10);
    return Number.isFinite(n) && n > 0 ? n : toolConfig.defaultSnappingDistance;
  };

  // ---------------------------------------------------------------------------
  // Section (A -> B on the same highway)
  // ---------------------------------------------------------------------------
  const updateSection = useCallback(
    async (a: LHRSPointResult | null, b: LHRSPointResult | null, ver: string) => {
      const source = layersRef.current?.section.getSource();
      source?.clear();
      setSection(null);
      if (!a || !b) return;
      if (a.hwy !== b.hwy) {
        showMessage("LHRS", `Points are on different highways (${a.hwy} / ${b.hwy}) - no section drawn.`, "warning", 3000);
        return;
      }
      try {
        const result = await linearByMDistance(apiUrl, {
          version: ver,
          snappingDistance: snapDistance(),
          hwy: a.hwy,
          fromDistance: a.m_distance,
          toDistance: b.m_distance,
        });
        if (!result?.geom || !(result.section_length > 0)) return;
        const geometry = new GeoJSON().readGeometry(result.geom, { dataProjection: "EPSG:3857", featureProjection: "EPSG:3857" });
        const label = `${fmt(result.section_length)} km`;
        const feature = new Feature({ geometry });
        feature.setStyle(sectionStyle(label));
        feature.set("label", label);
        source?.addFeature(feature);
        setSection({ length: result.section_length, feature });
        map?.getView().fit(geometry.getExtent(), { padding: [80, 80, 80, 80], duration: 600, maxZoom: 17 });
      } catch (err) {
        showMessage("LHRS", (err as Error).message, "error", 3000);
      }
    },
    [apiUrl, map],
  );

  // Every successful/failed lookup funnels through here
  const commitPoint = useCallback(
    (pointId: PointId, result: LHRSPointResult | null, ver: string, fallback?: { lat: number; long: number }) => {
      const next = { ...stateRef.current.points, [pointId]: result };
      // Point B only makes sense relative to A
      if (pointId === "A" && !result) next.B = null;
      setPoints(next);
      setHwyChoices([]);
      placeMarker(pointId, result?.latitude_in ?? fallback?.lat ?? null, result?.longitude_in ?? fallback?.long ?? null);
      if (pointId === "A" && !result) placeMarker("B", null, null);

      if (next.A && next.B) {
        updateSection(next.A, next.B, ver);
      } else {
        layersRef.current?.section.getSource()?.clear();
        setSection(null);
        if (result) zoomTo(result.latitude_in, result.longitude_in);
      }
      // After placing A, move straight on to B - same as picking the second point in the legacy tool
      if (pointId === "A" && result) setActivePoint("B");
    },
    [placeMarker, updateSection, zoomTo],
  );

  // ---------------------------------------------------------------------------
  // Lookups
  // ---------------------------------------------------------------------------
  const run = useCallback(
    async (lookup: (ver: string) => Promise<void>) => {
      const ver = stateRef.current.version;
      if (!ver) return;
      setBusy(true);
      try {
        await lookup(ver);
      } catch (err) {
        showMessage("LHRS", (err as Error).message, "error", 3000);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const lookupByLatLong = useCallback(
    (lat: number, long: number, pointId: PointId) =>
      run(async (ver) => {
        const seq = ++requestSeq.current[pointId];
        const rows = dedupeByHwy(await byXYMulti(apiUrl, { version: ver, snappingDistance: snapDistance(), lat, long }));
        if (seq !== requestSeq.current[pointId]) return; // superseded by a newer click
        if (rows.length === 1) {
          commitPoint(pointId, rows[0], ver);
        } else if (rows.length > 1) {
          commitPoint(pointId, null, ver, { lat, long });
          setHwyChoices(rows);
          showMessage("Multiple Found", "Multiple highways detected - choose the correct highway from the list.", "warning", 3500);
        } else {
          commitPoint(pointId, null, ver, { lat, long });
          showMessage("Not Found", "Location is outside the snapping threshold. Pick a location closer to a highway or increase the snapping distance.", "error", 3500);
        }
      }),
    [apiUrl, commitPoint, run],
  );

  const lookupByHwy = useCallback(
    (hwy: string, distance: number, pointId: PointId) =>
      run(async (ver) => {
        const seq = ++requestSeq.current[pointId];
        const result = await byMDistance(apiUrl, { version: ver, snappingDistance: snapDistance(), hwy, distance });
        if (seq !== requestSeq.current[pointId]) return;
        commitPoint(pointId, result, ver);
        if (!result) showMessage("Not Found", "No LHRS data found.", "info", 2000);
      }),
    [apiUrl, commitPoint, run],
  );

  const lookupByBasepoint = useCallback(
    (basepoint: number, offset: number, pointId: PointId) =>
      run(async (ver) => {
        const seq = ++requestSeq.current[pointId];
        const result = await byBasepoint(apiUrl, { version: ver, snappingDistance: snapDistance(), basepoint, offset });
        if (seq !== requestSeq.current[pointId]) return;
        commitPoint(pointId, result, ver);
        if (!result) showMessage("Not Found", "No LHRS data found.", "info", 2000);
      }),
    [apiUrl, commitPoint, run],
  );

  const executeEntry = useCallback(() => {
    const a = inputA.trim();
    const b = inputB.trim();
    const na = parseFloat(a);
    const nb = parseFloat(b);
    switch (mode) {
      case "enterLatLong":
        if (Number.isNaN(na) || Number.isNaN(nb)) return showMessage("Error", "Invalid Lat/Long.", "error", 2000);
        return lookupByLatLong(na, nb, activePoint);
      case "enterHwy":
        if (!a || Number.isNaN(nb)) return showMessage("Error", "Enter a highway and a numeric distance.", "error", 2000);
        return lookupByHwy(a, nb, activePoint);
      case "enterBasepoint":
        if (Number.isNaN(na) || Number.isNaN(nb)) return showMessage("Error", "Invalid Basepoint/Offset.", "error", 2000);
        return lookupByBasepoint(na, nb, activePoint);
      case "enterDistanceFromA": {
        const pa = points.A;
        if (!pa) return;
        if (Number.isNaN(na)) return showMessage("Error", "Invalid Distance.", "error", 2000);
        return lookupByHwy(pa.hwy, pa.m_distance + na, "B");
      }
      default:
        return;
    }
  }, [mode, inputA, inputB, activePoint, points.A, lookupByLatLong, lookupByHwy, lookupByBasepoint]);

  // Pick one of several highways returned for an ambiguous click
  const selectHwy = (hwy: string) => {
    const row = hwyChoices.find((r) => r.hwy === hwy);
    if (row) commitPoint(stateRef.current.activePoint, row, stateRef.current.version);
  };

  // Re-resolve existing points against a different LHRS version (legacy behaviour)
  const onVersionChange = (ver: string) => {
    setVersion(ver);
    stateRef.current.version = ver;
    const { A, B } = stateRef.current.points;
    if (A) lookupByHwy(A.hwy, A.m_distance, "A").then(() => B && lookupByHwy(B.hwy, B.m_distance, "B"));
  };

  const onModeChange = (next: EntryMode) => {
    setMode(next);
    setHwyChoices([]);
    const target = next === "enterDistanceFromA" ? "B" : activePoint;
    if (next === "enterDistanceFromA") setActivePoint("B");
    prefillInputs(next, target);
  };

  const prefillInputs = (m: EntryMode, pointId: PointId) => {
    const p = stateRef.current.points[pointId];
    const pa = stateRef.current.points.A;
    switch (m) {
      case "enterLatLong":
        setInputA(p ? fmt(p.latitude_in, 7) : "");
        setInputB(p ? fmt(p.longitude_in, 7) : "");
        break;
      case "enterHwy":
        setInputA(p?.hwy ?? "");
        setInputB(p ? String(p.m_distance) : "");
        break;
      case "enterBasepoint":
        setInputA(p ? String(p.basepoint) : "");
        setInputB(p ? String(p.lhrs_offset) : "");
        break;
      case "enterDistanceFromA":
        setInputA(pa && p ? fmt(p.m_distance - pa.m_distance) : "");
        setInputB("");
        break;
      default:
        setInputA("");
        setInputB("");
    }
  };

  const onActivePointChange = (pointId: PointId) => {
    setActivePoint(pointId);
    setHwyChoices([]);
    if (mode === "enterDistanceFromA" && pointId === "A") setMode("selectPoint");
    prefillInputs(mode === "enterDistanceFromA" && pointId === "A" ? "selectPoint" : mode, pointId);
  };

  const clearAll = () => {
    requestSeq.current.A++;
    requestSeq.current.B++;
    setPoints({ A: null, B: null });
    setHwyChoices([]);
    setSection(null);
    setActivePoint("A");
    if (mode === "enterDistanceFromA") setMode("selectPoint");
    setInputA("");
    setInputB("");
    layersRef.current?.A.getSource()?.clear();
    layersRef.current?.B.getSource()?.clear();
    layersRef.current?.section.getSource()?.clear();
  };

  // ---------------------------------------------------------------------------
  // My Maps / clipboard
  // ---------------------------------------------------------------------------
  const addToMyMaps = (what: PointId | "section") => {
    const layer = what === "section" ? layersRef.current?.section : layersRef.current?.[what];
    const src = layer?.getSource()?.getFeatures()[0];
    if (!src) return;
    const feature = src.clone();
    feature.setStyle(undefined);
    let label: string;
    if (what === "section") {
      label = `Hwy ${points.A?.hwy} ${fmt(points.A?.m_distance)}-${fmt(points.B?.m_distance)} km (${fmt(section?.length)} km)`;
    } else {
      const p = points[what];
      label = p ? `Hwy ${p.hwy} @ ${fmt(p.m_distance)} km (BP ${p.basepoint} + ${fmt(p.lhrs_offset)})` : `LHRS Point ${what}`;
    }
    const item = createMyMapsItem(feature, what === "section" ? "LineString" : "Point", label);
    item.featureGeoJSON = featureToGeoJSON(feature);
    useMyMapsStore.getState().addItem(item);
    useEventStore.getState().emit("mymap-item-created", { item });
    activateTab("mymaps");
  };

  const copyPoint = (p: LHRSPointResult) => {
    const lines = [
      `Lat/Long: ${fmt(p.latitude_in, 7)}, ${fmt(p.longitude_in, 7)}`,
      `LHRS Hwy / M Dist (km): ${p.hwy} / ${fmt(p.m_distance)}`,
      `LHRS Basepoint / Offset (km): ${p.basepoint} / ${fmt(p.lhrs_offset)}`,
      p.clrs_route ? `CLRS Route / M Dist (km): ${p.clrs_route} / ${fmt(p.clrs_measurement)}` : null,
      p.smartcl_route ? `SmartCL Route / Twp / Chainage: ${p.smartcl_route} / ${p.smartcl_twp} / ${p.smartcl_chainage}` : null,
    ].filter(Boolean);
    navigator.clipboard?.writeText(lines.join("\n")).then(() => showMessage("Copied", "LHRS details copied to clipboard.", "success", 1500));
  };

  const lookupByLatLongRef = useRef(lookupByLatLong);
  lookupByLatLongRef.current = lookupByLatLong;

  // ---------------------------------------------------------------------------
  // Setup / teardown
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    getVersions(apiUrl)
      .then((rows) => {
        if (cancelled) return;
        setVersions(rows);
        const current = rows.find((r) => r.current) ?? rows[0];
        if (current) {
          setVersion(current.lhrs_version);
          stateRef.current.version = current.lhrs_version;
        }
      })
      .catch((err) => showMessage("LHRS", `Could not load LHRS versions: ${(err as Error).message}`, "error", 4000));
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  useEffect(() => {
    if (!map) return;
    const mk = (style: Style, z: number) => new VectorLayer({ source: new VectorSource(), style, zIndex: z });
    const layers = { A: mk(markerStyle("marker-a.png"), 500), B: mk(markerStyle("marker-b.png"), 500), section: mk(sectionStyle(""), 499) };
    layersRef.current = layers;
    layerIdsRef.current = [
      LayerManager.addLayer(layers.section, "Tools", "LHRS Section", { visible: true }),
      LayerManager.addLayer(layers.A, "Tools", "LHRS Point A", { visible: true }),
      LayerManager.addLayer(layers.B, "Tools", "LHRS Point B", { visible: true }),
    ].filter((id): id is string => id !== null);

    // Disables parcel click etc. while the tool is open
    setActiveToolId("lhrs");

    clickKeyRef.current = map.on("click", (evt: { coordinate: Coordinate }) => {
      if (stateRef.current.mode !== "selectPoint" || !stateRef.current.version) return;
      const [long, lat] = transform(evt.coordinate, "EPSG:3857", "EPSG:4326");
      lookupByLatLongRef.current(lat, long, stateRef.current.activePoint);
    });

    return () => {
      if (clickKeyRef.current) unByKey(clickKeyRef.current);
      setActiveToolId(null);
      layerIdsRef.current.forEach((id) => LayerManager.removeLayer(id));
      layerIdsRef.current = [];
      layersRef.current = null;
    };
  }, [map, setActiveToolId]);

  // Opened from the right-click menu: look up the clicked location as Point A once versions are loaded
  const initialCoordHandled = useRef(false);
  useEffect(() => {
    const coord = options?.coordinate as Coordinate | undefined;
    if (initialCoordHandled.current || !coord || !version || !map) return;
    initialCoordHandled.current = true;
    const [long, lat] = transform(coord, "EPSG:3857", "EPSG:4326");
    lookupByLatLong(lat, long, "A");
  }, [options, version, map, lookupByLatLong]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const modes = ENTRY_MODES.filter((m) => m.value !== "enterDistanceFromA" || points.A);
  const labels = mode === "selectPoint" ? null : INPUT_LABELS[mode];
  const smartclUrl =
    points.A && points.B && section
      ? buildSmartCLReportUrl(
          smartclConfig,
          { lat: points.A.latitude_in, long: points.A.longitude_in },
          { lat: points.B.latitude_in, long: points.B.longitude_in },
          points.A.hwy,
        )
      : null;

  return (
    <PanelComponent name={name} helpLink={helpLink} hideHeader={hideHeader} onClose={onClose} onSidebarVisibility={onSidebarVisibility}>
      <div className="relative w-full overflow-auto text-base-content p-2 space-y-3">
        {/* SETTINGS */}
        <div className="grid grid-cols-2 gap-2">
          <label className="form-control">
            <span className="label-text text-xs">LHRS Version</span>
            <select className="select select-bordered select-sm" value={version} onChange={(e) => onVersionChange(e.target.value)} disabled={!versions.length}>
              {versions.map((v) => (
                <option key={v.lhrs_version} value={v.lhrs_version}>
                  {v.lhrs_version_title}
                  {v.current ? " (current)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="form-control">
            <span className="label-text text-xs">Snapping Dist. (m)</span>
            <input type="number" min={1} className="input input-bordered input-sm w-full" value={snapping} onChange={(e) => setSnapping(e.target.value)} />
          </label>
        </div>

        {/* ENTRY */}
        <div className="card card-compact bg-base-100 border border-base-300">
          <div className="card-body p-3 space-y-2">
            <label className="form-control">
              <span className="label-text text-xs">LHRS Entry</span>
              <select className="select select-bordered select-sm" value={mode} onChange={(e) => onModeChange(e.target.value as EntryMode)}>
                {modes.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">Point:</span>
              <div className="join">
                {(["A", "B"] as PointId[]).map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`join-item btn btn-xs ${activePoint === id ? "btn-primary" : "btn-ghost border-base-300"}`}
                    disabled={id === "B" && !points.A}
                    title={id === "B" && !points.A ? "Locate Point A first" : `Set Point ${id}`}
                    onClick={() => onActivePointChange(id)}
                  >
                    Point {id}
                  </button>
                ))}
              </div>
              {busy && <span className="loading loading-spinner loading-xs" />}
              <button type="button" className="btn btn-xs btn-ghost ml-auto" onClick={clearAll} disabled={!points.A && !points.B}>
                Clear
              </button>
            </div>

            {mode === "selectPoint" ? (
              <p className="text-xs text-base-content/70">Click the map to locate Point {activePoint}.</p>
            ) : (
              labels && (
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    executeEntry();
                  }}
                >
                  <label className="form-control flex-1">
                    <span className="label-text text-xs">{labels[0]}</span>
                    <input id="sc-lhrs-input-a" className="input input-bordered input-sm w-full font-mono" value={inputA} onChange={(e) => setInputA(e.target.value)} />
                  </label>
                  {labels[1] && (
                    <label className="form-control flex-1">
                      <span className="label-text text-xs">{labels[1]}</span>
                      <input id="sc-lhrs-input-b" className="input input-bordered input-sm w-full font-mono" value={inputB} onChange={(e) => setInputB(e.target.value)} />
                    </label>
                  )}
                  <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !version} title="Find">
                    <FaSearch />
                  </button>
                </form>
              )
            )}

            {hwyChoices.length > 1 && (
              <label className="form-control">
                <span className="label-text text-xs text-warning">Multiple highways found - select one</span>
                <select className="select select-bordered select-sm select-warning" defaultValue="" onChange={(e) => selectHwy(e.target.value)}>
                  <option value="" disabled>
                    Select Hwy...
                  </option>
                  {hwyChoices.map((r) => (
                    <option key={r.hwy} value={r.hwy}>
                      Hwy {r.hwy} ({r.snapping_distance} m away)
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>

        {/* SECTION */}
        {section && points.A && points.B && (
          <div className="card card-compact bg-base-100 border border-info">
            <div className="card-body p-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm">Section - Hwy {points.A.hwy}</h4>
                <button type="button" className="inline-flex items-center gap-1 text-xs underline hover:text-primary" onClick={() => addToMyMaps("section")}>
                  <FaMapMarkerAlt size={11} /> My Maps
                </button>
              </div>
              <InfoRow label="Length (km)" value={fmt(section.length)} />
              <InfoRow label="From / To M Dist. (km)" value={`${fmt(points.A.m_distance)} / ${fmt(points.B.m_distance)}`} />
              {smartclUrl && (
                <a className="link link-primary text-xs inline-flex items-center gap-1 mt-1" href={smartclUrl} target="_blank" rel="noopener noreferrer">
                  Smart CL - Segment Report <FaExternalLinkAlt size={10} />
                </a>
              )}
            </div>
          </div>
        )}

        {/* POINTS */}
        {(["A", "B"] as PointId[]).map((id) => {
          const p = points[id];
          if (!p) return null;
          return (
            <div key={id} className="card card-compact bg-base-100 border border-base-300">
              <div className="card-body p-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm">Point {id}</h4>
                  <div className="flex gap-3 text-xs">
                    <button type="button" className="inline-flex items-center gap-1 underline hover:text-primary" onClick={() => addToMyMaps(id)}>
                      <FaMapMarkerAlt size={11} /> My Maps
                    </button>
                    <button type="button" className="inline-flex items-center gap-1 underline hover:text-primary" onClick={() => copyPoint(p)}>
                      <FaCopy size={11} /> Copy
                    </button>
                  </div>
                </div>
                <InfoRow label="Lat / Long" value={`${fmt(p.latitude_in, 7)} / ${fmt(p.longitude_in, 7)}`} />
                <InfoRow label="LHRS - Hwy / M Dist. (km)" value={`${p.hwy} / ${fmt(p.m_distance)}`} />
                <InfoRow label="LHRS - Basepoint / Offset (km)" value={`${p.basepoint} / ${fmt(p.lhrs_offset)}`} />
                <InfoRow label="CLRS - Route ID / M Dist. (km)" value={p.clrs_route ? `${p.clrs_route} / ${fmt(p.clrs_measurement)}` : ""} />
                <InfoRow
                  label="Smart CL - Route / Twp / Chainage"
                  value={p.smartcl_route && p.smartcl_twp && p.smartcl_chainage ? `${p.smartcl_route} / ${p.smartcl_twp} / ${p.smartcl_chainage}` : ""}
                />
                <InfoRow label="Snapped Distance (m)" value={String(p.snapping_distance)} />
              </div>
            </div>
          );
        })}
      </div>
    </PanelComponent>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2 text-xs py-0.5">
      <span className="font-medium">{label}:</span>
      <span className="font-mono text-right text-base-content/80">{value || "-"}</span>
    </div>
  );
}
