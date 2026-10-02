/**
 * Pure request-building / validation rules for the Spatial Report tool, ported 1:1 from the legacy
 * SpatialReport.jsx (buildPayload / canRun / canRunReason / canViewTable) and reportHelpers.js
 * (coerceFilterValue). Kept free of React/OpenLayers so they can be unit tested directly.
 *
 * Backend constraints these mirror (py-Geomatics report_query.ReportQuery.validate()):
 *  - output fields, filters, attribute/container grouping and calculations need exactly ONE
 *    selected layer ("advanced" mode); reference-layer and LHRS scopes don't.
 *  - fields/filters/calculations can't be combined with proximity grouping.
 *  - the in-browser table needs one layer and no proximity grouping.
 */

export type Scope = "layer" | "area" | "reference" | "lhrs";
export type GroupingMode = "none" | "proximity" | "attribute" | "container";
export type SpatialPredicate = "intersects" | "within" | "contains" | "within_distance";

export interface FilterRow {
  field: string;
  operator: string;
  value: unknown;
}

export interface AggregateRow {
  function: string;
  field: string | null;
}

export interface ReportForm {
  scope: Scope;
  selectedLayers: string[];
  areaGeoJSON?: object;
  scopeReferenceLayer: string;
  scopeReferencePredicate: SpatialPredicate;
  scopeReferenceDistanceM: string;
  scopeReferenceFilters: FilterRow[];
  lhrsRangeGeoJSON?: object;
  lhrsRangePredicate: SpatialPredicate;
  lhrsRangeDistanceM: string;
  bufferDistanceM: number;
  includeThumbnails: boolean;
  outputFields: string[];
  filters: FilterRow[];
  groupingMode: GroupingMode;
  groupingAttributeField: string;
  groupingContainerLayer: string;
  groupingContainerLabelField: string;
  groupingContainerPredicate: SpatialPredicate;
  aggregates: AggregateRow[];
  outputIncludeRaw: boolean;
  outputIncludeGroupedDetail: boolean;
  outputIncludeSummarySheet: boolean;
  outputIncludeLhrs: boolean;
}

/** Field name -> "number" | "text" | ... (from /api/layer-fields output_fields[].format) */
export type FieldFormatLookup = (field: string) => string | undefined;

export const isAdvanced = (f: Pick<ReportForm, "selectedLayers">) => f.selectedLayers.length === 1;

/**
 * Coerces a filter builder's raw string input into what the backend's filter_service expects:
 * a number for numeric fields, a list for 'in', null for the no-value operators.
 */
