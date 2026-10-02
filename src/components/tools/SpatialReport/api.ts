/**
 * Client for py-Geomatics' spatial reporting API (app.gis_reports), ported from the legacy
 * SimcoeCountyWebViewer helpers/reportHelpers.js.
 *
 * Reached same-origin through the /geomatics rewrite (next.config.ts), so the py-Geomatics
 * session cookie is sent automatically - none of the legacy cross-origin credentials/CORS
 * workarounds apply. Every endpoint is @login_required: an anonymous caller gets a JSON 401
 * (the X-Requested-With header makes py-Geomatics answer with JSON instead of redirecting to its
 * login page), surfaced here as ReportAuthError so the UI can show the sign-in prompt.
 */

import { GEOMATICS_PATH } from "@/stores/imapAuthStore";
import type { MapFilterResult } from "@/utils/mapFilter";

export class ReportAuthError extends Error {}

export interface ReportableLayer {
  qualified_name: string;
  title: string;
  workspace?: string;
  geometry_type?: string;
}

export interface LayerFieldInfo {
  qualified_name: string;
  output_fields: { name: string; format?: string }[];
  filterable_fields: string[];
}

export interface PreviewResult {
  total_features: number;
  per_layer_counts: Record<string, number>;
  rejected_layers?: string[];
  severity: "none" | "info" | "confirm" | "block_unless_admin" | "require_async";
  message?: string;
}

export interface TableResult {
  columns: string[];
  rows: Record<string, unknown>[];
  grouped: boolean;
  truncated: boolean;
  returned_rows: number;
  total_features: number;
  aggregate_rows?: Record<string, unknown>[];
  aggregate_labels?: string[];
}

export interface JobStatus {
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  stage?: string;
  stage_index?: number;
  stage_count?: number;
  layer_index?: number;
  layer_count?: number;
  features_done?: number;
  total_features?: number;
  group_count?: number;
  error?: string;
}

export type ExportFormat = "xlsx" | "gpkg" | "kml" | "geojson";

const XHR_HEADERS = { "X-Requested-With": "XMLHttpRequest" };
const apiUrl = (path: string) => `${GEOMATICS_PATH}/gis_reports/api/${path}`;

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    // 'message' is the human-readable text; 'error' is sometimes a machine sentinel (e.g. 'unauthorized')
    return data.message || data.error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(path), {
    credentials: "same-origin",
    ...init,
    headers: { ...XHR_HEADERS, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  if (res.status === 401) throw new ReportAuthError(await errorMessage(res));
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.json();
}

const postJson = <T>(path: string, body: unknown, signal?: AbortSignal) => request<T>(path, { method: "POST", body: JSON.stringify(body), signal });

// py-Geomatics' routes.MAX_LAYERS_PER_REQUEST - more names than this in one call is a 400
const MAX_LAYERS_PER_REQUEST = 25;

/** Layers the caller may report on, restricted to the given (visible) qualified layer names */
export async function getReportableLayers(visibleLayerNames: string[]): Promise<ReportableLayer[]> {
  if (visibleLayerNames.length === 0) return [];
  const batches: string[][] = [];
  for (let i = 0; i < visibleLayerNames.length; i += MAX_LAYERS_PER_REQUEST) batches.push(visibleLayerNames.slice(i, i + MAX_LAYERS_PER_REQUEST));
  const results = await Promise.all(
    batches.map((batch) => {
      const params = new URLSearchParams();
      batch.forEach((name) => params.append("layers", name));
      return request<ReportableLayer[]>(`reportable-layers?${params.toString()}`);
    }),
  );
  return results.flat();
}

export const getLayerFields = (qualifiedName: string) => request<LayerFieldInfo>(`layer-fields?layer=${encodeURIComponent(qualifiedName)}`);

export const getExportFormats = () => request<{ gdal_available: boolean }>("export-formats");

export const previewReport = (payload: object) => postJson<PreviewResult>("preview", payload);

/** Per-layer CQL_FILTER + combined extent for Filter Map and saved-filter stars (see utils/mapFilter.ts) */
export const buildMapFilter = (payload: object, signal?: AbortSignal) => postJson<MapFilterResult>("map-filter", payload, signal);

export const fetchReportTable = (payload: object) => postJson<TableResult>("table", payload);

export const startReportJob = (payload: object) => postJson<{ job_id: number }>("generate", payload);

export const getJobStatus = (jobId: number) => request<JobStatus>(`generate/${jobId}/status`);

export const cancelJob = (jobId: number) => request<unknown>(`generate/${jobId}/cancel`, { method: "POST" });

// Mirrors py-Geomatics' routes._DOWNLOAD_RESPONSE_BY_EXTENSION. GeoJSON is always zipped
// server-side (one file per report layer).
export const DOWNLOAD_FILENAME: Record<ExportFormat, string> = {
  xlsx: "SpatialReport.xlsx",
  gpkg: "SpatialReport.gpkg",
  kml: "SpatialReport.kml",
  geojson: "SpatialReport.zip",
};

export async function downloadJob(jobId: number, format: ExportFormat): Promise<void> {
  const res = await fetch(apiUrl(`generate/${jobId}/download`), { credentials: "same-origin", headers: XHR_HEADERS });
  if (res.status === 401) throw new ReportAuthError(await errorMessage(res));
  if (!res.ok) throw new Error(await errorMessage(res));
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = DOWNLOAD_FILENAME[format];
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
