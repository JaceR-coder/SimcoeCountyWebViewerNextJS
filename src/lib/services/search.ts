/**
 * Search service - backed by the legacy i-Map's search index, web_search.tbl_search_ts_mv in
 * ner_master (~1.5M addresses, lots/concessions, title records, chainage, MTO structures, contracts,
 * LHRS points, ... across ~37 types), with the same ranked query the legacy SimcoeCountyWebApi
 * helpers/search.js runs, plus an Open Street Map fallback.
 *
 * Replaces this app's original Simcoe County version, which queried public.tbl_search in a
 * "tabular" database that doesn't exist here, and a Simcoe-only ESRI address geocoder. Map layers,
 * tools and themes are still matched client-side in components/Search.tsx.
 *
 * Maintained on the database side: the materialized view unions 16 web_search source views and is
 * refreshed there; this module only reads it (and web_search.tbl_search_layers).
 */
import { prisma } from "@/lib/prisma";
import searchConfig from "./searchConfig.json";

const viewBox = searchConfig.OSMViewBox;
const useOSMSearch = searchConfig.useOSMSearch;

const osmUrlWithViewBox = (vb: string, limit: number, keywords: string) =>
  `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
    format: "json",
    addressdetails: "1",
    countrycodes: "ca",
    viewbox: vb,
    bounded: "1",
    limit: String(limit),
    q: keywords,
  }).toString()}`;

// ── Shared interfaces ──────────────────────────────────────────────

export interface SearchRow {
  name: string;
  type: string;
  /** Second line of the result, e.g. "Pavement Section : FROM - Hwy 560 TO - ..." */
  description?: string | null;
  municipality?: string;
  location_id: string | null;
  x?: number;
  y?: number;
  place_id?: string;
  geojson?: string;
  geojson_point?: string;
  geojson_extent?: string;
  /** "workspace:layer@TOC group,..." to turn on for this result type (web_search.tbl_search_layers) */
  assoc_layers?: string | null;
}

const MAX_LIMIT = 100;

// ── Helpers ─────────────────────────────────────────────────────────

function toTitleCase(str: string | undefined): string {
  if (!str) return "";
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
}

/**
 * to_tsquery_partial() splits on whitespace and joins with & - tsquery operators typed by the user
 * (& | ! ( ) : * ' < > \) would make it throw a syntax error instead of just not matching.
 */
