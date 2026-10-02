/**
 * App usage analytics.
 *
 * Sends the same events the legacy i-Map sends to py-Geomatics' analytics beacon
 * (POST /geomatics/analytics/event, app/analytics/routes.py), so NextJS usage shows up in the
 * existing py-Geomatics Analytics dashboard next to the old i-Map's. The /geomatics rewrite makes
 * the beacon same-origin, so py-Geomatics' own visitor/session cookies and login attribute each
 * event server-side - the client never sends identity.
 *
 * event_name must be one of the beacon's allowed catalog (session_started, layer.enabled,
 * layer.disabled, search.performed, mymaps.saved, filter.applied, export.performed,
 * basemap.changed, tool.opened, theme.opened, ui_action); anything else is silently dropped.
 * Every event carries metadata.client = "nextjs" so it can be told apart from the legacy app.
 *
 * Disabled with config.includeAppStats: false (legacy key; on by default). Best-effort: errors
 * are swallowed and nothing ever blocks the UI.
 */

import { useAppStore } from "@/stores/appStore";

// Same value as imapAuthStore's GEOMATICS_PATH; computed here so this tiny module stays
// dependency-free (it's imported all over the app).
const GEOMATICS_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/geomatics`;

export type AnalyticsEventName =
  | "session_started"
  | "layer.enabled"
  | "layer.disabled"
  | "search.performed"
  | "mymaps.saved"
  | "filter.applied"
  | "export.performed"
  | "basemap.changed"
  | "tool.opened"
  | "theme.opened"
  | "ui_action";

function isAppStatsEnabled(): boolean {
  const config = useAppStore.getState().config as { includeAppStats?: boolean } | null;
  if (!config) return false;
  return config.includeAppStats !== false;
}

/** Post one event to the py-Geomatics analytics beacon (fire-and-forget). */
export function trackEvent(eventName: AnalyticsEventName, entityType?: string | null, entityId?: string | null, metadata?: Record<string, unknown>): void {
  try {
    if (!isAppStatsEnabled()) return;
    const body = JSON.stringify({
      application: "imap",
      event_name: eventName,
      entity_type: entityType || undefined,
      entity_id: entityId || undefined,
      metadata: { client: "nextjs", ...metadata },
    });
    fetch(`${GEOMATICS_PATH}/analytics/event`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Requested-With": "XMLHttpRequest" },
      body,
      keepalive: true,
    }).catch(() => {
      // Intentionally swallowed - stats are best-effort
    });
  } catch {
    // Intentionally swallowed
  }
}

/** Generic usage stat (legacy addAppStat) - recorded as a "ui_action" event. */
export function addAppStat(type: string, description: string): void {
  trackEvent("ui_action", "ui_control", type, { description });
}

/** Track the app loading (legacy "session_started"). */
export function trackMapLoad(mapId: string): void {
  trackEvent("session_started", "map", mapId || null);
}

/** Track a theme being opened. */
export function trackTheme(themeName: string): void {
  trackEvent("theme.opened", "theme", themeName);
}

/** Track a tool being opened. */
export function trackTool(toolName: string): void {
  trackEvent("tool.opened", "tool", toolName);
}

/** Track the My Maps tab being opened. */
export function trackMyMaps(): void {
  addAppStat("MyMaps", "My Maps");
}

/** Track a basemap being selected. */
export function trackBasemap(basemapName: string): void {
  trackEvent("basemap.changed", "basemap", basemapName);
}

/**
 * Track a layer being turned on/off by the user. entityId is the GeoServer layer name, which is
 * what the legacy i-Map records, so the dashboard counts both apps' toggles together.
 */
export function trackLayer(layerName: string, groupName?: string, displayName?: string, enabled = true): void {
  trackEvent(enabled ? "layer.enabled" : "layer.disabled", "layer", layerName, { group: groupName, display_name: displayName });
}

/** Track a group being toggled on by the user. */
export function trackGroup(groupName: string): void {
  addAppStat("Group", groupName);
}

/** Track a search being run (the query itself is not recorded, only its length). */
export function trackSearch(searchType: string, query: string): void {
  trackEvent("search.performed", "search_type", searchType || "All", { query_length: query.length });
}
