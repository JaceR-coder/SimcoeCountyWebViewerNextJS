"use client";

/**
 * AttributeTablePopout
 * ----------------------------------------------------------------------------
 * Renders its children into a separate browser window (so the table can sit on another monitor)
 * through a React portal. The popup stays part of this app's React tree and JS context: stores,
 * map highlighting, zoom-to and select-from-map keep working against the main window's map.
 *
 * The popup starts as about:blank; the app's stylesheets are cloned into it (and kept in sync, for
 * styles injected later) along with the html `data-theme`. Closing the popup docks the table back.
 */

import React, { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

const WINDOW_NAME = "imap-attribute-table";
const WINDOW_FEATURES = "popup=yes,width=1200,height=600";

/** The popup's <body> when rendering inside it, else null - for portals (modals) that must open there. */
const PopoutBodyContext = createContext<HTMLElement | null>(null);
export const usePopoutBody = (): HTMLElement | null => useContext(PopoutBodyContext);

function cloneStyleNode(node: Node, doc: Document): Node | null {
  if (node instanceof HTMLLinkElement && node.rel === "stylesheet") {
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = node.href; // absolute - the popup's about:blank base may not resolve relative URLs
    return link;
  }
  if (node instanceof HTMLStyleElement) {
    const style = doc.createElement("style");
    style.textContent = node.textContent;
    return style;
  }
  return null;
}

interface Props {
  title: string;
  /** Called when the popup can't be opened (blocked) or the user closes it. */
  onClose: (reason: "blocked" | "closed") => void;
  children: React.ReactNode;
}

export default function AttributeTablePopout({ title, onClose, children }: Props): React.ReactElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const popup = window.open("", WINDOW_NAME, WINDOW_FEATURES);
    if (!popup) {
      onCloseRef.current("blocked");
      return;
    }
    const doc = popup.document;
    // Re-opening by name can return a window still holding a previous session's content
    doc.head.innerHTML = "";
    doc.body.innerHTML = "";
    doc.title = title;

    const mirrored = new Map<Node, Node>();
    const mirror = (node: Node) => {
      const copy = cloneStyleNode(node, doc);
      if (copy) {
        doc.head.appendChild(copy);
        mirrored.set(node, copy);
      }
    };
    document.head.querySelectorAll('link[rel="stylesheet"], style').forEach(mirror);
    const headObserver = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach(mirror);
        r.removedNodes.forEach((n) => {
          const copy = mirrored.get(n);
          if (copy?.parentNode) copy.parentNode.removeChild(copy);
          mirrored.delete(n);
        });
      }
    });
    headObserver.observe(document.head, { childList: true });

    const syncTheme = () => {
      const theme = document.documentElement.getAttribute("data-theme");
      if (theme) doc.documentElement.setAttribute("data-theme", theme);
      else doc.documentElement.removeAttribute("data-theme");
    };
    syncTheme();
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    doc.body.style.margin = "0";
    doc.body.className = "bg-base-100 text-base-content";
    const root = doc.createElement("div");
    root.style.height = "100vh";
    doc.body.appendChild(root);
    setContainer(root);

    // User closed the popup -> dock back. pagehide also fires when we close it ourselves on
    // unmount, so detach first in cleanup.
    const onPopupHide = () => onCloseRef.current("closed");
    popup.addEventListener("pagehide", onPopupHide);
    // Main window reloading/navigating: don't leave an orphaned popup behind
    const onMainUnload = () => popup.close();
    window.addEventListener("pagehide", onMainUnload);

    popup.focus();

    return () => {
      headObserver.disconnect();
      themeObserver.disconnect();
      popup.removeEventListener("pagehide", onPopupHide);
      window.removeEventListener("pagehide", onMainUnload);
      setContainer(null);
      popup.close();
    };
    // Open once per mount; the title is updated by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (container?.ownerDocument) container.ownerDocument.title = title;
  }, [container, title]);

  if (!container) return null;
  return createPortal(<PopoutBodyContext.Provider value={container.ownerDocument.body}>{children}</PopoutBodyContext.Provider>, container);
}
