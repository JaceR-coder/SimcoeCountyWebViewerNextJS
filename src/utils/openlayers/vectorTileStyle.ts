/**
 * Makes a remote Mapbox/Esri vector tile style usable when loaded as an object.
 *
 * An Esri VectorTileServer's resources/styles/root.json uses paths relative to itself
 * ("sprite": "../sprites/sprite", "glyphs": "../fonts/{fontstack}/{range}.pbf", source
 * "url": "../../"). Once fetched and handed to applyStyle as an object those would resolve against
 * the page instead, so they're resolved against the style's own URL here. Already-absolute values
 * are left alone, so the app's bundled /basemap/*.json styles (pre-resolved) pass through unchanged.
 */

type GlSource = { url?: string; tiles?: string[] };
type GlStyle = { sprite?: unknown; glyphs?: unknown; sources?: Record<string, GlSource> };

/** new URL() percent-encodes the {fontstack}/{z}-style placeholders; put them back */
const resolve = (value: string, base: string) => new URL(value, base).href.replace(/%7B/gi, "{").replace(/%7D/gi, "}");

export function resolveStyleUrls<T extends GlStyle>(glStyle: T, styleUrl: string): T {
  if (typeof glStyle.sprite === "string") glStyle.sprite = resolve(glStyle.sprite, styleUrl);
  if (typeof glStyle.glyphs === "string") glStyle.glyphs = resolve(glStyle.glyphs, styleUrl);
  Object.values(glStyle.sources || {}).forEach((src) => {
    if (!src || typeof src !== "object") return;
    if (typeof src.url === "string") src.url = resolve(src.url, styleUrl);
    if (Array.isArray(src.tiles)) src.tiles = src.tiles.map((t) => resolve(t, styleUrl));
  });
  return glStyle;
}

export const isAbsoluteUrl = (value: string) => /^https?:\/\//i.test(value);
