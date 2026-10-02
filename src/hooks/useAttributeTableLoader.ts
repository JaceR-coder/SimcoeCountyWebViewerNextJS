/**
 * useAttributeTableLoader
 * ----------------------------------------------------------------------------
 * Orchestrates WFS fetching for the currently active attribute-table tab.
 *
 * Flow:
 *   1. On tab open: `DescribeFeatureType` + `GetFeature(resultType=hits)` in
 *      parallel. This gives us the real schema and a total count before any
 *      row data is loaded.
 *   2. Pick an implicit `sortBy` field (used for paging when the user has no
 *      explicit sort). This is how we handle layers without a primary key —
 *      GeoServer's WFS refuses `startIndex` without an ordering.
 *   3. First page + every subsequent page always sends `sortBy`. If GeoServer
 *      still returns the "natural order without a primary key" exception, we
 *      retry with the first attribute as a safety net.
 *   4. On sort/filter/bbox change: abort in-flight, reload from page 0.
 *      Column filters go to the server (serverFilters.ts) so they match the
 *      whole layer, not just the rows already loaded.
 *   5. On close/unmount: abort pending requests.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAttributeTableStore, ATTRIBUTE_TABLE_DEFAULTS, selectActiveTab, type AttributeTableTab } from "@/stores/attributeTableStore";
import { useMapStore } from "@/stores/mapStore";
import { describeFeatureType, fetchWfsCount, fetchWfsPage, pickImplicitSortField, WfsPrimaryKeyError, type WfsFieldDescriptor } from "@/lib/attributeTable/wfs";
import { describeArcgisLayer, fetchArcgisCount, fetchArcgisPage, parseArcgisLayerUrl, pickImplicitSortFieldArcgis, ArcgisPaginationNotSupportedError } from "@/lib/attributeTable/arcgis";
import { ColumnarStore, type ColumnSchema } from "@/lib/attributeTable/columnarStore";
import type { ArcgisCodedValue } from "@/utils/arcgisFieldMetadata";
import { cacheGeometries, getCurrentMapExtent } from "@/lib/attributeTable/mapIntegration";
import { buildArcgisWhere, buildWfsCql } from "@/lib/attributeTable/serverFilters";
import { useToastStore } from "@/hooks/useToast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function schemaFromFields(fields: WfsFieldDescriptor[]): ColumnSchema[] {
  return fields.filter((f) => !f.isGeometry).map((f) => ({ name: f.name, type: f.type, alias: f.alias }));
}

function geometryFieldOf(fields: WfsFieldDescriptor[] | null): string | null {
  return fields?.find((f) => f.isGeometry)?.name ?? null;
}

function resolveSortField(userSort: { field: string; direction: "A" | "D" } | null, implicit: string | null, _fields: WfsFieldDescriptor[] | null): { field: string; direction: "A" | "D" } | null {
  if (userSort) return userSort;
  if (implicit) return { field: implicit, direction: "A" };
  // No reliable PK-like field — return null so the loader does a single
  // unpaged fetch. Returning an arbitrary non-unique field caused GeoServer
  // to fail with "cannot do natural order without a primary key".
  return null;
}

/** Issue a page fetch; if GeoServer complains about PK, retry once with a fallback sort. */
async function fetchPageWithPkSafety(args: {
  wfsUrl: string;
  typeName: string;
  startIndex: number;
  count: number;
  sortBy: { field: string; direction: "A" | "D" } | null;
  cqlFilter?: string;
  bbox?: [number, number, number, number];
  fallbackFields: WfsFieldDescriptor[] | null;
  signal: AbortSignal;
}): ReturnType<typeof fetchWfsPage> {
  try {
    return await fetchWfsPage({
      wfsUrl: args.wfsUrl,
      layerName: args.typeName,
      startIndex: args.startIndex,
      count: args.count,
      sortBy: args.sortBy ?? undefined,
      cqlFilter: args.cqlFilter,
      bbox: args.bbox,
      includeGeometry: true,
      signal: args.signal,
    });
  } catch (err) {
    if (!(err instanceof WfsPrimaryKeyError)) throw err;
    // Layer has no primary key — retry once as a single unpaged fetch. We
    // drop sortBy and startIndex entirely (GeoServer rejects startIndex
    // without a stable ordering). The caller should treat the result as
    // cap-reached so it doesn't try to page further.
    return await fetchWfsPage({
      wfsUrl: args.wfsUrl,
      layerName: args.typeName,
      count: args.count,
      cqlFilter: args.cqlFilter,
      bbox: args.bbox,
      includeGeometry: true,
      signal: args.signal,
    });
  }
}

