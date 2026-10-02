/**
 * Drag-and-drop plumbing shared by the My Maps item rows (drag source + reorder target), folder
 * headers and the Root Items section (move targets) - legacy MyMapsItem.jsx / MyMapsFolder.jsx.
 *
 * A private MIME type rather than legacy's text/plain, so dragging ordinary text (or a file) over
 * the list can't be mistaken for a My Maps item.
 */

import type React from "react";

export const MYMAPS_ITEM_DRAG_TYPE = "application/x-mymaps-item-id";

export function startItemDrag(evt: React.DragEvent, itemId: string, dragImage?: Element | null) {
  evt.dataTransfer.effectAllowed = "move";
  evt.dataTransfer.setData(MYMAPS_ITEM_DRAG_TYPE, itemId);
  // Only the handle is draggable (a draggable row would fight text selection in the label), but
  // preview the whole row
  if (dragImage) evt.dataTransfer.setDragImage(dragImage, 0, 0);
}

/** True while a My Maps item (not text/files) is being dragged - drop targets only react to these */
export const isItemDrag = (evt: React.DragEvent) => Array.from(evt.dataTransfer.types || []).includes(MYMAPS_ITEM_DRAG_TYPE);

export const draggedItemId = (evt: React.DragEvent) => evt.dataTransfer.getData(MYMAPS_ITEM_DRAG_TYPE);
