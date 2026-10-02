/**
 * Turns on the map layers associated with a search result's type - the legacy i-Map's
 * searchResultLayerActivate behaviour (header/Search.jsx jsonCallback), driven by
 * web_search.tbl_search_layers.assoc_layers: "workspace:layer@TOC group,workspace:layer@TOC group".
 *
 * The group half named legacy TOC groups ("Roads", "Geomatics") that don't exist in this app's
 * Layers list, so layers are matched by name alone, against every TOC layer on the map:
 *  1. the qualified workspace:layer name (qualifiedLayerName handles workspace-scoped sources whose
 *     capabilities list bare names), else
 *  2. the bare layer name, when exactly one TOC layer has it - covers workspaces renamed since the
 *     table was written (e.g. its "road_interest:" vs today's "road_interests:").
 */

import { useLayerManagerStore } from "@/stores/layerManagerStore";
import { useTOCStore } from "@/stores/tocStore";
import { qualifiedLayerName } from "@/utils/mapFilter";

const bare = (name: string) => name.slice(name.indexOf(":") + 1);

/** "ws:a@Group,ws:b@Group" -> ["ws:a", "ws:b"] */
export function parseAssocLayers(assocLayers: string | null | undefined): string[] {
  if (!assocLayers) return [];
  return assocLayers
    .split(",")
    .map((entry) => entry.split("@")[0].trim())
    .filter(Boolean);
}

/** Managed TOC layer ids to turn on for each associated layer name that resolves */
export function resolveAssocLayers(names: string[]): string[] {
  const tocLayers = useLayerManagerStore.getState().layers.TOC.map((l) => ({ id: l.id, qualified: qualifiedLayerName(l) || l.name || "" }));
  const ids = new Set<string>();
  for (const name of names) {
    // GeoServer has layers differing only by case (onctms / ONCTMS), so an exact-case match wins
    // over a case-insensitive one at each step
    const lower = name.toLowerCase();
    const steps = [
      tocLayers.filter((l) => l.qualified === name),
      tocLayers.filter((l) => l.qualified.toLowerCase() === lower),
      tocLayers.filter((l) => bare(l.qualified) === bare(name)),
      tocLayers.filter((l) => bare(l.qualified).toLowerCase() === bare(lower)),
    ];
    // qualified-name matches may hit several TOC copies of one layer; bare names must be unique
    const matches = steps[0].length ? steps[0] : steps[1].length ? steps[1] : steps[2].length === 1 ? steps[2] : steps[3].length === 1 ? steps[3] : [];
    matches.forEach((l) => ids.add(l.id));
  }
  return Array.from(ids);
}

/** Turns on the result's associated layers; returns how many layers were turned on */
export function activateSearchResultLayers(assocLayers: string | null | undefined): number {
  const managedIds = new Set(resolveAssocLayers(parseAssocLayers(assocLayers)));
  if (managedIds.size === 0) return 0;
  const toc = useTOCStore.getState();
  let turnedOn = 0;
  for (const layer of toc.allLayers) {
    if (layer.managedLayerId && managedIds.has(layer.managedLayerId) && !layer.visible) {
      toc.updateLayerVisibilityById(layer.id, true);
      turnedOn++;
    }
  }
  return turnedOn;
}
