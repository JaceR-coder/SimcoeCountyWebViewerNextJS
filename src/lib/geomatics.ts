/**
 * Server-side helpers for the py-Geomatics account/permission integration.
 *
 * py-Geomatics owns i-Map's accounts, groups and per-layer `imap.layer.*` permissions. Its
 * `/imap/token` endpoint issues a short-lived JWT describing the caller (anonymous callers get the
 * public layer set), and its `/imap/geoserver/*` proxy enforces that JWT's layer grants on every
 * GeoServer request. The browser reaches py-Geomatics same-origin through the `/geomatics/*`
 * rewrite in next.config.ts, so its session cookie is scoped to this app's origin and arrives on
 * every request here - which is what lets the GeoServer route handler mint a token per caller.
 */

import { createHash } from "crypto";

export const GEOMATICS_URL = (process.env.GEOMATICS_URL || "https://ops-mz0075jf.cihs.ad.gov.on.ca/geomatics").replace(/\/+$/, "");

/** Cookies py-Geomatics uses to identify a logged-in user (Flask session + Flask-Login remember-me). */
const AUTH_COOKIES = ["session", "remember_token"];

export interface ImapTokenResponse {
  token: string;
  expires_in: number;
  all_layers: boolean;
  layers: string[];
  user_display_name: string | null;
}

/** Only py-Geomatics' own auth cookies are forwarded - never this app's NextAuth or other cookies. */
export function geomaticsCookieHeader(cookies: { get(name: string): { value: string } | undefined }): string {
  return AUTH_COOKIES.map((name) => {
    const value = cookies.get(name)?.value;
    return value ? `${name}=${value}` : null;
  })
    .filter(Boolean)
    .join("; ");
}

interface CacheEntry {
  token: string;
  refreshAt: number;
}

const MAX_CACHE_ENTRIES = 1000;
// Refresh this long before py-Geomatics' own expiry so an in-flight request never carries a dead token
const EXPIRY_MARGIN_MS = 30_000;

const globalForCache = globalThis as unknown as { imapTokenCache?: Map<string, CacheEntry> };
const tokenCache = globalForCache.imapTokenCache ?? new Map<string, CacheEntry>();
globalForCache.imapTokenCache = tokenCache;

function cacheKey(cookieHeader: string): string {
  return cookieHeader ? createHash("sha256").update(cookieHeader).digest("hex") : "anon";
}

export async function fetchImapToken(cookieHeader: string): Promise<ImapTokenResponse> {
  const res = await fetch(`${GEOMATICS_URL}/imap/token`, {
    headers: cookieHeader ? { Cookie: cookieHeader } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    const hint = res.status === 404 ? " - check GEOMATICS_URL includes py-Geomatics' /geomatics prefix" : "";
    throw new Error(`py-Geomatics token request failed (${res.status}) for ${GEOMATICS_URL}/imap/token${hint}`);
  }
  return res.json();
}

/**
 * The caller's i-Map token, cached per py-Geomatics session. GeoServer tiles arrive in bursts
 * while panning, so without this every tile would cost an extra token round trip.
 */
export async function getImapToken(cookieHeader: string, { forceRefresh = false } = {}): Promise<string> {
  const key = cacheKey(cookieHeader);
  const now = Date.now();
  const cached = tokenCache.get(key);
  if (cached && !forceRefresh && cached.refreshAt > now) return cached.token;

  const data = await fetchImapToken(cookieHeader);
  const ttlMs = (data.expires_in || 300) * 1000;
  if (tokenCache.size >= MAX_CACHE_ENTRIES) {
    for (const [k, v] of tokenCache) if (v.refreshAt <= now) tokenCache.delete(k);
    if (tokenCache.size >= MAX_CACHE_ENTRIES) tokenCache.clear();
  }
  tokenCache.set(key, { token: data.token, refreshAt: now + Math.max(ttlMs - EXPIRY_MARGIN_MS, 5_000) });
  return data.token;
}

/** For tests */
export function clearImapTokenCache(): void {
  tokenCache.clear();
}
