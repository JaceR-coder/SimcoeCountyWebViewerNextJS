import { describe, it, expect, vi, afterEach } from "vitest";
import { getGroupsFromGeoServer, sortGroups } from "@/utils/tocHelpers";
import localConfig from "@/config.json";
import type { TOCSource } from "@/stores/tocStore";

// Trimmed NER_Works umbrella capabilities: sub-groups nested under the umbrella layer group.
// "work_and_testing" is the case that broke with per-group URLs - its name is also a GeoServer
// workspace, and its only member lives in ANOTHER workspace.
const layer = (name: string, title: string) => `<Layer queryable="1"><Name>${name}</Name><Title>${title}</Title><CRS>EPSG:3857</CRS></Layer>`;
const group = (name: string, title: string, layers: string) => `<Layer><Name>${name}</Name><Title>${title}</Title>${layers}</Layer>`;
const CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<WMS_Capabilities version="1.3.0" xmlns="http://www.opengis.net/wms" xmlns:xlink="http://www.w3.org/1999/xlink">
  <Service><Name>WMS</Name><Title>GeoServer</Title></Service>
  <Capability>
    <Request><GetCapabilities><Format>text/xml</Format></GetCapabilities></Request>
    <Layer><Title>GeoServer Web Map Service</Title>
      ${group(
        "NER_Works",
        "NER Works",
        [
          group("work_and_testing", "Custom Layers", layer("other_regional_data:count_stations_2020_mv", "Count Stations LHRS Jan 2020")),
          group("Culvert_Portal", "Culverts - Non-Structural", layer("culverts:culverts_ns", "Culverts")),
          group("chainage_factory:chainage_factory", "Chainage Factory", layer("chainage_factory:chainage", "Chainage")),
          group("LHRS", "LHRS", layer("other_regional_data:lhrs_routes", "LHRS Routes")),
        ].join(""),
      )}
    </Layer>
  </Capability>
</WMS_Capabilities>`;

const UMBRELLA_URL = "/geoserver-proxy/NER_Works/ows?service=wms&version=1.3.0&request=GetCapabilities";

const source: TOCSource = {
  layerUrl: UMBRELLA_URL,
  urlType: "group",
  type: "geoserver",
  secure: false,
  primary: true,
  sortGroups: true,
  groupDisplayNames: { Culvert_Portal: "Non-Structural Culverts" },
  excludeGroups: ["chainage_factory"],
};

describe("getGroupsFromGeoServer - umbrella layer group (urlType 'group')", () => {
  afterEach(() => vi.unstubAllGlobals());

  const load = async (overrides: Partial<TOCSource> = {}) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(CAPABILITIES, { status: 200 })));
    return getGroupsFromGeoServer({ ...source, ...overrides }, localConfig as unknown as Parameters<typeof getGroupsFromGeoServer>[1]);
  };

  it("keeps GeoServer's group order by default, and the TOC store's group sort doesn't undo it", async () => {
    const groups = await load({ sortGroups: false });
    const geoServerOrder = ["Custom Layers", "Non-Structural Culverts", "LHRS"];
    expect(groups.map((g) => g.label)).toEqual(geoServerOrder);
    // setLayerGroups runs every load through sortGroups(), which used to re-sort by group name
    expect(sortGroups(groups.map((g) => ({ ...g, primary: true }))).map((g) => g.label)).toEqual(geoServerOrder);
  });

  it("turns each sub-group into a TOC group with its real members, sorted and filtered", async () => {
    const groups = await load();
    expect(groups.map((g) => g.label)).toEqual(["Custom Layers", "LHRS", "Non-Structural Culverts"]);
    const custom = groups.find((g) => g.value === "work_and_testing")!;
    expect(custom.layers.map((l) => l.name)).toEqual(["other_regional_data:count_stations_2020_mv"]);
  });

  it("points sub-groups at the umbrella URL, not the workspace-colliding /<group>/ows", async () => {
    const groups = await load();
    for (const g of groups) expect(g.wmsGroupUrl).toBe(UMBRELLA_URL);
  });

  it("gives proxied layers clean global WMS/WFS/REST URLs", async () => {
    const [custom] = await load();
    const l = custom.layers[0];
    expect(l.serverUrl).toBe("/geoserver-proxy/");
    expect(l.wfsUrl).toMatch(/^\/geoserver-proxy\/wfs\?service=wfs&.*typeNames=other_regional_data:count_stations_2020_mv/);
    expect(l.metadataUrl).toBe("/geoserver-proxy/rest/layers/other_regional_data:count_stations_2020_mv.json");
  });
});