/**
 * Describe the remote layer (schema + count) regardless of source type.
 * Returns a normalized `{ fields, total, implicitSortField }`.
 */
async function describeAndCount(
  tab: AttributeTableTab,
  signal: AbortSignal,
): Promise<{
  fields: WfsFieldDescriptor[];
  total: number;
  implicitSortField: string | null;
  supportsPagination: boolean;
  domains: Record<string, ArcgisCodedValue[]> | null;
}> {
  if (tab.sourceType === "arcgis") {
    const endpoint = parseArcgisLayerUrl(tab.wfsUrl);
    if (!endpoint) throw new Error("Could not parse ArcGIS layer URL.");
    const info = await describeArcgisLayer(endpoint, tab.secured, signal);
    const total = await fetchArcgisCount({
      endpoint,
      secured: tab.secured,
      where: buildArcgisWhere(tab.filters, tab.schema, info.domains),
      bbox: tab.bboxFilterActive ? (getCurrentMapExtent() ?? undefined) : undefined,
      signal,
    });
    return {
      fields: info.fields,
      total,
      implicitSortField: pickImplicitSortFieldArcgis(info.objectIdField),
      supportsPagination: info.supportsPagination,
      domains: info.domains,
    };
  }

  // Filters only exist once the grid has loaded, so tab.fields is known whenever they apply
  const bbox = tab.bboxFilterActive ? (getCurrentMapExtent() ?? undefined) : undefined;
  const [fields, total] = await Promise.all([
    tab.fields ? Promise.resolve(tab.fields) : describeFeatureType(tab.wfsUrl, tab.typeName, signal),
    fetchWfsCount({
      wfsUrl: tab.wfsUrl,
      layerName: tab.typeName,
      cqlFilter: buildWfsCql(tab.filters, tab.schema, { bbox, geometryField: geometryFieldOf(tab.fields) }),
      bbox,
      signal,
    }),
  ]);
  return { fields, total, implicitSortField: pickImplicitSortField(fields), supportsPagination: true, domains: null };
}

