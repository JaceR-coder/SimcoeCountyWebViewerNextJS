"use client";

/**
 * A My Maps folder - ported from the legacy SimcoeCountyWebViewer MyMapsFolder.jsx.
 *
 * Header: open/closed folder icon (same look as the Layers tab's folders, as in legacy), a star when
 * it's the active workspace, "Label - (count)", click to collapse/expand, and a drop target for
 * dragged items. The options menu mirrors legacy's: turn all on/off, rename, set/clear active
 * workspace, save the folder to a shareable link, export, delete (items move to root).
 */

import React, { useEffect, useRef, useState } from "react";
import { FaFolder, FaFolderOpen, FaEllipsisV, FaStar } from "react-icons/fa";
import { useMyMapsStore, type MyMapsFolder as MyMapsFolderType } from "@/stores/myMapsStore";
import MyMapsItem from "@/components/myMaps/MyMapsItem";
import type { MyMapsItem as MyMapsItemType } from "@/types/myMaps";
import { draggedItemId, isItemDrag } from "./myMapsDnd";
import "./MyMapsItemPopup.css";

export type ExportFormat = "KML" | "GeoJSON" | "EsriJSON";

export interface MyMapsItemHandlers {
  onLabelChange: (id: string, label: string) => void;
  onItemDelete: (id: string) => void;
  onShowItemOptions?: (item: MyMapsItemType, event?: React.MouseEvent) => void;
  onHoverStart?: (item: MyMapsItemType) => void;
  onHoverEnd?: (item: MyMapsItemType) => void;
  isEditing?: boolean;
}

interface MyMapsFolderProps extends MyMapsItemHandlers {
  folder: MyMapsFolderType;
  items: MyMapsItemType[];
  isActive: boolean;
  onSaveFolder: (folder: MyMapsFolderType) => void;
  onExportFolder: (items: MyMapsItemType[], format: ExportFormat) => void;
}

