import { describe, it, expect, vi, beforeEach } from "vitest";
import ImageWMS from "ol/source/ImageWMS";
import ImageLayer from "ol/layer/Image";
import { useLayerManagerStore } from "@/stores/layerManagerStore";
import { useLayerFilterStore } from "@/stores/layerFilterStore";
import { useTOCStore } from "@/stores/tocStore";
import { applyLayerFilter, applyMapFilter, clearLayerFilter, clearMapFilter, postImageLoadFunction, qualifiedLayerName, wmsRequest } from "../mapFilter";

function tocLayer(id: string, name: string, groupUrl: string, opts: { secured?: boolean } = {}) {
  const source = new ImageWMS({ url: "/geoserver-proxy/wms", params: { LAYERS: name } });
  const layer = new ImageLayer({ source });
  return { managed: { id, name, visible: true, layer, metadata: { groupUrl, secured: !!opts.secured } }, source };
}

const view = { getCenter: vi.fn(() => [1, 2]), getZoom: vi.fn(() => 7), fit: vi.fn(), animate: vi.fn() };

let culverts: ReturnType<typeof tocLayer>;
let links: ReturnType<typeof tocLayer>;
let linksCopy: ReturnType<typeof tocLayer>;

describe("mapFilter", () => {
  beforeEach(() => {
    clearMapFilter();
    vi.clearAllMocks();
    culverts = tocLayer("m1", "ws:culverts", "/geoserver-proxy/Culvert_Portal/ows?service=wms");
    // road_interests is a workspace virtual service: unqualified names, same layer in two TOC groups
    links = tocLayer("m2", "connecting_links", "/geoserver-proxy/road_interests/ows?service=wms");
    linksCopy = tocLayer("m3", "connecting_links", "/geoserver-proxy/road_interests/ows?service=wms");
    useLayerManagerStore.setState((s) => ({ layers: { ...s.layers, TOC: [culverts.managed, links.managed, linksCopy.managed] } }) as never);
    useLayerFilterStore.setState({ activeFilterByLayer: {}, mapFilterActive: false });
    (window as unknown as { map: unknown }).map = { getView: () => view };
  });

  it("qualifies names from workspace-scoped sources", () => {
    expect(qualifiedLayerName({ name: "connecting_links", metadata: { groupUrl: "/geoserver-proxy/road_interests/ows?service=wms" } })).toBe("road_interests:connecting_links");
    expect(qualifiedLayerName({ name: "other_regional_data:lhrs_routes", metadata: { groupUrl: "/geoserver-proxy/LHRS/ows" } })).toBe("other_regional_data:lhrs_routes");
    expect(qualifiedLayerName({ name: "Imagery_2020", metadata: {} })).toBeUndefined();
  });

  it("filters every copy of each target layer in place, loads by POST and zooms to the matches", () => {
    const originalLoader = links.source.getImageLoadFunction();
    const zoomed = applyMapFilter({
      targets: [
        { layer: "road_interests:connecting_links", cql_filter: "hwy = '11'", matched_count: 3 },
        { layer: "ws:culverts", cql_filter: null, matched_count: 0 },
      ],
      combined_extent: [600000, 4900000, 610000, 4910000],
      working_srid: 26917,
    });

    expect(zoomed).toBe(true);
    expect(view.fit).toHaveBeenCalled();
    for (const { source } of [links, linksCopy]) {
      expect(source.getParams().CQL_FILTER).toBe("hwy = '11'");
      expect(source.getImageLoadFunction()).toBe(postImageLoadFunction);
    }
    expect(links.source.getImageLoadFunction()).not.toBe(originalLoader);
    expect(culverts.source.getParams().CQL_FILTER).toBeUndefined();
    expect(useLayerFilterStore.getState().mapFilterActive).toBe(true);
  });

  it("restores the original params, loader and view on clear", () => {
    const originalLoader = links.source.getImageLoadFunction();
    applyMapFilter({ targets: [{ layer: "road_interests:connecting_links", cql_filter: "a = 1", matched_count: 1 }], combined_extent: null, working_srid: 26917 });
    applyMapFilter({ targets: [{ layer: "road_interests:connecting_links", cql_filter: "a = 2", matched_count: 1 }], combined_extent: null, working_srid: 26917 });

    clearMapFilter();

    expect(links.source.getParams().CQL_FILTER).toBeUndefined();
    expect(links.source.getImageLoadFunction()).toBe(originalLoader);
    expect(view.animate).toHaveBeenCalledWith(expect.objectContaining({ center: [1, 2], zoom: 7 }));
    expect(useLayerFilterStore.getState().mapFilterActive).toBe(false);
  });

  it("keeps a secured layer's own loader", () => {
    const secured = tocLayer("m4", "ws:secret", "/geoserver-proxy/Geomatics/ows", { secured: true });
    useLayerManagerStore.setState((s) => ({ layers: { ...s.layers, TOC: [secured.managed] } }) as never);
    const loader = secured.source.getImageLoadFunction();
    applyMapFilter({ targets: [{ layer: "ws:secret", cql_filter: "a = 1", matched_count: 1 }], combined_extent: null, working_srid: 26917 });
    expect(secured.source.getParams().CQL_FILTER).toBe("a = 1");
    expect(secured.source.getImageLoadFunction()).toBe(loader);
  });

  it("applies and clears a single saved filter without touching the view", () => {
    const updateVis = vi.fn();
    useTOCStore.setState({ allLayers: [{ id: "t1", managedLayerId: "m1", visible: false }], updateLayerVisibilityById: updateVis } as never);

    expect(applyLayerFilter("ws:culverts", "a = 1", "f1")).toBe(true);
    expect(updateVis).toHaveBeenCalledWith("t1", true); // turned the layer on
    expect(culverts.source.getParams().CQL_FILTER).toBe("a = 1");
    expect(useLayerFilterStore.getState().activeFilterByLayer).toEqual({ "ws:culverts": "f1" });
    expect(view.fit).not.toHaveBeenCalled();

    clearLayerFilter("ws:culverts");
    expect(culverts.source.getParams().CQL_FILTER).toBeUndefined();
    expect(useLayerFilterStore.getState().activeFilterByLayer).toEqual({});
    expect(useLayerFilterStore.getState().mapFilterActive).toBe(false);
  });

  it("GETs short WMS URLs and POSTs long ones", async () => {
    const client = { get: vi.fn(), post: vi.fn() };
    await wmsRequest(client as never, "/geoserver-proxy/wms?REQUEST=GetFeatureInfo&CQL_FILTER=a%3D1");
    expect(client.get).toHaveBeenCalled();

    const longCql = "x".repeat(5000);
    await wmsRequest(client as never, `/geoserver-proxy/wms?REQUEST=GetFeatureInfo&CQL_FILTER=${longCql}`, { timeout: 5 });
    expect(client.post).toHaveBeenCalledWith("/geoserver-proxy/wms", `REQUEST=GetFeatureInfo&CQL_FILTER=${longCql}`, expect.objectContaining({ timeout: 5, headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
  });
});
