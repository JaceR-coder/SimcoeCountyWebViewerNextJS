import { describe, it, expect } from "vitest";
import { buildPayload, canFilterMap, canRunReason, canSaveFilter, canViewTable, coerceFilterValue, criteriaFromPayload, formPatchFromCriteria, isProximityActive, type ReportForm } from "../payload";
import { INITIAL_FORM } from "@/stores/spatialReportStore";

const form = (patch: Partial<ReportForm>): ReportForm => ({ ...INITIAL_FORM, ...patch });
const noFormats = () => undefined;
const numeric = (f: string) => (f === "aadt" ? "number" : "text");

describe("coerceFilterValue", () => {
  it("coerces by operator and field type", () => {
    expect(coerceFilterValue("12", "gt", "number")).toBe(12);
    expect(coerceFilterValue("abc", "eq", "number")).toBe("abc");
    expect(coerceFilterValue("1, 2,,3", "in", "number")).toEqual([1, 2, 3]);
    expect(coerceFilterValue("a, b", "in", "text")).toEqual(["a", "b"]);
    expect(coerceFilterValue("x", "is_null")).toBeNull();
  });
});

describe("canRunReason", () => {
  it("walks the same checks as the legacy tool", () => {
    expect(canRunReason(form({}))).toMatch(/Select at least one layer/);
    expect(canRunReason(form({ selectedLayers: ["a:b"], scope: "area" }))).toMatch(/Draw a selection area/);
    expect(canRunReason(form({ selectedLayers: ["a:b"], scope: "reference" }))).toMatch(/reference layer/);
    expect(canRunReason(form({ selectedLayers: ["a:b"], scope: "reference", scopeReferenceLayer: "x:y", scopeReferencePredicate: "within_distance", scopeReferenceDistanceM: "0" }))).toMatch(/distance/);
    expect(canRunReason(form({ selectedLayers: ["a:b"], scope: "lhrs" }))).toMatch(/LHRS range/);
    expect(canRunReason(form({ selectedLayers: ["a:b"], groupingMode: "attribute" }))).toMatch(/field to group by/);
    expect(canRunReason(form({ selectedLayers: ["a:b"], groupingMode: "container", groupingContainerLayer: "x:y" }))).toMatch(/label each group/);
    expect(canRunReason(form({ selectedLayers: ["a:b"] }))).toBeUndefined();
  });

  it("only allows the table for one layer without proximity grouping", () => {
    expect(canViewTable(form({ selectedLayers: ["a:b"] }))).toBe(true);
    expect(canViewTable(form({ selectedLayers: ["a:b", "c:d"] }))).toBe(false);
    expect(canViewTable(form({ selectedLayers: ["a:b"], groupingMode: "proximity", bufferDistanceM: 10 }))).toBe(false);
  });
});

