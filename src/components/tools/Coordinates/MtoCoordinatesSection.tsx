"use client";

/**
 * "MTO / Ontario Coordinate Systems" section of the Coordinates tool - the legacy i-Map's
 * CoordinatesMTO tool folded into this one: pick a coordinate system, the zone is chosen
 * automatically from the captured point (or picked manually), enter known coordinates to
 * place/zoom to them, copy in a chosen format, and see live pointer coordinates.
 *
 * Zone semantics follow legacy: picking a zone re-reads the typed X/Y in that zone (for entering
 * known coordinates), while "Auto" / a new map click / a new coordinate system reproject the point.
 */

import React, { useCallback, useEffect, useState } from "react";
import { FaSearchPlus, FaMapMarkerAlt, FaCopy, FaCrosshairs } from "react-icons/fa";
import { transform } from "ol/proj";
import type { Coordinate } from "ol/coordinate";
import { glowContainer } from "@/utils/helpersBrowser";
import { coordinateSystems, copyFormats, formatCopyText, fromZone, hasZones, registerMtoProjections, resolveZone, toZone, zoneTitle } from "./mtoCoordinateSystems";

const INPUT_PLACEHOLDER = "(listening for input)";
const AUTO_ZONE = "auto";

export interface CapturedPoint {
  /** Web Mercator coordinate */
  coord: Coordinate;
  /** Changes on every capture, so clicking the same spot twice still re-populates */
  id: number;
}

interface MtoCoordinatesSectionProps {
  capturedPoint: CapturedPoint | null;
  livePoint: Coordinate | null;
  /** Move the tool's marker to a Web Mercator coordinate, optionally panning/zooming to it */
  onMovePoint: (coord: Coordinate, mode: "none" | "pan" | "zoom") => void;
  onMyMapsClick: (x: string, y: string) => void;
  copyToClipboard: (text: string) => void;
}