export const toTsQueryText = (value: string) => value.replace(/[&|!():*'<>\\]/g, " ").replace(/\s+/g, " ").trim();

async function getJSON<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  try {
    const headers = new Headers(init?.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    const response = await fetch(url, { ...init, headers });
    const body = (await response.text()).trim().replace(/^﻿/, "");
    if (!response.ok) {
      console.error(`getJSON request failed (${response.status}): ${url}`);
      return {} as T;
    }
    if (!body.startsWith("{") && !body.startsWith("[")) return {} as T;
    return JSON.parse(body) as T;
  } catch (error) {
    console.error("getJSON error:", error);
    return {} as T;
  }
}

// ── Search functions ────────────────────────────────────────────────

/**
 * Main search - ranked index search, then Open Street Map when that finds nothing (or when asked
 * for). `muni` is accepted for API compatibility; the index has no municipality column.
 */
export async function search(keywords: string, type: string | undefined, _muni: string | undefined, limit: number = 10): Promise<SearchRow[]> {
  void _muni;
  try {
    if (!keywords || keywords.trim().length < 2) return [];
    const safeLimit = Math.min(Math.max(1, Number.isFinite(limit) ? limit : 10), MAX_LIMIT);
    const typeFilter = !type || type === "All" || type === "undefined" ? null : type;

    const results: SearchRow[] = typeFilter === "Open Street Map" ? [] : await searchIndex(keywords.trim(), typeFilter, safeLimit);

    // Legacy behaviour: OSM fills in only when the index found nothing, or when asked for directly
    if ((useOSMSearch && results.length === 0 && (!typeFilter || typeFilter === "Open Street Map")) || typeFilter === "Open Street Map") {
      results.push(...(await searchOsm(keywords, safeLimit - results.length)));
    }
    return results;
  } catch (error) {
    console.error("Search error:", error);
    return [];
  }
}

/**
 * The legacy ranked query (SimcoeCountyWebApi helpers/search.js _search): short strings are a quick
 * prefix match; 5+ characters rank prefix > contains > description contains > full-text.
 */
async function searchIndex(value: string, type: string | null, limit: number): Promise<SearchRow[]> {
  if (value.length < 5) {
    return prisma.$queryRaw<SearchRow[]>`
      SELECT title AS "name", description, type, location_id::text AS location_id
      FROM web_search.tbl_search_ts_mv
      WHERE title ILIKE ${value} || '%'
        AND (${type}::text IS NULL OR type = ${type})
      ORDER BY "name"
      LIMIT ${limit}`;
  }

  const tsText = toTsQueryText(value);
  if (!tsText) return [];
  return prisma.$queryRaw<SearchRow[]>`
    SELECT title AS "name", description, type, location_id::text AS location_id
    FROM (
      SELECT title, description, type, location_id,
        CASE WHEN title ILIKE ${value} || '%' THEN 1
             WHEN title ILIKE '%' || ${value} || '%' THEN 0.9
             WHEN description ILIKE '%' || ${value} || '%' THEN 0.8
             ELSE ts_rank_cd(ts, query) END AS rank
      FROM web_search.tbl_search_ts_mv, public.to_tsquery_partial(${tsText}) query
      WHERE (ts @@ query OR title ILIKE '%' || ${value} || '%' OR description ILIKE '%' || ${value} || '%')
        AND (${type}::text IS NULL OR type = ${type})
    ) ranked
    ORDER BY rank DESC, "name"
    LIMIT ${limit}`;
}

/**
 * One result's full geometry (EPSG:3857 GeoJSON strings) and the layers its type turns on.
 */
export async function searchById(id: string): Promise<SearchRow | null> {
  if (!/^\d+$/.test(id)) return null;
  const rows = await prisma.$queryRaw<SearchRow[]>`
    SELECT s.title AS "name", s.description, s.type, s.location_id::text AS location_id,
           s.geojson, s.geojson_point, s.geojson_extent, l.assoc_layers
    FROM web_search.tbl_search_ts_mv s
    LEFT JOIN web_search.tbl_search_layers l ON l.type = s.type
    WHERE s.id = ${id}::bigint
    LIMIT 1`;
  return rows[0] ?? null;
}

/**
 * The index's result types, for the type filter dropdown (legacy getSearchTypes).
 */
export async function getSearchTypes(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ type: string }[]>`SELECT type FROM web_search.tbl_search_layers WHERE type IS NOT NULL ORDER BY type`;
  return rows.map((r) => r.type);
}

// ── Open Street Map ─────────────────────────────────────────────────

async function searchOsm(keywords: string, limit: number = 10): Promise<SearchRow[]> {
  if (limit <= 0) return [];
  const osmResult = await getJSON<OsmResult[]>(osmUrlWithViewBox(viewBox, limit, keywords), {
    headers: { "User-Agent": "SimcoeCountyWebViewerNextJS", "Accept-Language": "en" },
  });
  if (!Array.isArray(osmResult)) return [];
  return osmResult.map((osm) => ({
    name: osm.display_name,
    type: toTitleCase(osm.type + " - Open Street Map"),
    municipality: toTitleCase(osm.address?.city ?? osm.address?.town ?? ""),
    location_id: null,
    x: parseFloat(osm.lon),
    y: parseFloat(osm.lat),
    place_id: osm.place_id,
  }));
}

interface OsmResult {
  display_name: string;
  type: string;
  lat: string;
  lon: string;
  place_id: string;
  address: { city?: string; town?: string };
}
