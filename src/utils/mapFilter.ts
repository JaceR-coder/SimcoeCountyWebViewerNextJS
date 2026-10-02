/**
 * "Filter Map" and saved-layer-filter map effects for the Spatial Tool, ported from the legacy
 * SimcoeCountyWebViewer helpers/mapFilterHelpers.js.
 *
 * Applies the CQL_FILTER strings from py-Geomatics' POST /gis_reports/api/map-filter to the WMS
 * layers already on the map, for this browser tab only - never writes to GeoServer or the layer
 * definitions. Clearing restores each layer's source exactly as it was.
 *
 * Much simpler than legacy: legacy's operational layers were tiled (TileWMS through GeoWebCache,
 * which ignores CQL_FILTER), so it had to swap each one for a freshly built ImageLayer. GeoServer
 * TOC layers here are already ImageWMS (tocStore.initializeOpenLayersLayers), so the filter is just
 * a CQL_FILTER param on the existing source - the TOC/LayerManager keep their layer references.
 *
 * Filtered sources load by POST (params in the body): a reference-layer scope's CQL embeds a
 * geometry literal that can run to hundreds of KB, well past what a GET URL survives. The
 * /geoserver-proxy route and py-Geomatics' proxy both accept POST for this.
 */

import proj4 from "proj4";
import { register } from "ol/proj/proj4";
import { get as getProjection, transformExtent } from "ol/proj";
import { isEmpty as isEmptyExtent } from "ol/extent";
import type ImageWMS from "ol/source/ImageWMS";
import type { LoadFunction } from "ol/Image";
import type { AxiosInstance, AxiosRequestConfig } from "axios";
import { useLayerManagerStore, type ManagedLayer } from "@/stores/layerManagerStore";
import { useTOCStore } from "@/stores/tocStore";
import { useLayerFilterStore } from "@/stores/layerFilterStore";

export interface MapFilterTarget {
  layer: string;
  cql_filter: string | null;
  matched_count: number;
}

export interface MapFilterResult {
  targets: MapFilterTarget[];
  combined_extent: number[] | null;
  working_srid: number;
}

/**
 * `workspace:layer` for a TOC layer, or undefined for non-GeoServer layers. A source whose name is
 * also a GeoServer workspace (road_interests, property, traffic, ...) is served as that workspace's
 * virtual service, whose capabilities list names WITHOUT the prefix (`connecting_links`), so the
 * workspace is recovered from the source URL (`.../road_interests/ows`). Layer-group-only
 * sources (LHRS, Pavement, ...) already return qualified names.
 */
export function qualifiedLayerName(l: Pick<ManagedLayer, "name" | "metadata">): string | undefined {
  if (!l.name) return undefined;
  if (l.name.includes(":")) return l.name;
  const groupUrl = l.metadata?.groupUrl;
  const segments = typeof groupUrl === "string" ? groupUrl.split("?")[0].split("/") : [];
  const i = segments.findIndex((seg) => seg === "geoserver" || seg === "geoserver-proxy");
  const workspace = i >= 0 && ["ows", "wms"].includes(segments[i + 2]?.toLowerCase()) ? segments[i + 1] : undefined;
  return workspace ? `${decodeURIComponent(workspace)}:${l.name}` : undefined;
}

/** Every TOC map layer for a qualified name - the same layer can sit in several TOC groups */
function tocLayersNamed(qualifiedName: string): ManagedLayer[] {
  return useLayerManagerStore.getState().layers.TOC.filter((l) => qualifiedLayerName(l) === qualifiedName);
}

function wmsSource(l: ManagedLayer): ImageWMS | undefined {
  const source = (l.layer as unknown as { getSource?: () => unknown }).getSource?.() as ImageWMS | undefined;
  // updateParams + setImageLoadFunction = ImageWMS; anything else (vector, tiles, ArcGIS) is skipped
  return source && typeof source.updateParams === "function" && typeof source.setImageLoadFunction === "function" ? source : undefined;
}

// What each touched source looked like before its first filter, keyed by source so re-filtering
// still restores the true original
const originals = new Map<ImageWMS, { cql: unknown; loader: LoadFunction }>();
let originalView: { center?: number[]; zoom?: number } | undefined;

/** GetMap by POST (params in the body) - see module docstring */
export const postImageLoadFunction: LoadFunction = (image, src) => {
  const [base, query = ""] = src.split("?");
  fetch(base, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: query })
    .then((res) => {
      if (!res.ok) throw new Error(`WMS request failed: ${res.status}`);
      return res.blob();
    })
    .then((blob) => {
      const img = (image as unknown as { getImage: () => HTMLImageElement }).getImage();
      const objectUrl = URL.createObjectURL(blob);
      img.addEventListener("load", () => URL.revokeObjectURL(objectUrl), { once: true });
      img.src = objectUrl;
    })
    .catch((err) => console.warn("[mapFilter] filtered WMS request failed:", err));
};

