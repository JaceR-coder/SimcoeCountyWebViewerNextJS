/**
 * Saved layer filters and live map-filter state for the Spatial Tool, ported from the legacy
 * SimcoeCountyWebViewer helpers/savedLayerFilterHelpers.js (plus the "which filter is on" bits of
 * mapFilterHelpers.js, so the TOC stars and the tool re-render from one place).
 *
 * Saved filters are named, per-layer criteria from "Save Map Filter to Layer", keyed by qualified
 * GeoServer layer name. Kept in this browser's localStorage, as in i-Map - the NextJS My Maps /
 * settings database isn't provisioned yet. Applying one to the map is utils/mapFilter.ts's job.
 */

import { create } from "zustand";
import type { SavedCriteria } from "@/components/tools/SpatialReport/payload";

export type FilterCriteria = SavedCriteria;

export interface SavedLayerFilter {
  id: string;
  name: string;
  criteria: FilterCriteria;
  createdAt: number;
}

const STORAGE_KEY = "Saved Layer Filters";

function load(): Record<string, SavedLayerFilter[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persist(saved: Record<string, SavedLayerFilter[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // storage full/blocked - the filter still works for this session
  }
}

const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

interface LayerFilterState {
  saved: Record<string, SavedLayerFilter[]>;
  /** Saved filter currently applied via a TOC star, per layer */
  activeFilterByLayer: Record<string, string>;
  /** Any filter (Filter Map or a star) currently applied to the map */
  mapFilterActive: boolean;

  saveFilter: (layerName: string, name: string, criteria: FilterCriteria) => SavedLayerFilter;
  deleteFilter: (layerName: string, filterId: string) => void;
  setActiveFilter: (layerName: string, filterId: string | undefined) => void;
  setMapFilterActive: (active: boolean) => void;
  clearActive: () => void;
}

export const useLayerFilterStore = create<LayerFilterState>()((set, get) => ({
  saved: typeof window === "undefined" ? {} : load(),
  activeFilterByLayer: {},
  mapFilterActive: false,

  saveFilter: (layerName, name, criteria) => {
    const entry: SavedLayerFilter = { id: newId(), name, criteria, createdAt: Date.now() };
    const saved = { ...get().saved, [layerName]: [...(get().saved[layerName] || []), entry] };
    persist(saved);
    set({ saved });
    return entry;
  },

  deleteFilter: (layerName, filterId) => {
    const saved = { ...get().saved };
    const remaining = (saved[layerName] || []).filter((f) => f.id !== filterId);
    if (remaining.length > 0) saved[layerName] = remaining;
    else delete saved[layerName];
    persist(saved);
    set({ saved });
  },

  setActiveFilter: (layerName, filterId) =>
    set((s) => {
      const activeFilterByLayer = { ...s.activeFilterByLayer };
      if (filterId) activeFilterByLayer[layerName] = filterId;
      else delete activeFilterByLayer[layerName];
      return { activeFilterByLayer, mapFilterActive: filterId ? true : s.mapFilterActive };
    }),

  setMapFilterActive: (mapFilterActive) => set({ mapFilterActive }),

  clearActive: () => set({ activeFilterByLayer: {}, mapFilterActive: false }),
}));

const NO_FILTERS: SavedLayerFilter[] = [];
export const selectLayerFilters = (layerName: string | undefined) => (s: LayerFilterState) => (layerName && s.saved[layerName]) || NO_FILTERS;

/** Short description of what a saved filter matches, for the TOC and the Saved Filters list */
export function summarizeCriteria(criteria: FilterCriteria): string {
  const parts: string[] = [];
  const spatial = criteria.spatial_scope;
  if (criteria.scope === "area" && criteria.area_geojson) parts.push("Map area");
  else if (spatial?.type === "reference_layer") parts.push(`Reference layer: ${spatial.layer}`);
  else if (spatial?.type === "drawn_area") parts.push("LHRS range");
  const n = criteria.filters?.length || 0;
  if (n > 0) parts.push(`${n} attribute filter${n === 1 ? "" : "s"}`);
  return parts.length > 0 ? parts.join(" + ") : "Entire layer (no scope/filters)";
}
