/**
 * MTO / Ontario coordinate systems for the Coordinates tool - ported from the legacy i-Map's
 * CoordinatesMTO tool (config copied verbatim into mtoCoordinateSystems.json): Lat/Long,
 * MTM zones 8-16 (NAD83), UTM 15N-18N (NAD83 and NAD27), Ontario MNR Lambert and Web Mercator,
 * with the zone picked automatically from the point's location.
 *
 * Zone `boundary` boxes are [east, south, west, north] in degrees; a zone may list several boxes.
 * NAD27 zones keep legacy's `+towgs84=0,...` definitions (no datum shift) so values match what
 * users see in the old i-Map.
 */

import proj4 from "proj4";
import { register } from "ol/proj/proj4";
import { transform } from "ol/proj";
import type { Coordinate } from "ol/coordinate";
import mtoConfig from "./mtoCoordinateSystems.json";

export interface CoordinateZone {
  name: string;
  zone: string;
  code: string;
  boundary?: number[] | number[][];
  extent?: number[];
  def?: string[];
}

export interface CoordinateSystem {
  projection: string;
  precision: number;
  zones: CoordinateZone[];
}

export interface CopyFormat {
  title: string;
  template: string;
}

export const coordinateSystems = mtoConfig.coordinate_systems as CoordinateSystem[];
export const copyFormats = mtoConfig.copyFormat as CopyFormat[];

let registered = false;

/** Register every zone's proj4 definition with OpenLayers (once). */
export function registerMtoProjections(): void {
  if (registered) return;
  const defs = coordinateSystems.flatMap((system) => system.zones.filter((zone) => zone.def && zone.def.length === 2).map((zone) => zone.def as [string, string]));
  if (defs.length > 0) {
    proj4.defs(defs);
    register(proj4);
  }
  registered = true;
}

const boxesOf = (boundary: CoordinateZone["boundary"]): number[][] => {
  if (!boundary || boundary.length === 0) return [];
  return Array.isArray(boundary[0]) ? (boundary as number[][]) : [boundary as number[]];
};

export function zoneContains(zone: CoordinateZone, lon: number, lat: number): boolean {
  return boxesOf(zone.boundary).some(([east, south, west, north]) => lon < east && lon > west && lat > south && lat < north);
}

/** Degrees from the point to the zone's nearest boundary box (0 when inside). */
function distanceToZone(zone: CoordinateZone, lon: number, lat: number): number {
  const distances = boxesOf(zone.boundary).map(([east, south, west, north]) => {
    const dx = lon < west ? west - lon : lon > east ? lon - east : 0;
    const dy = lat < south ? south - lat : lat > north ? lat - north : 0;
    return Math.hypot(dx, dy);
  });
  return distances.length > 0 ? Math.min(...distances) : Number.POSITIVE_INFINITY;
}

/**
 * The zone containing the point. Like legacy, the last matching zone wins; unlike legacy (which
 * fell back to showing lat/long), a point outside every zone gets the nearest one, flagged
 * `exact: false` so the UI can say so.
 */
export function resolveZone(system: CoordinateSystem, lon: number, lat: number): { zone: CoordinateZone; exact: boolean } {
  let match: CoordinateZone | undefined;
  for (const zone of system.zones) {
    if (zoneContains(zone, lon, lat)) match = zone;
  }
  if (match) return { zone: match, exact: true };

  let nearest = system.zones[0];
  let best = Number.POSITIVE_INFINITY;
  for (const zone of system.zones) {
    const distance = distanceToZone(zone, lon, lat);
    if (distance < best) {
      best = distance;
      nearest = zone;
    }
  }
  return { zone: nearest, exact: false };
}

/** Web Mercator -> the zone's coordinates. */
export function toZone(webMercator: Coordinate, code: string): Coordinate {
  return transform(webMercator, "EPSG:3857", code);
}

/** The zone's coordinates -> Web Mercator. */
export function fromZone(xy: Coordinate, code: string): Coordinate {
  return transform(xy, code, "EPSG:3857");
}

export function hasZones(system: CoordinateSystem): boolean {
  return system.zones.length > 1;
}

/** "MTM (NAD83) - 10", or just the system name for single-zone systems (legacy's [coord]). */
export function zoneTitle(system: CoordinateSystem, zone: CoordinateZone | undefined): string {
  const label = zone?.zone.trim() ?? "";
  return label ? `${system.projection} - ${label}` : system.projection;
}

/** Fill a copy template: [x], [y] and [coord] (the zone title). */
export function formatCopyText(template: string, coord: string, x: string, y: string): string {
  return template.split("[x]").join(x).split("[y]").join(y).split("[coord]").join(coord);
}