export default function MtoCoordinatesSection({ capturedPoint, livePoint, onMovePoint, onMyMapsClick, copyToClipboard }: MtoCoordinatesSectionProps) {
  const [systemIndex, setSystemIndex] = useState(0);
  const [inputCode, setInputCode] = useState<string>(coordinateSystems[0].zones[0].code);
  const [x, setX] = useState("");
  const [y, setY] = useState("");
  const [point, setPoint] = useState<Coordinate | null>(null);
  const [outsideZones, setOutsideZones] = useState(false);
  const [copyIndex, setCopyIndex] = useState(0);

  const system = coordinateSystems[systemIndex];
  const zone = system.zones.find((z) => z.code === inputCode) ?? system.zones[0];

  useEffect(() => {
    registerMtoProjections();
  }, []);

  /** Show a Web Mercator point in the given system, choosing its zone automatically. */
  const populate = useCallback((coord: Coordinate, index: number) => {
    const target = coordinateSystems[index];
    const [lon, lat] = transform(coord, "EPSG:3857", "EPSG:4326");
    const { zone: resolved, exact } = resolveZone(target, lon, lat);
    const xy = toZone(coord, resolved.code);
    setInputCode(resolved.code);
    setX(xy[0].toFixed(target.precision));
    setY(xy[1].toFixed(target.precision));
    setPoint(coord);
    setOutsideZones(!exact);
    glowContainer("sc-coordinate-mto-x", "green");
    glowContainer("sc-coordinate-mto-y", "green");
  }, []);

  // Map click in the tool
  useEffect(() => {
    if (capturedPoint) populate(capturedPoint.coord, systemIndex);
    // Only a new capture should re-populate; system changes are handled in onSystemChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturedPoint]);

  /** Web Mercator point for the typed X/Y in the current zone, or null if not numbers. */
  const typedPoint = (xValue: string, yValue: string, code: string): Coordinate | null => {
    const xNum = parseFloat(xValue);
    const yNum = parseFloat(yValue);
    if (isNaN(xNum) || isNaN(yNum)) return null;
    return fromZone([xNum, yNum], code);
  };

  const onTyped = (xValue: string, yValue: string) => {
    setX(xValue);
    setY(yValue);
    const coord = typedPoint(xValue, yValue, inputCode);
    if (!coord) return;
    setPoint(coord);
    setOutsideZones(false);
    onMovePoint(coord, "pan");
  };

  const onSystemChange = (index: number) => {
    setSystemIndex(index);
    if (point) {
      populate(point, index);
    } else {
      setInputCode(coordinateSystems[index].zones[0].code);
      setOutsideZones(false);
    }
  };

  const onZoneChange = (code: string) => {
    if (code === AUTO_ZONE) {
      if (point) populate(point, systemIndex);
      return;
    }
    // Legacy: the typed coordinates are re-read as belonging to the chosen zone
    setInputCode(code);
    setOutsideZones(false);
    const coord = typedPoint(x, y, code);
    if (!coord) return;
    setPoint(coord);
    onMovePoint(coord, "pan");
  };

  const goTo = (mode: "pan" | "zoom") => {
    const coord = typedPoint(x, y, inputCode);
    if (coord) onMovePoint(coord, mode);
  };

  const hasCoords = x !== "" && y !== "";
  const title = zoneTitle(system, zone);
  const copyFormat = copyFormats[copyIndex];
  const copyText = hasCoords && copyFormat ? formatCopyText(copyFormat.template, title, x, y) : "";

  // Live pointer position in the selected system (zone picked from the pointer's location)
  let liveText: string | null = null;
  if (livePoint) {
    const [lon, lat] = transform(livePoint, "EPSG:3857", "EPSG:4326");
    const { zone: liveZone } = resolveZone(system, lon, lat);
    const liveXY = toZone(livePoint, liveZone.code);
    liveText = `${zoneTitle(system, liveZone)}: ${liveXY[0].toFixed(system.precision)} / ${liveXY[1].toFixed(system.precision)}`;
  }

  const actionClass = `inline-flex items-center gap-1 hover:text-primary transition-colors ${hasCoords ? "text-base-content cursor-pointer" : "text-base-content/50 cursor-not-allowed"}`;

  return (
    <div className="card card-compact bg-base-100 border border-base-300">
      <div className="card-body p-3 gap-2">
        <h4 className="text-xs font-medium text-primary">MTO / Ontario Coordinate Systems</h4>

        <label className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium">Coordinate System</span>
          <select className="select select-bordered select-sm flex-1 text-xs" value={systemIndex} onChange={(e) => onSystemChange(Number(e.target.value))} aria-label="Coordinate system">
            {coordinateSystems.map((s, i) => (
              <option key={s.projection} value={i}>
                {s.projection}
              </option>
            ))}
          </select>
        </label>

        {hasZones(system) && (
          <label className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 font-medium">Zone</span>
            <select className="select select-bordered select-sm flex-1 text-xs" value={inputCode} onChange={(e) => onZoneChange(e.target.value)} aria-label="Zone">
              <option value={AUTO_ZONE}>Auto (from location)</option>
              {system.zones.map((z) => (
                <option key={z.code} value={z.code}>
                  {z.zone}
                </option>
              ))}
            </select>
          </label>
        )}
        {outsideZones && <p className="text-[11px] text-warning">Outside this system&apos;s zones - showing the nearest zone.</p>}

        <div className="grid grid-cols-2 gap-2">
          {(["x", "y"] as const).map((axis) => (
            <div key={axis}>
              <label className="label py-0" htmlFor={`sc-coordinate-mto-${axis}`}>
                <span className="label-text text-xs">{axis === "x" ? "X / Long" : "Y / Lat"}</span>
              </label>
              <input
                id={`sc-coordinate-mto-${axis}`}
                type="text"
                className="input input-bordered input-sm w-full text-xs font-mono"
                placeholder={INPUT_PLACEHOLDER}
                value={axis === "x" ? x : y}
                onChange={(e) => (axis === "x" ? onTyped(e.target.value, y) : onTyped(x, e.target.value))}
                onKeyDown={(e) => e.key === "Enter" && goTo("pan")}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 text-xs">
          <button className={actionClass} onClick={() => hasCoords && goTo("zoom")} title="Zoom to MTO coordinates">
            <FaSearchPlus size={11} />
            <span className="underline">Zoom</span>
          </button>
          <button className={actionClass} onClick={() => hasCoords && goTo("pan")} title="Pan to MTO coordinates">
            <FaCrosshairs size={11} />
            <span className="underline">Pan to</span>
          </button>
          <button className={actionClass} onClick={() => hasCoords && onMyMapsClick(x, y)} title="Add MTO coordinates to My Maps">
            <FaMapMarkerAlt size={11} />
            <span className="underline">My Maps</span>
          </button>
        </div>

        <div className="divider my-0" />

        <label className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 font-medium">Copy Format</span>
          <select className="select select-bordered select-sm flex-1 text-xs" value={copyIndex} onChange={(e) => setCopyIndex(Number(e.target.value))} aria-label="Copy format">
            {copyFormats.map((f, i) => (
              <option key={f.title} value={i}>
                {f.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <input type="text" readOnly className="input input-bordered input-sm flex-1 text-xs font-mono" value={copyText} placeholder="waiting for coordinates ..." aria-label="Formatted coordinates" />
          <button className={actionClass} onClick={() => copyText && copyToClipboard(copyText)} title="Copy MTO coordinates to clipboard">
            <FaCopy size={12} />
          </button>
        </div>

        {liveText && (
          <div className="flex items-center justify-between gap-2 rounded bg-base-200 px-2 py-1">
            <span className="text-[11px] font-mono text-base-content/80 break-all">{liveText}</span>
            <span className="badge badge-success badge-xs shrink-0">LIVE</span>
          </div>
        )}
      </div>
    </div>
  );
}
