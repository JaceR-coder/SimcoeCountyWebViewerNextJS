/**
 * LHRS (Linear Highway Referencing System) service
 * Ported from SimcoeCountyWebApi helpers/lhrs.js. All referencing logic lives in the
 * postgisftw.lhrs_* functions in ner_master (DATABASE_URL); this only validates input
 * and calls them with bound parameters.
 *
 * Columns are selected explicitly with casts: the point functions also return a raw
 * PostGIS `geom` column (unused by the tool, and not a type Prisma can deserialize), and
 * numeric/bigint columns would otherwise come back as Decimal/BigInt, which don't JSON-serialize.
 */

import prisma from "@/lib/prisma";

export class LHRSInputError extends Error {}

export const DEFAULT_SNAPPING_DISTANCE = 50;
export const MAX_SNAPPING_DISTANCE = 5000;

export interface LHRSVersion {
  lhrs_version_title: string;
  lhrs_version: string;
  current: boolean;
}

export interface LHRSPointResult {
  longitude_in: number;
  latitude_in: number;
  hwy: string;
  m_distance: number;
  lhrs_version: string;
  basepoint: number;
  lhrs_offset: number;
  snapping_distance: number;
  rank: number;
  clrs_route: string | null;
  clrs_measurement: number | null;
  smartcl_twp: string | null;
  smartcl_route: string | null;
  smartcl_chainage: string | null;
  smartcl_chainage_orientation: string | null;
}

export interface LHRSLinearResult {
  /** GeoJSON geometry string in EPSG:3857 */
  geom: string | null;
  section_length: number;
}

type Body = Record<string, unknown>;

function num(body: Body, key: string): number {
  const value = body[key];
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    throw new LHRSInputError(`"${key}" is required.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw new LHRSInputError(`"${key}" must be a number.`);
  return n;
}

function str(body: Body, key: string): string {
  const value = body[key];
  if (value === null || value === undefined || !String(value).trim()) {
    throw new LHRSInputError(`"${key}" is required.`);
  }
  return String(value).trim();
}

function common(body: Body): { version: string; snap: number } {
  const version = str(body, "version");
  const snap = Math.trunc(Number(body.snappingDistance ?? DEFAULT_SNAPPING_DISTANCE));
  if (!Number.isFinite(snap) || snap <= 0 || snap > MAX_SNAPPING_DISTANCE) {
    throw new LHRSInputError(`"snappingDistance" must be between 1 and ${MAX_SNAPPING_DISTANCE}.`);
  }
  return { version, snap };
}

export async function getVersions(): Promise<LHRSVersion[]> {
  return prisma.$queryRaw<LHRSVersion[]>`
    SELECT lhrs_version_title::text, lhrs_version::text, "current"::boolean AS current
    FROM lhrs.lhrs_version
    ORDER BY "current" DESC, lhrs_version_title DESC`;
}

// Invoked as a table function: `FROM postgisftw.lhrs_by_xxx(...) r`
const POINT_COLUMNS = `
  r.longitude_in::float8 AS longitude_in, r.latitude_in::float8 AS latitude_in, r.hwy,
  r.m_distance::float8 AS m_distance, r.lhrs_version, r.basepoint::int AS basepoint,
  r.lhrs_offset::float8 AS lhrs_offset, r.snapping_distance::int AS snapping_distance, r.rank::int AS rank,
  r.clrs_route, r.clrs_measurement::float8 AS clrs_measurement,
  r.smartcl_twp, r.smartcl_route, r.smartcl_chainage, r.smartcl_chainage_orientation`;

export async function byXYMulti(body: Body): Promise<LHRSPointResult[]> {
  const { version, snap } = common(body);
  const long = num(body, "long");
  const lat = num(body, "lat");
  return prisma.$queryRawUnsafe<LHRSPointResult[]>(
    `SELECT ${POINT_COLUMNS} FROM postgisftw.lhrs_by_xy_multiple($1::text, $2::int, $3::numeric, $4::numeric) r`,
    version,
    snap,
    long,
    lat,
  );
}

export async function byBasepoint(body: Body): Promise<LHRSPointResult | null> {
  const { version, snap } = common(body);
  const basepoint = num(body, "basepoint");
  const offset = num(body, "offset");
  const rows = await prisma.$queryRawUnsafe<LHRSPointResult[]>(
    `SELECT ${POINT_COLUMNS} FROM postgisftw.lhrs_by_bpoint($1::text, $2::int, $3::numeric, $4::numeric) r LIMIT 1`,
    version,
    snap,
    basepoint,
    offset,
  );
  return rows[0] ?? null;
}

export async function byMDistance(body: Body): Promise<LHRSPointResult | null> {
  const { version, snap } = common(body);
  const hwy = str(body, "hwy");
  const distance = num(body, "distance");
  const rows = await prisma.$queryRawUnsafe<LHRSPointResult[]>(
    `SELECT ${POINT_COLUMNS} FROM postgisftw.lhrs_by_m_distance($1::text, $2::int, $3::text, $4::numeric) r LIMIT 1`,
    version,
    snap,
    hwy,
    distance,
  );
  return rows[0] ?? null;
}

export async function linearByMDistance(body: Body): Promise<LHRSLinearResult | null> {
  const { version, snap } = common(body);
  const hwy = str(body, "hwy");
  const fromDistance = num(body, "fromDistance");
  const toDistance = num(body, "toDistance");
  const rows = await prisma.$queryRawUnsafe<LHRSLinearResult[]>(
    `SELECT r.geom::text AS geom, r.section_length::float8 AS section_length
     FROM postgisftw.lhrs_linear_by_m_distance($1::text, $2::int, $3::text, $4::numeric, $5::numeric) r LIMIT 1`,
    version,
    snap,
    hwy,
    fromDistance,
    toDistance,
  );
  return rows[0] ?? null;
}

export const LOOKUPS = {
  by_xy_multi: byXYMulti,
  by_basepoint: byBasepoint,
  by_m_distance: byMDistance,
  linear_by_m_distance: linearByMDistance,
} as const;

export type LHRSLookup = keyof typeof LOOKUPS;
