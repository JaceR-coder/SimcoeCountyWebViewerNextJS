"use client";

/**
 * "View Saved Filters" - every filter saved to any layer, ported from the legacy
 * ReportSavedFiltersModal.jsx. Clicking a row loads its scope/filters back into the Spatial Tool
 * form; Delete removes it (clearing it from the map first if it's applied).
 */

import React from "react";
import { Modal } from "@/components/ui/Modal";
import { useLayerFilterStore, summarizeCriteria, type SavedLayerFilter } from "@/stores/layerFilterStore";
import { deleteSavedLayerFilter } from "./savedFilters";

interface SavedFiltersModalProps {
  open: boolean;
  onClose: () => void;
  layerTitle: (qualifiedName: string) => string;
  onLoad: (layerName: string, filter: SavedLayerFilter) => void;
}

export default function SavedFiltersModal({ open, onClose, layerTitle, onLoad }: SavedFiltersModalProps) {
  const saved = useLayerFilterStore((s) => s.saved);
  const active = useLayerFilterStore((s) => s.activeFilterByLayer);
  const layerNames = Object.keys(saved).filter((n) => saved[n].length > 0);

  return (
    <Modal isOpen={open} onClose={onClose} className="w-11/12 max-w-xl">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-lg font-bold">Saved Filters</h2>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {layerNames.length === 0 ? (
        <p className="text-sm text-base-content/70">No filters have been saved yet. Build a scope/filter and click &quot;Save Map Filter to Layer&quot;.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-base-content/70">Click a saved filter to load its scope/filters into the Spatial Tool.</p>
          {layerNames.map((layerName) => (
            <div key={layerName}>
              <div className="font-bold text-sm mb-1">{layerTitle(layerName)}</div>
              <ul className="space-y-1">
                {saved[layerName].map((filter) => (
                  <li key={filter.id} className="flex items-center gap-2 rounded border border-base-300 hover:bg-base-200">
                    <button
                      type="button"
                      className="flex-1 text-left p-2 min-w-0"
                      title="Load this filter into the Spatial Tool"
                      onClick={() => {
                        onLoad(layerName, filter);
                        onClose();
                      }}
                    >
                      <span className="text-sm font-semibold">
                        {filter.name}
                        {active[layerName] === filter.id && <span className="badge badge-success badge-xs ml-2">Active</span>}
                      </span>
                      <span className="block text-xs text-base-content/70">{summarizeCriteria(filter.criteria)}</span>
                    </button>
                    <button type="button" className="btn btn-xs btn-ghost text-error mr-2" title="Delete this saved filter" onClick={() => deleteSavedLayerFilter(layerName, filter.id)}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