describe("buildPayload", () => {
  it("builds a whole-layer request with output options", () => {
    const p = buildPayload(form({ selectedLayers: ["a:b", "c:d"], bufferDistanceM: 25 }), noFormats, noFormats);
    expect(p).toMatchObject({ scope: "layer", layers: ["a:b", "c:d"], buffer_distance_m: 25, output: { include_raw: true, include_lhrs: true } });
    // multi-layer: no single-layer-only options
    expect(p.grouping).toBeUndefined();
    expect(p.filters).toBeUndefined();
  });

  it("sends drawn areas as scope=area", () => {
    const area = { type: "Polygon", coordinates: [] };
    expect(buildPayload(form({ selectedLayers: ["a:b"], scope: "area", areaGeoJSON: area }), noFormats, noFormats)).toMatchObject({ scope: "area", area_geojson: area });
  });

  it("sends a reference-layer scope with coerced reference filters", () => {
    const p = buildPayload(
      form({ selectedLayers: ["a:b"], scope: "reference", scopeReferenceLayer: "x:y", scopeReferencePredicate: "within_distance", scopeReferenceDistanceM: "150", scopeReferenceFilters: [{ field: "aadt", operator: "gt", value: "100" }] }),
      noFormats,
      numeric,
    );
    expect(p.spatial_scope).toEqual({ type: "reference_layer", layer: "x:y", predicate: "within_distance", distance_m: 150, filters: [{ field: "aadt", operator: "gt", value: 100 }] });
  });

  it("sends an LHRS range as a drawn_area line scope", () => {
    const line = { type: "MultiLineString", coordinates: [] };
    const p = buildPayload(form({ selectedLayers: ["a:b"], scope: "lhrs", lhrsRangeGeoJSON: line, lhrsRangeDistanceM: "75" }), noFormats, noFormats);
    expect(p.scope).toBe("layer");
    expect(p.spatial_scope).toEqual({ type: "drawn_area", area_geojson: line, predicate: "within_distance", distance_m: 75 });
  });

  it("includes single-layer options, but not alongside proximity grouping", () => {
    const base = form({
      selectedLayers: ["a:b"],
      groupingMode: "attribute",
      groupingAttributeField: "hwy",
      outputFields: ["hwy", "aadt"],
      filters: [{ field: "aadt", operator: "gte", value: "5" }, { field: "", operator: "eq", value: "" }],
      aggregates: [{ function: "count", field: null }, { function: "sum", field: null }, { function: "sum", field: "aadt" }],
    });
    const p = buildPayload(base, numeric, noFormats);
    expect(p.grouping).toEqual({ type: "attribute", attribute_field: "hwy" });
    expect(p.output_fields).toEqual(["hwy", "aadt"]);
    expect(p.filters).toEqual([{ field: "aadt", operator: "gte", value: 5 }]);
    expect(p.aggregates).toEqual([{ function: "count", field: null }, { function: "sum", field: "aadt" }]);
    expect(p.buffer_distance_m).toBe(0);

    const prox = buildPayload({ ...base, groupingMode: "proximity", bufferDistanceM: 30 }, numeric, noFormats);
    expect(prox.grouping).toEqual({ type: "proximity", buffer_distance_m: 30 });
    expect(prox.buffer_distance_m).toBe(30);
    expect(prox.filters).toBeUndefined();
    expect(prox.output_fields).toBeUndefined();
  });

  it("builds container grouping", () => {
    const p = buildPayload(form({ selectedLayers: ["a:b"], groupingMode: "container", groupingContainerLayer: "x:y", groupingContainerLabelField: "name", groupingContainerPredicate: "within" }), noFormats, noFormats);
    expect(p.grouping).toEqual({ type: "container", container_layer: "x:y", container_label_field: "name", predicate: "within" });
  });

  it("tracks proximity the same way in single- and multi-layer mode", () => {
    expect(isProximityActive(form({ selectedLayers: ["a:b", "c:d"], bufferDistanceM: 5 }))).toBe(true);
    expect(isProximityActive(form({ selectedLayers: ["a:b"], bufferDistanceM: 5 }))).toBe(false);
    expect(isProximityActive(form({ selectedLayers: ["a:b"], bufferDistanceM: 5, groupingMode: "proximity" }))).toBe(true);
  });
});

describe("Filter Map / saved filters", () => {
  const one = { selectedLayers: ["ws:culverts"] };
  const area = { type: "Polygon", coordinates: [] };

  it("needs a scope or an attribute filter to filter the map", () => {
    expect(canFilterMap(form(one))).toBe(false);
    expect(canFilterMap(form({ ...one, filters: [{ field: "hwy", operator: "eq", value: "11" }] }))).toBe(true);
    expect(canFilterMap(form({ ...one, scope: "area", areaGeoJSON: area }))).toBe(true);
    // two layers: filters don't apply, but a scope still does
    expect(canFilterMap(form({ selectedLayers: ["a:b", "c:d"], filters: [{ field: "hwy", operator: "eq", value: "11" }] }))).toBe(false);
    expect(canFilterMap(form({ selectedLayers: ["a:b", "c:d"], scope: "area", areaGeoJSON: area }))).toBe(true);
  });

  it("only saves a filter for exactly one layer, outside proximity grouping", () => {
    expect(canSaveFilter(form({ ...one, scope: "area", areaGeoJSON: area }))).toBe(true);
    expect(canSaveFilter(form({ selectedLayers: ["a:b", "c:d"], scope: "area", areaGeoJSON: area }))).toBe(false);
    expect(canSaveFilter(form({ ...one, scope: "area", areaGeoJSON: area, groupingMode: "proximity", bufferDistanceM: 10 }))).toBe(false);
    expect(canSaveFilter(form(one))).toBe(false);
  });

  it.each([
    ["an attribute filter", { filters: [{ field: "aadt", operator: "gt", value: "100" }] }],
    ["a drawn area", { scope: "area" as const, areaGeoJSON: area }],
    ["a reference layer", { scope: "reference" as const, scopeReferenceLayer: "ws:towns", scopeReferencePredicate: "within_distance" as const, scopeReferenceDistanceM: "25", scopeReferenceFilters: [{ field: "name", operator: "eq", value: "Barrie" }] }],
    ["an LHRS range", { scope: "lhrs" as const, lhrsRangeGeoJSON: { type: "LineString", coordinates: [] }, lhrsRangePredicate: "within_distance" as const, lhrsRangeDistanceM: "75" }],
  ])("round-trips %s through a saved filter", (_label, patch) => {
    const original = form({ ...one, ...patch });
    const criteria = criteriaFromPayload(buildPayload(original, numeric, noFormats));
    const restored = form({ ...one, ...formPatchFromCriteria(criteria) });
    expect(buildPayload(restored, numeric, noFormats)).toEqual(buildPayload(original, numeric, noFormats));
  });
});
