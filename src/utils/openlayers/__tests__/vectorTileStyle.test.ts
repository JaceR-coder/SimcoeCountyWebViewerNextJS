import { describe, it, expect } from "vitest";
import { isAbsoluteUrl, resolveStyleUrls } from "../vectorTileStyle";

const ROOT = "https://tiles.arcgis.com/tiles/TJH5KDher0W13Kgo/arcgis/rest/services/Ontario_Vector_Topographic_Data_Cache_Service/VectorTileServer/resources/styles/root.json";
const SERVER = "https://tiles.arcgis.com/tiles/TJH5KDher0W13Kgo/arcgis/rest/services/Ontario_Vector_Topographic_Data_Cache_Service/VectorTileServer";

describe("resolveStyleUrls", () => {
  it("resolves an Esri root.json's relative sprite, glyphs and source against the style URL", () => {
    // exactly what the MNR LIO Topo Beta VectorTileServer's root.json contains
    const style = resolveStyleUrls({ sprite: "../sprites/sprite", glyphs: "../fonts/{fontstack}/{range}.pbf", sources: { esri: { url: "../../" } } }, ROOT);
    expect(style.sprite).toBe(`${SERVER}/resources/sprites/sprite`);
    expect(style.glyphs).toBe(`${SERVER}/resources/fonts/{fontstack}/{range}.pbf`); // placeholders kept
    expect(style.sources!.esri.url).toBe(`${SERVER}/`);
  });

  it("leaves absolute URLs (the bundled /basemap styles) unchanged", () => {
    const sprite = "https://tiles.arcgis.com/tiles/B6yKvIZqzuOr0jBR/arcgis/rest/services/Canada_Topographic/VectorTileServer/resources/styles/../sprites/sprite";
    const tiles = ["https://example.com/tile/{z}/{y}/{x}.pbf"];
    const style = resolveStyleUrls({ sprite, sources: { esri: { tiles: [...tiles] } } }, ROOT);
    expect(style.sources!.esri.tiles).toEqual(tiles);
    expect(style.sprite).toBe(new URL(sprite).href); // same resource, "../" normalised
  });

  it("tells remote style URLs from bundled paths", () => {
    expect(isAbsoluteUrl(ROOT)).toBe(true);
    expect(isAbsoluteUrl("/basemap/ESRI_LightGrey.json")).toBe(false);
  });
});