export default function MyMapsFolder({ folder, items, isActive, onSaveFolder, onExportFolder, ...itemHandlers }: MyMapsFolderProps) {
  const { toggleFolder, renameFolder, setActiveFolder, setFolderVisibility, deleteFolder, moveItemToFolder } = useMyMapsStore.getState();
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(folder.label);
  const [dragOver, setDragOver] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const open = folder.panelOpen !== false;
  const hasVisibleItems = items.some((item) => item.visible);

  // Keep the label in sync with renames from elsewhere (e.g. import), but not mid-typing
  useEffect(() => {
    if (!renaming) setLabel(folder.label);
  }, [folder.label, renaming]);

  // Close the options menu on outside click / Escape
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const commitRename = () => {
    setRenaming(false);
    const trimmed = label.trim();
    if (trimmed && trimmed !== folder.label) renameFolder(folder.id, trimmed);
    else setLabel(folder.label);
  };

  const openMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    const width = 220;
    const height = 290;
    setExportOpen(false);
    setMenu({ x: Math.max(10, Math.min(e.clientX, window.innerWidth - width - 10)), y: Math.max(10, Math.min(e.clientY, window.innerHeight - height - 10)) });
  };

  const menuAction = (action: () => void) => () => {
    setMenu(null);
    action();
  };

  const onDragOver = (e: React.DragEvent) => {
    if (!isItemDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dragOver) setDragOver(true);
  };

  const onDrop = (e: React.DragEvent) => {
    if (!isItemDrag(e)) return;
    e.preventDefault();
    setDragOver(false);
    const id = draggedItemId(e);
    if (id) moveItemToFolder(id, folder.id);
  };

  return (
    <div className="mb-1" data-testid="mymaps-folder">
      <div
        className={`group flex items-center gap-1.5 py-1 pl-2 pr-1 rounded-[3px] cursor-pointer select-none text-sm font-bold ${hasVisibleItems ? "text-primary" : "text-base-content"} ${dragOver ? "outline-2 outline-dashed outline-primary -outline-offset-2 bg-primary/10" : "hover:bg-base-200"}`}
        onClick={() => !renaming && toggleFolder(folder.id)}
        onDragOver={onDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        title={open ? "Collapse folder" : "Expand folder"}
      >
        {open ? <FaFolderOpen size={16} className="shrink-0 opacity-90 text-[#e3b778]" /> : <FaFolder size={16} className="shrink-0 opacity-90 text-[#e3b778]" />}
        {isActive && (
          <span className="shrink-0 text-warning" title="Active workspace - new drawings and added items go here">
            <FaStar size={12} />
          </span>
        )}
        {renaming ? (
          <input
            autoFocus
            aria-label="Folder name"
            className="flex-1 min-w-0 text-sm font-bold border border-primary rounded-sm px-1 bg-base-100"
            value={label}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") {
                setLabel(folder.label);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span className="flex-1 min-w-0 truncate">
            {folder.label} <span className="font-normal">- ({items.length})</span>
          </span>
        )}
        <button type="button" className="shrink-0 p-1 rounded hover:bg-base-300" title="Folder Options" aria-label={`Folder options for ${folder.label}`} onClick={openMenu}>
          <FaEllipsisV size={12} className="opacity-70" />
        </button>
      </div>

      {open && (
        <div className="ml-3 pl-2 border-l-2 border-dotted border-base-300">
          {items.map((item) => (
            <MyMapsItem
              key={item.id}
              item={item}
              onLabelChange={itemHandlers.onLabelChange}
              onDelete={itemHandlers.onItemDelete}
              onShowOptions={itemHandlers.onShowItemOptions}
              onHoverStart={itemHandlers.onHoverStart}
              onHoverEnd={itemHandlers.onHoverEnd}
              isEditing={itemHandlers.isEditing}
            />
          ))}
          {items.length === 0 && <div className="py-2 pl-2 text-xs italic text-base-content/50">Empty folder. Drag items here, or use an item&apos;s Tools menu to move it here.</div>}
        </div>
      )}

      {menu && (
        <>
          <div className="fixed inset-0 z-[99998]" />
          <div ref={menuRef} role="menu" aria-label={`Folder Options - ${folder.label}`} className="popup-container animate-mymapsPopupFadeIn" style={{ left: menu.x, top: menu.y }}>
            <div className="py-1">
              <div className="px-3 py-1 text-[11px] font-bold text-base-content/60 truncate">Folder Options - {folder.label}</div>
              <div role="menuitem" className="popup-menu-item" onClick={menuAction(() => setFolderVisibility(folder.id, true))}>
                <span>Turn On All Items</span>
              </div>
              <div role="menuitem" className="popup-menu-item" onClick={menuAction(() => setFolderVisibility(folder.id, false))}>
                <span>Turn Off All Items</span>
              </div>
              <div role="menuitem" className="popup-menu-item" onClick={menuAction(() => setRenaming(true))}>
                <span>Rename Folder</span>
              </div>
              <div role="menuitem" className="popup-menu-item" onClick={menuAction(() => setActiveFolder(folder.id))}>
                <span>{isActive ? "Clear Active Workspace" : "Set as Active Workspace"}</span>
              </div>
              <div role="menuitem" className="popup-menu-item" onClick={menuAction(() => onSaveFolder(folder))}>
                <span>Save Folder (Get Shareable Link)</span>
              </div>
              <div className="popup-menu-item-parent" onMouseEnter={() => setExportOpen(true)} onMouseLeave={() => setExportOpen(false)} onClick={() => setExportOpen((o) => !o)}>
                <span>Export Folder to ...</span>
                <span className="text-[10px] text-base-content/70 ml-auto pl-2">▶</span>
                {exportOpen && (
                  <div className="popup-submenu-container animate-submenuFadeIn">
                    {(["KML", "EsriJSON", "GeoJSON"] as ExportFormat[]).map((format) => (
                      <div
                        key={format}
                        role="menuitem"
                        className="popup-submenu-item"
                        onClick={(e) => {
                          e.stopPropagation();
                          menuAction(() => onExportFolder(items, format))();
                        }}
                      >
                        <span>{format}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="h-px bg-base-300 my-1" />
              <div role="menuitem" className="popup-menu-item-danger" onClick={menuAction(() => deleteFolder(folder.id))} title="Deletes the folder only - its items move to Root Items">
                <span>Delete Folder</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