/** Unified page fetcher that dispatches by source type. */
async function fetchPage(args: {
  tab: AttributeTableTab;
  startIndex: number;
  count: number;
  sortBy: { field: string; direction: "A" | "D" } | null;
  bbox?: [number, number, number, number];
  fields: WfsFieldDescriptor[] | null;
  schema: ColumnSchema[] | null;
  filters: Record<string, string>;
  domains?: Record<string, ArcgisCodedValue[]> | null;
  objectIdField?: string;
  supportsPagination?: boolean;
  signal: AbortSignal;
}): Promise<{ features: Array<{ id?: string | number; properties: Record<string, unknown> | null; geometry?: unknown }>; numberMatched: number | null; numberReturned: number }> {
  if (args.tab.sourceType === "arcgis") {
    const endpoint = parseArcgisLayerUrl(args.tab.wfsUrl);
    if (!endpoint) throw new Error("Could not parse ArcGIS layer URL.");
    const oid = args.objectIdField ?? args.fields?.find((f) => f.isIdLike)?.name ?? "OBJECTID";
    const baseOpts = {
      endpoint,
      secured: args.tab.secured,
      objectIdField: oid,
      startIndex: args.startIndex,
      count: args.count,
      sortBy: args.sortBy ?? undefined,
      where: buildArcgisWhere(args.filters, args.schema, args.domains ?? args.tab.domains),
      bbox: args.bbox,
      includeGeometry: true,
      signal: args.signal,
    } as const;
    try {
      return await fetchArcgisPage({ ...baseOpts, supportsPagination: args.supportsPagination });
    } catch (err) {
      // Some services advertise pagination but reject our parameter combo;
      // retry once without resultOffset/orderByFields. Caller should treat
      // the result as cap-reached since a single response can't be extended.
      if (err instanceof ArcgisPaginationNotSupportedError) {
        return await fetchArcgisPage({ ...baseOpts, supportsPagination: false });
      }
      throw err;
    }
  }
  return fetchPageWithPkSafety({
    wfsUrl: args.tab.wfsUrl,
    typeName: args.tab.typeName,
    startIndex: args.startIndex,
    count: args.count,
    sortBy: args.sortBy,
    cqlFilter: buildWfsCql(args.filters, args.schema, { bbox: args.bbox, geometryField: geometryFieldOf(args.fields) }),
    bbox: args.bbox,
    fallbackFields: args.fields,
    signal: args.signal,
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAttributeTableLoader(): { loadMore: () => Promise<void>; reload: () => Promise<void> } {
  const active = useAttributeTableStore(selectActiveTab);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = active?.layerId ?? null;

  const runReload = useCallback(async (layerId: string) => {
    const state = useAttributeTableStore.getState();
    const tab = state.tabs.find((t) => t.layerId === layerId);
    if (!tab) return;
    if (!tab.wfsUrl) {
      state.setError(layerId, "Layer has no query URL configured.");
      return;
    }
    if (tab.sourceType === "wfs" && !tab.typeName) {
      state.setError(layerId, "Layer has no typeName configured.");
      return;
    }

    tab.abortController?.abort();
    const ctrl = new AbortController();
    state.setAbortController(layerId, ctrl);
    state.setLoading(layerId, true);
    state.setError(layerId, null);

    const bbox = tab.bboxFilterActive ? (getCurrentMapExtent() ?? undefined) : undefined;

    try {
      const { fields, total, implicitSortField, supportsPagination, domains } = await describeAndCount(tab, ctrl.signal);

      const schema = schemaFromFields(fields);
      const effectiveSort = supportsPagination ? resolveSortField(tab.sort, implicitSortField, fields) : null;

      const page = await fetchPage({
        tab,
        startIndex: 0,
        count: ATTRIBUTE_TABLE_DEFAULTS.pageSize,
        sortBy: effectiveSort,
        bbox,
        fields,
        schema,
        filters: tab.filters,
        domains,
        objectIdField: implicitSortField ?? undefined,
        supportsPagination,
        signal: ctrl.signal,
      });

      const effectiveTotal = total || page.numberMatched || page.numberReturned;
      const store = new ColumnarStore(schema, Math.min(Math.max(effectiveTotal, page.numberReturned), ATTRIBUTE_TABLE_DEFAULTS.rowCap));
      store.appendPage(page.features);
      cacheGeometries(layerId, page.features);
      // If we couldn't establish a stable ordering, or the server doesn't
      // support pagination at all, the request went out without
      // startIndex/sortBy — don't try to page any further.
      const unpaged = !supportsPagination || effectiveSort === null;
      const capReached = unpaged || store.length >= ATTRIBUTE_TABLE_DEFAULTS.rowCap;

      if (ctrl.signal.aborted) return;
      const stillExists = useAttributeTableStore.getState().tabs.some((t) => t.layerId === layerId);
      if (!stillExists) {
        store.dispose();
        return;
      }

      useAttributeTableStore.getState().replaceData(layerId, {
        schema,
        fields,
        implicitSortField,
        store,
        totalCount: effectiveTotal,
        capReached,
        domains,
      });

      // Not while filtering: the banner already says so, and a toast per keystroke is noise
      if (capReached && effectiveTotal > ATTRIBUTE_TABLE_DEFAULTS.rowCap && Object.keys(tab.filters).length === 0) {
        useToastStore
          .getState()
          .addToast(
            `${tab.layerName}: ${effectiveTotal.toLocaleString()} records match — showing first ${ATTRIBUTE_TABLE_DEFAULTS.rowCap.toLocaleString()}. Zoom in to a more focused area.`,
            "warning",
            6000,
          );
      }
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof WfsPrimaryKeyError ? "This layer cannot be paged (no primary key and no sortable attribute found)." : err instanceof Error ? err.message : String(err);
      useAttributeTableStore.getState().setError(layerId, msg);
    } finally {
      const current = useAttributeTableStore.getState().tabs.find((t) => t.layerId === layerId);
      if (current && current.abortController === ctrl) {
        useAttributeTableStore.getState().setLoading(layerId, false);
      }
    }
  }, []);

  const runLoadMore = useCallback(async (layerId: string) => {
    const state = useAttributeTableStore.getState();
    const tab = state.tabs.find((t) => t.layerId === layerId);
    if (!tab || !tab.store || tab.loading || tab.capReached) return;
    if (tab.totalCount !== null && tab.loadedCount >= tab.totalCount) return;
    if (tab.abortController && !tab.abortController.signal.aborted) return;

    const ctrl = new AbortController();
    state.setAbortController(layerId, ctrl);
    state.setLoading(layerId, true);

    const bbox = tab.bboxFilterActive ? (getCurrentMapExtent() ?? undefined) : undefined;
    const sortBy = resolveSortField(tab.sort, tab.implicitSortField, tab.fields);
    const nextCount = Math.min(ATTRIBUTE_TABLE_DEFAULTS.pageSize, ATTRIBUTE_TABLE_DEFAULTS.rowCap - tab.loadedCount);

    try {
      const page = await fetchPage({
        tab,
        startIndex: tab.loadedCount,
        count: nextCount,
        sortBy,
        bbox,
        fields: tab.fields,
        schema: tab.schema,
        filters: tab.filters,
        objectIdField: tab.implicitSortField ?? undefined,
        signal: ctrl.signal,
      });

      if (ctrl.signal.aborted) return;
      const currentTab = useAttributeTableStore.getState().tabs.find((t) => t.layerId === layerId);
      if (!currentTab || currentTab.store !== tab.store) return;

      tab.store.appendPage(page.features);
      cacheGeometries(layerId, page.features);
      const capReached = tab.store.length >= ATTRIBUTE_TABLE_DEFAULTS.rowCap;
      useAttributeTableStore.getState().appendPage(layerId, tab.store.length, capReached);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : String(err);
      useAttributeTableStore.getState().setError(layerId, msg);
    } finally {
      if (!ctrl.signal.aborted) useAttributeTableStore.getState().setLoading(layerId, false);
    }
  }, []);

  // --- Auto-reload on sort/filter/bbox change per tab ------------------------

  // Subscribe to the map's current extent so we can re-fetch whenever the
  // user pans/zooms while the "Map extent" filter is active. `mapStore`
  // publishes `currentExtent` via its `moveend` handler in MapContainer.
  // We round the extent to 0.1m and key on it only when the filter is on —
  // that avoids noise when the user pans with bbox filter off.
  const currentExtent = useMapStore((s) => s.currentExtent);
  const extentKey = active?.bboxFilterActive && currentExtent ? currentExtent.map((n) => Math.round(n * 10) / 10).join(",") : "";

  const lastKeyByTab = useRef<Map<string, string>>(new Map());
  const filtersKey = active ? JSON.stringify(Object.entries(active.filters).sort(([a], [b]) => a.localeCompare(b))) : "";
  const activeKey = active ? `${active.sort ? `${active.sort.field}:${active.sort.direction}` : ""}|${active.bboxFilterActive ? 1 : 0}|${extentKey}|${filtersKey}` : "";

  useEffect(() => {
    if (!active) return;
    const prev = lastKeyByTab.current.get(active.layerId);
    if (prev === undefined) {
      lastKeyByTab.current.set(active.layerId, activeKey);
      if (active.store === null && !active.error) {
        void runReload(active.layerId);
      }
      return;
    }
    if (prev !== activeKey) {
      lastKeyByTab.current.set(active.layerId, activeKey);
      void runReload(active.layerId);
    }
  }, [active, activeKey, runReload]);

  const openLayerIds = useAttributeTableStore((s) => s.tabs.map((t) => t.layerId).join("|"));
  useEffect(() => {
    const open = new Set(openLayerIds.split("|").filter(Boolean));
    for (const k of Array.from(lastKeyByTab.current.keys())) {
      if (!open.has(k)) lastKeyByTab.current.delete(k);
    }
  }, [openLayerIds]);

  const loadMore = useCallback(async () => {
    const id = activeIdRef.current;
    if (id) await runLoadMore(id);
  }, [runLoadMore]);

  const reload = useCallback(async () => {
    const id = activeIdRef.current;
    if (id) await runReload(id);
  }, [runReload]);

  return { loadMore, reload };
}
