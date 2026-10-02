/**
 * i-Map auth store - py-Geomatics account/permission state for the UI.
 *
 * Mirrors the legacy SimcoeCountyWebViewer's helpers/imapAuth.js: reads py-Geomatics'
 * /imap/token (same-origin via the /geomatics rewrite, so the py-Geomatics session cookie is
 * sent) to learn who the caller is and which `workspace:layer` names they're granted. Anonymous
 * callers get the public layer set.
 *
 * This is display-only - it drives the profile button and TOC lock icons. Enforcement happens
 * server-side: every GeoServer request goes through /geoserver-proxy (src/app/geoserver-proxy),
 * which attaches the caller's token and lets py-Geomatics' proxy 403 anything not granted.
 */

import { create } from "zustand";
import { basePath } from "@/lib/axiosInstance";

export const GEOMATICS_PATH = `${basePath}/geomatics`;

// Refresh this long before expiry so the lock state tracks grant changes and logouts elsewhere
const REFRESH_MARGIN_MS = 30_000;
const MIN_REFRESH_MS = 5_000;
// Throttle for the return-to-tab re-check (visibilitychange and focus often fire together)
const FOCUS_RECHECK_MS = 3_000;

interface ImapAuthState {
  status: "idle" | "loading" | "ready" | "error";
  /** Display name when logged in to py-Geomatics, else null (anonymous) */
  userDisplayName: string | null;
  allLayers: boolean;
  /** Lower-cased `workspace:layer` names */
  grantedLayers: Set<string>;
  expiresAt: number;

  refresh: () => Promise<void>;
  start: () => void;
  stop: () => void;
  loginUrl: () => string;
  logout: () => Promise<void>;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let visibilityHandler: (() => void) | null = null;

export const useImapAuthStore = create<ImapAuthState>()((set, get) => ({
  status: "idle",
  userDisplayName: null,
  allLayers: false,
  grantedLayers: new Set(),
  expiresAt: 0,

  refresh: async () => {
    if (get().status === "idle") set({ status: "loading" });
    try {
      const res = await fetch(`${GEOMATICS_PATH}/imap/token`, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error(`token request failed (${res.status})`);
      const data: { expires_in?: number; all_layers?: boolean; layers?: string[]; user_display_name?: string | null } = await res.json();
      const ttlMs = (data.expires_in || 300) * 1000;
      set({
        status: "ready",
        userDisplayName: data.user_display_name || null,
        allLayers: !!data.all_layers,
        grantedLayers: new Set((data.layers || []).map((n) => n.toLowerCase())),
        expiresAt: Date.now() + ttlMs,
      });
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => get().refresh(), Math.max(ttlMs - REFRESH_MARGIN_MS, MIN_REFRESH_MS));
    } catch (error) {
      console.error("[imapAuth] could not load py-Geomatics access info:", error);
      // Keep the last known state if we had one; retry shortly either way
      set((s) => ({ status: s.status === "ready" ? "ready" : "error" }));
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => get().refresh(), 30_000);
    }
  },

  start: () => {
    if (!visibilityHandler && typeof window !== "undefined") {
      // Re-check whenever the user comes back to this tab: they may have logged in or out of
      // py-Geomatics in another tab (its cookie is shared), and background tabs throttle timers.
      let lastCheck = 0;
      visibilityHandler = () => {
        if (document.visibilityState !== "visible" || Date.now() - lastCheck < FOCUS_RECHECK_MS) return;
        lastCheck = Date.now();
        get().refresh();
      };
      document.addEventListener("visibilitychange", visibilityHandler);
      window.addEventListener("focus", visibilityHandler);
    }
    if (get().status === "idle") get().refresh();
  },

  stop: () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    if (visibilityHandler) {
      document.removeEventListener("visibilitychange", visibilityHandler);
      window.removeEventListener("focus", visibilityHandler);
    }
    visibilityHandler = null;
  },

  // py-Geomatics only honours a relative `next`, which is exactly what we have: the rewrite
  // keeps its login page on this origin, so it redirects straight back to the map.
  loginUrl: () => {
    const here = typeof window !== "undefined" ? window.location.pathname + window.location.search : "/";
    return `${GEOMATICS_PATH}/loginuser/login?next=${encodeURIComponent(here)}`;
  },

  logout: async () => {
    try {
      // Its redirect lands on the py-Geomatics login page - we only need the session cleared
      await fetch(`${GEOMATICS_PATH}/loginuser/logout`, { credentials: "same-origin", redirect: "manual" });
    } catch (error) {
      console.error("[imapAuth] logout failed:", error);
    }
    await get().refresh();
  },
}));

/**
 * Whether a TOC layer should show as locked. Only GeoServer layers served through
 * /geoserver-proxy are subject to py-Geomatics permissions - user-added, ArcGIS, WMTS or
 * directly-referenced GeoServer layers never are, so they're never shown locked. Same rule as the
 * legacy imapAuth.isLayerLocked(); until the first token response arrives nothing is shown locked
 * (the server still enforces), so the TOC doesn't flash locks on load.
 */
export function isTocLayerLocked(
  state: Pick<ImapAuthState, "status" | "allLayers" | "grantedLayers">,
  layer: { name?: string; userLayer?: boolean; wfsUrl?: string; serverUrl?: string },
): boolean {
  if (layer.userLayer || !layer.name || !layer.name.includes(":")) return false;
  const url = layer.wfsUrl || layer.serverUrl || "";
  if (!url.includes("/geoserver-proxy/")) return false;
  if (state.status !== "ready" || state.allLayers) return false;
  return !state.grantedLayers.has(layer.name.toLowerCase());
}
