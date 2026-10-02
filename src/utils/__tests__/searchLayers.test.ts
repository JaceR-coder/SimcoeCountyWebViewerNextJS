import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLayerManagerStore } from "@/stores/layerManagerStore";
import { useTOCStore } from "@/stores/tocStore";
import { activateSearchResultLayers, parseAssocLayers, resolveAssocLayers } from "../searchLayers";

// Real names from the NER GeoServer groups vs web_search.tbl_search_layers entries
const managed = (id: string, name: string, groupUrl = "/geoserver-proxy/Group/ows") => ({ id, name, visible: false, metadata: { groupUrl } });

describe("search result layer activation", () => {
  beforeEach(() => {
    useLayerManagerStore.setState((s) => ({
      layers: {
        ...s.layers,
        TOC: [
          managed("m1", "contracts:provincial_construction_history_view_base_with_links"),
          // road_interests is workspace-scoped: bare name in the TOC, workspace renamed since the table was written
          managed("m2", "fifty_fifty_agreements_view", "/geoserver-proxy/road_interests/ows?service=wms"),
          // two layers differing only by case
          managed("m3", "traffic_operations_centre:onctms"),
          managed("m4", "traffic_operations_centre:ONCTMS"),
          // same bare name in two workspaces
          managed("m5", "other_regional_data:railway_crossings"),
          managed("m6", "collector_data_backups:railway_crossings"),
        ],
      },
    }) as never);
  });

  it("parses legacy assoc_layers", () => {
    expect(parseAssocLayers("a:b@Roads, c:d@Geomatics")).toEqual(["a:b", "c:d"]);
    expect(parseAssocLayers(null)).toEqual([]);
  });

  it("matches qualified names, renamed workspaces, and exact case first", () => {
    expect(resolveAssocLayers(["contracts:provincial_construction_history_view_base_with_links"])).toEqual(["m1"]);
    expect(resolveAssocLayers(["road_interest:fifty_fifty_agreements_view"])).toEqual(["m2"]);
    expect(resolveAssocLayers(["traffic_op_centre:onctms"])).toEqual(["m3"]);
  });

  it("won't guess between same-named layers in different workspaces, or missing layers", () => {
    expect(resolveAssocLayers(["OpenLayer_Groups:railway_crossings"])).toEqual([]);
    expect(resolveAssocLayers(["geotech:First Rights of Refusal"])).toEqual([]);
  });

  it("turns the matched TOC layers on", () => {
    const updateLayerVisibilityById = vi.fn();
    useTOCStore.setState({
      allLayers: [
        { id: "t1", managedLayerId: "m1", visible: false },
        { id: "t2", managedLayerId: "m2", visible: true }, // already on
      ],
      updateLayerVisibilityById,
    } as never);
    const n = activateSearchResultLayers("contracts:provincial_construction_history_view_base_with_links@x,road_interest:fifty_fifty_agreements_view@Roads");
    expect(n).toBe(1);
    expect(updateLayerVisibilityById).toHaveBeenCalledWith("t1", true);
  });
});
