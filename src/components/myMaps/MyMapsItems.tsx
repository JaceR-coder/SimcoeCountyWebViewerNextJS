"use client";

import React, { useState } from "react";
import Image from "next/image";
import { FaPlus } from "react-icons/fa";
import { useMyMapsStore, type MyMapsFolder as MyMapsFolderType } from "@/stores/myMapsStore";
import MyMapsItem from "@/components/myMaps/MyMapsItem";
import MyMapsFolder, { type ExportFormat } from "@/components/myMaps/MyMapsFolder";
import type { MyMapsItem as MyMapsItemType } from "@/types/myMaps";
import { draggedItemId, isItemDrag } from "./myMapsDnd";

interface MyMapsItemsProps {
  onLabelChange: (id: string, label: string) => void;
  onItemDelete: (id: string) => void;
  onShowItemOptions?: (item: MyMapsItemType, event?: React.MouseEvent) => void;
  onHoverStart?: (item: MyMapsItemType) => void;
  onHoverEnd?: (item: MyMapsItemType) => void;
  onSaveFolder?: (folder: MyMapsFolderType) => void;
  onExportFolder?: (items: MyMapsItemType[], format: ExportFormat) => void;
  isEditing?: boolean;
}

/**
 * The My Items list, organised the way the legacy SimcoeCountyWebViewer My Maps is: a Folders
 * section above a Root Items section. Items drag between them (the handle on each row); the Root
 * Items box is always a drop target for "move back to root", even when empty. New drawings land in
 * the active workspace folder when one is set.
 */
const MyMapsItems: React.FC<MyMapsItemsProps> = ({ onLabelChange, onItemDelete, onShowItemOptions, onHoverStart, onHoverEnd, onSaveFolder, onExportFolder, isEditing = false }) => {
  const items = useMyMapsStore((s) => s.items);
  const folders = useMyMapsStore((s) => s.folders);
  const activeFolderId = useMyMapsStore((s) => s.activeFolderId);
  const [rootDragOver, setRootDragOver] = useState(false);

  const folderIds = new Set(folders.map((f) => f.id));
  // An item pointing at a folder that no longer exists shows at root rather than vanishing
  const rootItems = items.filter((item) => !item.folderId || !folderIds.has(item.folderId));
  const activeFolder = folders.find((f) => f.id === activeFolderId);
  const itemHandlers = { onLabelChange, onItemDelete, onShowItemOptions, onHoverStart, onHoverEnd, isEditing };

  const onRootDragOver = (e: React.DragEvent) => {
    if (!isItemDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!rootDragOver) setRootDragOver(true);
  };

  const onRootDrop = (e: React.DragEvent) => {
    if (!isItemDrag(e)) return;
    e.preventDefault();
    setRootDragOver(false);
    const id = draggedItemId(e);
    if (id) useMyMapsStore.getState().moveItemToFolder(id, null);
  };

  return (
    <div data-testid="mymaps-item-container" className="flex flex-col bg-base-100 rounded mb-2 overflow-hidden h-full">
      {/* Header */}
      <div data-testid="mymaps-items-header" className="flex items-center gap-1.5 py-2 px-3 bg-base-200 border-b border-base-300 text-xs font-semibold text-base-content">
        <Image src="/images/myMaps.png" alt="My Maps Icon" width={16} height={16} />
        <span className="flex-1">My Items</span>
        {isEditing && <label className="text-primary text-[11px] font-medium bg-primary/10 py-[2px] px-1.5 rounded-[3px] border border-primary/30">Editing Mode On</label>}
        <button type="button" className="btn btn-xs btn-ghost gap-1 font-semibold" title="Create a new folder" onClick={() => useMyMapsStore.getState().createFolder()}>
          <FaPlus size={10} /> New Folder
        </button>
      </div>

      {/* Active workspace */}
      {activeFolder && (
        <div data-testid="mymaps-active-folder" className="flex items-center gap-2 py-1.5 px-3 bg-warning/10 border-b border-base-300 text-xs">
          <span className="flex-1 min-w-0 truncate">
            Adding new items to: <strong>{activeFolder.label}</strong>
          </span>
          <button type="button" className="btn btn-xs btn-ghost" title="Stop adding to this folder" onClick={() => useMyMapsStore.getState().setActiveFolder(null)}>
            Clear
          </button>
        </div>
      )}

      {/* No data message */}
      {items.length === 0 && folders.length === 0 && (
        <div className="p-5 text-center text-base-content/60 text-xs leading-[1.4] italic before:content-['\1F4DD'] before:block before:text-2xl before:mb-2">
          There are currently no items to display. Please use the drawing tools above to create your own personal map item.
        </div>
      )}

      {/* Folders + root items */}
      <div data-testid="mymaps-items-list" className="flex-auto min-h-0 overflow-y-auto overflow-x-hidden border-b border-base-300 p-1.5 space-y-2">
        {(items.length > 0 || folders.length > 0) && (
          <>
            <section className="border border-base-300 rounded p-1" aria-label="Folders">
              <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wide text-base-content/60">Folders</div>
              {folders.length === 0 ? (
                <div className="px-1 pb-1 text-xs italic text-base-content/50">No folders yet - use &quot;+ New Folder&quot; above.</div>
              ) : (
                folders.map((folder) => (
                  <MyMapsFolder
                    key={folder.id}
                    folder={folder}
                    items={items.filter((item) => item.folderId === folder.id)}
                    isActive={folder.id === activeFolderId}
                    onSaveFolder={(f) => onSaveFolder?.(f)}
                    onExportFolder={(folderItems, format) => onExportFolder?.(folderItems, format)}
                    {...itemHandlers}
                  />
                ))
              )}
            </section>

            <section
              aria-label="Root Items"
              data-testid="mymaps-root-items"
              className={`border rounded p-1 min-h-[60px] ${rootDragOver ? "border-primary border-dashed border-2 bg-primary/10" : "border-base-300"}`}
              onDragOver={onRootDragOver}
              onDragLeave={() => setRootDragOver(false)}
              onDrop={onRootDrop}
            >
              <div className="px-1 pb-1 text-[11px] font-bold uppercase tracking-wide text-base-content/60">Root Items</div>
              {rootItems.map((item) => (
                <div key={item.id} data-testid="mymaps-item-wrapper" className="animate-[fadeIn_0.3s_ease-out]">
                  <MyMapsItem item={item} onLabelChange={onLabelChange} onDelete={onItemDelete} onShowOptions={onShowItemOptions} onHoverStart={onHoverStart} onHoverEnd={onHoverEnd} isEditing={isEditing} />
                </div>
              ))}
              {rootItems.length === 0 && <div className="px-1 py-2 text-xs italic text-base-content/50">Drag items here to move them to the root level.</div>}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default MyMapsItems;
