/**
 * LHRS API client - talks to this app's own /api/public/lhrs/* routes
 * (src/app/api/public/lhrs, backed by src/lib/services/lhrs.ts).
 */

import { basePath } from "@/lib/axiosInstance";
import type { LHRSVersion, LHRSPointResult, LHRSLinearResult } from "@/lib/services/lhrs";

export type { LHRSVersion, LHRSPointResult, LHRSLinearResult };

interface BaseRequest {
  version: string;
  snappingDistance: number;
}

export const DEFAULT_LHRS_API_URL = "/api/public/lhrs";

export function resolveApiUrl(url: string | undefined): string {
  const base = (url || DEFAULT_LHRS_API_URL).replace(/\/+$/, "");
  return base.startsWith("/") && !base.startsWith("//") ? `${basePath}${base}` : base;
}

async function post<T>(apiUrl: string, path: string, body: object): Promise<T | null> {
  const res = await fetch(`${apiUrl}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `LHRS request failed (${res.status})`);
  return (json.result ?? null) as T | null;
}

export async function getVersions(apiUrl: string): Promise<LHRSVersion[]> {
  const res = await fetch(`${apiUrl}/versions`);
  if (!res.ok) throw new Error(`LHRS version lookup failed (${res.status})`);
  return res.json();
}

export const byXYMulti = (apiUrl: string, req: BaseRequest & { lat: number; long: number }) =>
  post<LHRSPointResult[]>(apiUrl, "by_xy_multi", req).then((r) => r ?? []);

export const byBasepoint = (apiUrl: string, req: BaseRequest & { basepoint: number; offset: number }) =>
  post<LHRSPointResult>(apiUrl, "by_basepoint", req);

export const byMDistance = (apiUrl: string, req: BaseRequest & { hwy: string; distance: number }) =>
  post<LHRSPointResult>(apiUrl, "by_m_distance", req);

export const linearByMDistance = (apiUrl: string, req: BaseRequest & { hwy: string; fromDistance: number; toDistance: number }) =>
  post<LHRSLinearResult>(apiUrl, "linear_by_m_distance", req);

/**
 * lhrs_by_xy_multiple returns one row per nearby route segment, so a click near an
 * interchange or a concurrent section (e.g. Hwy 11 / 400A) can yield the same
 * highway several times. Keep only the closest row per highway, closest first.
 */
export function dedupeByHwy(rows: LHRSPointResult[]): LHRSPointResult[] {
  const best = new Map<string, LHRSPointResult>();
  for (const row of rows) {
    const current = best.get(row.hwy);
    if (!current || row.snapping_distance < current.snapping_distance || (row.snapping_distance === current.snapping_distance && row.rank < current.rank)) {
      best.set(row.hwy, row);
    }
  }
  return [...best.values()].sort((a, b) => a.snapping_distance - b.snapping_distance || a.rank - b.rank);
}

export function buildSmartCLReportUrl(
  config: { report_url: string; params: Record<"startX" | "startY" | "endX" | "endY" | "hwy", string> },
  a: { lat: number; long: number },
  b: { lat: number; long: number },
  hwy: string,
): string {
  const p = config.params;
  const qs = new URLSearchParams({
    [p.startX]: String(a.lat),
    [p.startY]: String(a.long),
    [p.endX]: String(b.lat),
    [p.endY]: String(b.long),
    [p.hwy]: hwy,
  });
  return `${config.report_url}?${qs.toString()}`;
}