export function coerceFilterValue(rawValue: unknown, operator: string, fieldFormat?: string): unknown {
  if (operator === "is_null" || operator === "is_not_null") return null;
  if (operator === "in") {
    return String(rawValue ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .map((v) => (fieldFormat === "number" ? Number(v) : v));
  }
  if (fieldFormat === "number") {
    const num = Number(rawValue);
    return Number.isNaN(num) ? rawValue : num;
  }
  return rawValue;
}

export function coerceFilters(filters: FilterRow[], formatOf: FieldFormatLookup) {
  return filters
    .filter((f) => f.field)
    .map((f) => ({ field: f.field, operator: f.operator, value: coerceFilterValue(f.value, f.operator, formatOf(f.field)) }));
}

const positive = (v: string | number) => {
  const n = parseFloat(String(v));
  return !Number.isNaN(n) && n > 0;
};

/** Why the Preview/Generate buttons are disabled, or undefined when the form can run */
export function canRunReason(f: ReportForm): string | undefined {
  if (f.selectedLayers.length === 0) return "Select at least one layer to continue.";
  if (f.scope === "area" && !f.areaGeoJSON) return "Draw a selection area on the map to continue.";
  if (f.scope === "reference" && !f.scopeReferenceLayer) return "Choose a reference layer to continue.";
  if (f.scope === "reference" && f.scopeReferencePredicate === "within_distance" && !positive(f.scopeReferenceDistanceM))
    return "Enter a distance (metres) greater than 0 to continue.";
  if (f.scope === "lhrs" && !f.lhrsRangeGeoJSON) return "Resolve an LHRS range (Point A and Point B) to continue.";
  if (f.scope === "lhrs" && f.lhrsRangePredicate === "within_distance" && !positive(f.lhrsRangeDistanceM))
    return "Enter a corridor width (metres) greater than 0 to continue.";
  if (isAdvanced(f)) {
    if (f.groupingMode === "attribute" && !f.groupingAttributeField) return "Choose a field to group by.";
    if (f.groupingMode === "container" && !f.groupingContainerLayer) return "Choose a layer to group by.";
    if (f.groupingMode === "container" && !f.groupingContainerLabelField) return "Choose a field to label each group with.";
  }
  return undefined;
}

export const canRun = (f: ReportForm) => canRunReason(f) === undefined;

export const canViewTable = (f: ReportForm) => canRun(f) && isAdvanced(f) && f.groupingMode !== "proximity";

/** Proximity grouping is the only mode in non-advanced (0 / 2+ layers) mode, driven by the buffer alone */
export const isProximityActive = (f: ReportForm) => (isAdvanced(f) ? f.groupingMode === "proximity" && f.bufferDistanceM > 0 : f.bufferDistanceM > 0);

export function buildPayload(f: ReportForm, formatOf: FieldFormatLookup, referenceFormatOf: FieldFormatLookup): Record<string, unknown> {
  const advanced = isAdvanced(f);
  const bufferDistanceM = advanced ? (f.groupingMode === "proximity" ? f.bufferDistanceM : 0) : f.bufferDistanceM;

  const payload: Record<string, unknown> = {
    scope: f.scope === "area" ? "area" : "layer",
    layers: f.selectedLayers,
    area_geojson: f.scope === "area" ? f.areaGeoJSON : undefined,
    buffer_distance_m: bufferDistanceM,
    include_thumbnails: f.includeThumbnails,
  };

  if (f.scope === "reference" && f.scopeReferenceLayer) {
    const spatialScope: Record<string, unknown> = {
      type: "reference_layer",
      layer: f.scopeReferenceLayer,
      predicate: f.scopeReferencePredicate,
      filters: coerceFilters(f.scopeReferenceFilters, referenceFormatOf),
    };
    if (f.scopeReferencePredicate === "within_distance") spatialScope.distance_m = parseFloat(f.scopeReferenceDistanceM);
    payload.spatial_scope = spatialScope;
  }

  // An LHRS range is just a line geometry scope - sent as an ordinary drawn_area
  if (f.scope === "lhrs" && f.lhrsRangeGeoJSON) {
    const spatialScope: Record<string, unknown> = { type: "drawn_area", area_geojson: f.lhrsRangeGeoJSON, predicate: f.lhrsRangePredicate };
    if (f.lhrsRangePredicate === "within_distance") spatialScope.distance_m = parseFloat(f.lhrsRangeDistanceM);
    payload.spatial_scope = spatialScope;
  }

  payload.output = {
    include_raw: f.outputIncludeRaw,
    include_grouped_detail: f.outputIncludeGroupedDetail,
    include_summary_sheet: f.outputIncludeSummarySheet,
    include_lhrs: f.outputIncludeLhrs,
  };

  if (!advanced) return payload;

  if (f.groupingMode === "attribute" && f.groupingAttributeField) {
    payload.grouping = { type: "attribute", attribute_field: f.groupingAttributeField };
  } else if (f.groupingMode === "container" && f.groupingContainerLayer && f.groupingContainerLabelField) {
    payload.grouping = {
      type: "container",
      container_layer: f.groupingContainerLayer,
      container_label_field: f.groupingContainerLabelField,
      predicate: f.groupingContainerPredicate,
    };
  } else if (f.groupingMode === "proximity" && f.bufferDistanceM > 0) {
    payload.grouping = { type: "proximity", buffer_distance_m: f.bufferDistanceM };
  }

  if (f.groupingMode !== "proximity") {
    if (f.outputFields.length > 0) payload.output_fields = f.outputFields;
    const filters = coerceFilters(f.filters, formatOf);
    if (filters.length > 0) payload.filters = filters;
    const aggregates = f.aggregates.filter((a) => a.function === "count" || a.field);
    if (aggregates.length > 0) payload.aggregates = aggregates;
  }

  return payload;
}

// ── Filter Map / saved layer filters (legacy SpatialReport.jsx canFilterMap / canSaveFilter /
// onSaveFilterToLayerClick / applySavedFilterToForm) ─────────────────────────────────────────

const hasScope = (f: ReportForm) => f.scope === "area" || f.scope === "reference" || f.scope === "lhrs";
const hasAttributeFilters = (f: ReportForm) => isAdvanced(f) && f.groupingMode !== "proximity" && f.filters.some((r) => r.field);

/**
 * Filter Map needs something to filter BY - with no scope or filter it would just run an
 * unrestricted extent query over the whole layer to zoom to "everything".
 */
export const canFilterMap = (f: ReportForm) => canRun(f) && (hasScope(f) || hasAttributeFilters(f));

/** A saved filter belongs to exactly one layer, and the Filters section doesn't apply to proximity grouping */
export const canSaveFilter = (f: ReportForm) => canRun(f) && isAdvanced(f) && f.groupingMode !== "proximity" && (hasScope(f) || hasAttributeFilters(f));

export interface SavedCriteria {
  scope: "layer" | "area";
  area_geojson?: object;
  spatial_scope?: Record<string, unknown>;
  filters: FilterRow[];
}

/** What a saved filter keeps from a built payload: only what decides which features match */
export function criteriaFromPayload(payload: Record<string, unknown>): SavedCriteria {
  return {
    scope: payload.scope as SavedCriteria["scope"],
    area_geojson: payload.area_geojson as object | undefined,
    spatial_scope: payload.spatial_scope as Record<string, unknown> | undefined,
    filters: (payload.filters as FilterRow[] | undefined) || [],
  };
}

/** The reverse: form fields that reproduce a saved filter's scope/filters (layer selection is separate) */
export function formPatchFromCriteria(c: SavedCriteria): Partial<ReportForm> {
  const spatial = c.spatial_scope;
  const distance = (fallback: string) => (spatial?.distance_m !== undefined ? String(spatial.distance_m) : fallback);
  const patch: Partial<ReportForm> = { filters: c.filters || [], scope: "layer", groupingMode: "none" };
  if (c.scope === "area" && c.area_geojson) {
    Object.assign(patch, { scope: "area", areaGeoJSON: c.area_geojson });
  } else if (spatial?.type === "reference_layer") {
    Object.assign(patch, {
      scope: "reference",
      scopeReferenceLayer: spatial.layer as string,
      scopeReferencePredicate: (spatial.predicate as SpatialPredicate) || "intersects",
      scopeReferenceDistanceM: distance(""),
      scopeReferenceFilters: (spatial.filters as FilterRow[]) || [],
    });
  } else if (spatial?.type === "drawn_area") {
    Object.assign(patch, {
      scope: "lhrs",
      lhrsRangeGeoJSON: spatial.area_geojson as object,
      lhrsRangePredicate: (spatial.predicate as SpatialPredicate) || "within_distance",
      lhrsRangeDistanceM: distance("50"),
    });
  }
  return patch;
}
