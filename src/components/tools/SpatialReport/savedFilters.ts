/**
 * Saved-filter star toggle, shared by the Layers tab (TOC/LayerItem.tsx) and the Spatial Tool's
 * Saved Filters list - legacy toc-folder-view/LayerItem.jsx onSavedFilterClick().
 */

import { showMessage } from "@/utils/helpersUI";
import { applyLayerFilter, clearLayerFilter } from "@/utils/mapFilter";
import { useLayerFilterStore, type SavedLayerFilter } from "@/stores/layerFilterStore";
import { useImapAuthStore } from "@/stores/imapAuthStore";
import { buildMapFilter, ReportAuthError } from "./api";

/** Applies the saved filter to its layer (turning the layer on), or clears it if it's already applied */
export async function toggleSavedLayerFilter(layerName: string, filter: SavedLayerFilter): Promise<void> {
  if (useLayerFilterStore.getState().activeFilterByLayer[layerName] === filter.id) {
    clearLayerFilter(layerName);
    return;
  }
  try {
    const result = await buildMapFilter({ ...filter.criteria, layers: [layerName] });
    const cql = result.targets[0]?.cql_filter;
    if (!cql) {
      showMessage("Filter Failed", "This filter didn't resolve to any criteria for this layer.", "warning", 6000);
      return;
    }
    if (!applyLayerFilter(layerName, cql, filter.id)) {
      showMessage("Filter Failed", "This layer isn't on the map, so the filter couldn't be applied.", "warning", 6000);
    }
  } catch (err) {
    if (err instanceof ReportAuthError) {
      useImapAuthStore.getState().refresh();
      showMessage("Sign In Required", "Sign in with your pyGeomatics account to use saved filters.", "warning", 6000);
    } else {
      showMessage("Filter Failed", (err as Error).message, "error", 6000);
    }
  }
}

/** Deletes a saved filter, clearing it from the map first if it's the one applied */
export function deleteSavedLayerFilter(layerName: string, filterId: string) {
  if (useLayerFilterStore.getState().activeFilterByLayer[layerName] === filterId) clearLayerFilter(layerName);
  useLayerFilterStore.getState().deleteFilter(layerName, filterId);
}
