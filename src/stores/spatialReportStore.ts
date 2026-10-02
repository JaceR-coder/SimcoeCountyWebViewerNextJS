/**
 * Spatial Report tool form state (src/components/tools/SpatialReport). Kept in a store rather than
 * component state so a half-built report survives closing and reopening the panel. Transient
 * request state (loading flags, job progress, results) stays in the component.
 */

import { create } from "zustand";
import type { ReportForm, FilterRow } from "@/components/tools/SpatialReport/payload";
import type { LayerFieldInfo } from "@/components/tools/SpatialReport/api";

export const INITIAL_FORM: ReportForm = {
  scope: "layer",
  selectedLayers: [],
  areaGeoJSON: undefined,
  scopeReferenceLayer: "",
  scopeReferencePredicate: "intersects",
  scopeReferenceDistanceM: "",
  scopeReferenceFilters: [],
  lhrsRangeGeoJSON: undefined,
  lhrsRangePredicate: "within_distance",
  lhrsRangeDistanceM: "50",
  bufferDistanceM: 0,
  includeThumbnails: false,
  outputFields: [],
  filters: [],
  groupingMode: "none",
  groupingAttributeField: "",
  groupingContainerLayer: "",
  groupingContainerLabelField: "",
  groupingContainerPredicate: "intersects",
  aggregates: [],
  outputIncludeRaw: true,
  outputIncludeGroupedDetail: true,
  outputIncludeSummarySheet: false,
  // On by default; the backend ignores it for proximity grouping, where the control is hidden
  outputIncludeLhrs: true,
};

interface SpatialReportState {
  form: ReportForm;
  /** /api/layer-fields for the single selected layer, the reference layer and the container layer */
  layerFields?: LayerFieldInfo;
  referenceLayerFields?: LayerFieldInfo;
  containerLayerFields?: LayerFieldInfo;

  update: (patch: Partial<ReportForm>) => void;
  setSelectedLayers: (layers: string[]) => void;
  setLayerFields: (info: LayerFieldInfo | undefined) => void;
  setReferenceLayerFields: (info: LayerFieldInfo | undefined) => void;
  setContainerLayerFields: (info: LayerFieldInfo | undefined) => void;
  reset: () => void;
}

export const useSpatialReportStore = create<SpatialReportState>()((set, get) => ({
  form: INITIAL_FORM,

  update: (patch) => set((s) => ({ form: { ...s.form, ...patch } })),

  // Changing which single layer is selected invalidates everything tied to that layer's fields.
  // Reference-layer scope is deliberately kept - it names a different layer entirely.
  setSelectedLayers: (layers) => {
    const prev = get().form.selectedLayers;
    const prevSingle = prev.length === 1 ? prev[0] : undefined;
    const nextSingle = layers.length === 1 ? layers[0] : undefined;
    if (prevSingle === nextSingle) {
      set((s) => ({ form: { ...s.form, selectedLayers: layers } }));
      return;
    }
    set((s) => ({
      layerFields: undefined,
      form: {
        ...s.form,
        selectedLayers: layers,
        outputFields: [],
        filters: [] as FilterRow[],
        aggregates: [],
        groupingAttributeField: "",
        bufferDistanceM: 0,
        groupingMode: nextSingle ? s.form.groupingMode : "none",
      },
    }));
  },

  setLayerFields: (info) =>
    set((s) => ({
      layerFields: info,
      // All output fields checked by default (the layer's curated default set) - unchecking is explicit
      form: { ...s.form, outputFields: (info?.output_fields || []).map((f) => f.name) },
    })),
  setReferenceLayerFields: (info) => set({ referenceLayerFields: info }),
  setContainerLayerFields: (info) => set({ containerLayerFields: info }),

  reset: () => set({ form: INITIAL_FORM, layerFields: undefined, referenceLayerFields: undefined, containerLayerFields: undefined }),
}));

export const formatLookup = (info: LayerFieldInfo | undefined) => (field: string) => info?.output_fields.find((f) => f.name === field)?.format;