function filterSource(source: ImageWMS, secured: boolean, cql: string) {
  if (!originals.has(source)) originals.set(source, { cql: source.getParams().CQL_FILTER, loader: source.getImageLoadFunction() });
  // Secured layers keep their own authenticated loader (GET) rather than losing auth to the POST one
  if (!secured) source.setImageLoadFunction(postImageLoadFunction);
  source.updateParams({ CQL_FILTER: cql });
}

function restoreSource(source: ImageWMS) {
  const original = originals.get(source);
  if (!original) return;
  source.setImageLoadFunction(original.loader);
  // updateParams merges, and OL drops undefined params from the request URL
  source.updateParams({ CQL_FILTER: original.cql });
  originals.delete(source);
}

/** Filter (or, with a null cql, unfilter) every map layer with this qualified name */
function setLayerCql(qualifiedName: string, cql: string | null): boolean {
  let applied = false;
  for (const l of tocLayersNamed(qualifiedName)) {
    const source = wmsSource(l);
    if (!source) continue;
    if (cql) filterSource(source, !!l.metadata?.secured, cql);
    else restoreSource(source);
    applied = true;
  }
  return applied;
}

function ensureProjection(srid: number): string {
  const code = `EPSG:${srid}`;
  if (!getProjection(code) && srid === 26917) {
    proj4.defs(code, "+proj=utm +zone=17 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs");
    register(proj4);
  }
  return code;
}

/**
 * Applies a whole Filter Map result and zooms to the matches. Returns true if the map was zoomed,
 * false when there was nothing to zoom to (callers then say "no features match").
 */
export function applyMapFilter(result: MapFilterResult): boolean {
  const map = window.map;
  if (!map) return false;
  if (!originalView) originalView = { center: map.getView().getCenter(), zoom: map.getView().getZoom() };

  result.targets.forEach((t) => setLayerCql(t.layer, t.cql_filter));
  useLayerFilterStore.getState().setMapFilterActive(originals.size > 0);

  if (!result.combined_extent) return false;
  const extent = transformExtent(result.combined_extent, ensureProjection(result.working_srid), "EPSG:3857");
  if (!extent || isEmptyExtent(extent) || !extent.every(Number.isFinite)) return false;
  map.getView().fit(extent, { duration: 800, maxZoom: 18 });
  return true;
}

/** Undoes every filter (Filter Map and saved-filter stars) and returns to the pre-filter view */
export function clearMapFilter() {
  Array.from(originals.keys()).forEach(restoreSource);
  useLayerFilterStore.getState().clearActive();
  const map = window.map;
  if (originalView && map) map.getView().animate({ center: originalView.center, zoom: originalView.zoom, duration: 500 });
  originalView = undefined;
}

/** Saved-filter star: filter one layer, turning it on if needed. Deliberately doesn't zoom. */
export function applyLayerFilter(qualifiedName: string, cql: string, filterId: string): boolean {
  ensureLayerVisible(qualifiedName);
  if (!setLayerCql(qualifiedName, cql)) return false;
  useLayerFilterStore.getState().setActiveFilter(qualifiedName, filterId);
  return true;
}

/** Clears just this layer's filter, leaving every other layer and the view alone */
export function clearLayerFilter(qualifiedName: string) {
  setLayerCql(qualifiedName, null);
  useLayerFilterStore.getState().setActiveFilter(qualifiedName, undefined);
  if (originals.size === 0) useLayerFilterStore.getState().setMapFilterActive(false);
}

/** Turns on the TOC layer(s) with this qualified name. Returns false if it isn't in the TOC at all. */
export function ensureLayerVisible(qualifiedName: string): boolean {
  const ids = new Set(tocLayersNamed(qualifiedName).map((l) => l.id));
  if (ids.size === 0) return false;
  const toc = useTOCStore.getState();
  const tocLayer = toc.allLayers.find((l) => l.managedLayerId && ids.has(l.managedLayerId));
  if (tocLayer && !tocLayer.visible) toc.updateLayerVisibilityById(tocLayer.id, true);
  return true;
}

// Past this a GET URL risks being silently dropped by the browser/proxy/GeoServer
const MAX_GET_URL = 4000;

/**
 * GET a WMS URL, or POST it (params in the body) when it's too long - GetFeatureInfo on a filtered
 * layer carries the same possibly-huge CQL_FILTER that GetMap does.
 */
export function wmsRequest<T = unknown>(client: AxiosInstance, url: string, config: AxiosRequestConfig = {}) {
  if (url.length <= MAX_GET_URL) return client.get<T>(url, config);
  const [base, query = ""] = url.split("?");
  return client.post<T>(base, query, { ...config, headers: { ...(config.headers || {}), "Content-Type": "application/x-www-form-urlencoded" } });
}
