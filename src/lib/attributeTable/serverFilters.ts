/**
 * Attribute-table column filters, pushed to the server
 * ----------------------------------------------------------------------------
 * The grid's column filters used to run only over rows already loaded (at most
 * the row cap), so a match at row 5,000 never showed up. These builders turn
 * them into a WFS CQL_FILTER / ArcGIS `where` so the server returns matches
 * from the whole layer.
 *
 * Every server filter is a SUPERSET of the grid's own matcher
 * (`matchesColumnFilter`, which still runs over the loaded rows): when the
 * server can't reproduce the displayed text exactly, the filter is loosened or
 * left to the client rather than risk dropping rows the user would see.
 *  - text / numbers: case-insensitive substring of the value cast to text
 *    (numbers display as String(value), which matches Postgres' text cast).
 *  - dates: only the leading `YYYY[-MM[-DD]]` part of the input. The grid shows
 *    UTC "YYYY-MM-DD HH:mm:ss" but Postgres casts timestamps in its own time
 *    zone, so times can't be matched server-side.
 *  - booleans (shown as Yes/No) and anything else: client-only.
 */

import type { ColumnSchema } from "./columnarStore";
import { getFieldDomain, type ArcgisCodedValue } from "@/utils/arcgisFieldMetadata";

export type FilterMap = Record<string, string>;

const DATE_PREFIX = /^\d{4}(?:-\d{1,2}(?:-\d{1,2})?)?/;

/** Quote a CQL identifier (field names may be mixed case or contain spaces). */
function cqlIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function cqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** The text to match server-side for one column, or null to leave it to the client. */
function serverNeedle(type: ColumnSchema["type"] | undefined, value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (type === "boolean") return null;
  if (type === "date") return DATE_PREFIX.exec(v)?.[0] ?? null;
  return v;
}

/**
 * WFS CQL for the column filters, AND-ed with the map-extent box when given.
 * GeoServer rejects `bbox` and `CQL_FILTER` together, so once there is any CQL
 * the box has to move inside it - which needs the geometry field's name.
 * Returns undefined when there's nothing to send as CQL (the caller then uses
 * the plain `bbox` parameter, if any).
 */
export function buildWfsCql(
  filters: FilterMap,
  schema: ColumnSchema[] | null,
  options: { bbox?: [number, number, number, number]; geometryField?: string | null; srsName?: string } = {},
): string | undefined {
  const parts: string[] = [];
  for (const [field, value] of Object.entries(filters)) {
    const col = schema?.find((c) => c.name === field);
    const needle = serverNeedle(col?.type, value);
    if (needle === null) continue;
    parts.push(`strToLowerCase(${cqlIdent(field)}) LIKE ${cqlString(`%${needle}%`)}`);
  }
  if (parts.length === 0) return undefined;
  if (options.bbox && options.geometryField) {
    parts.push(`BBOX(${cqlIdent(options.geometryField)}, ${options.bbox.join(", ")}, ${cqlString(options.srsName ?? "EPSG:3857")})`);
  }
  return parts.join(" AND ");
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Codes whose displayed name or raw code contains the filter text (what the grid matches on). */
function matchingCodes(codedValues: ArcgisCodedValue[], needle: string): Array<string | number> {
  return codedValues.filter((cv) => cv.name.toLowerCase().includes(needle) || String(cv.code).toLowerCase().includes(needle)).map((cv) => cv.code);
}

/**
 * ArcGIS `where` for the column filters. Text fields use UPPER(...) LIKE;
 * coded-value domain fields match by code (the grid shows the domain name, so
 * the typed text is resolved to the codes it matches). Numbers and dates are
 * left to the client: ArcGIS has no portable cast-to-text across service types.
 */
export function buildArcgisWhere(filters: FilterMap, schema: ColumnSchema[] | null, domains: Record<string, ArcgisCodedValue[]> | null): string | undefined {
  const parts: string[] = [];
  for (const [field, value] of Object.entries(filters)) {
    const needle = value.trim().toLowerCase();
    if (!needle) continue;
    const codedValues = getFieldDomain(domains, field);
    if (codedValues) {
      const codes = matchingCodes(codedValues, needle);
      parts.push(codes.length === 0 ? "1=0" : `${field} IN (${codes.map((c) => (typeof c === "number" ? String(c) : sqlString(c))).join(", ")})`);
      continue;
    }
    const col = schema?.find((c) => c.name === field);
    if (col?.type === "string") parts.push(`UPPER(${field}) LIKE ${sqlString(`%${needle.toUpperCase()}%`)}`);
  }
  return parts.length > 0 ? parts.join(" AND ") : undefined;
}

/**
 * Column filters a WFS server request can't apply exactly (booleans, or a date
 * filter with more than a date part) - shown on "Export all matching", whose
 * file comes straight from the server without the grid's own matching pass.
 */
export function inexactWfsFilterFields(filters: FilterMap, schema: ColumnSchema[] | null): string[] {
  const out: string[] = [];
  for (const [field, value] of Object.entries(filters)) {
    const v = value.trim().toLowerCase();
    if (!v) continue;
    const col = schema?.find((c) => c.name === field);
    if (serverNeedle(col?.type, value) !== v) out.push(col?.alias ?? field);
  }
  return out;
}
