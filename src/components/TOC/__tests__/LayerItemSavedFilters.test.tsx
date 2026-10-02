import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LayerItem from "../LayerItem";
import { useLayerManagerStore } from "@/stores/layerManagerStore";
import { useLayerFilterStore } from "@/stores/layerFilterStore";
import { useTOCStore, type TOCLayer, type TOCLayerGroup } from "@/stores/tocStore";
import { toggleSavedLayerFilter, deleteSavedLayerFilter } from "@/components/tools/SpatialReport/savedFilters";
import { clearLayerFilter } from "@/utils/mapFilter";

vi.mock("@/components/tools/SpatialReport/savedFilters", () => ({ toggleSavedLayerFilter: vi.fn(), deleteSavedLayerFilter: vi.fn() }));
vi.mock("@/utils/mapFilter", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/utils/mapFilter")>()), clearLayerFilter: vi.fn() }));

// A road_interests layer: unqualified in the TOC, saved against its qualified name
const layer = { id: "t1", managedLayerId: "m1", name: "connecting_links", tocDisplayName: "Connecting Links", visible: true, legendImage: null, legendObj: null } as unknown as TOCLayer;
const group = { value: "road_interests", label: "Road Interests", layers: [layer] } as unknown as TOCLayerGroup;
const FILTER = { id: "f1", name: "Hwy 11 only", createdAt: 0, criteria: { scope: "layer" as const, filters: [{ field: "hwy", operator: "eq", value: "11" }] } };

const renderItem = (onLayerChange = vi.fn()) =>
  render(<LayerItem layerInfo={layer} group={group} searchText="" onLayerChange={onLayerChange} onLegendToggle={vi.fn()} onLayerOptionsClick={vi.fn()} />);

describe("LayerItem saved filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTOCStore.setState({ allLayers: [layer] } as never);
    useLayerManagerStore.setState((s) => ({ layers: { ...s.layers, TOC: [{ id: "m1", name: "connecting_links", visible: true, metadata: { groupUrl: "/geoserver-proxy/road_interests/ows?service=wms" } }] } }) as never);
    useLayerFilterStore.setState({ saved: { "road_interests:connecting_links": [FILTER] }, activeFilterByLayer: {}, mapFilterActive: false });
  });

  it("lists the layer's saved filters and toggles one with its qualified name", async () => {
    renderItem();
    await userEvent.click(screen.getByText("Hwy 11 only"));
    expect(toggleSavedLayerFilter).toHaveBeenCalledWith("road_interests:connecting_links", FILTER);
  });

  it("deletes without also toggling", async () => {
    renderItem();
    await userEvent.click(screen.getByRole("button", { name: "Delete saved filter Hwy 11 only" }));
    expect(deleteSavedLayerFilter).toHaveBeenCalledWith("road_interests:connecting_links", "f1");
    expect(toggleSavedLayerFilter).not.toHaveBeenCalled();
  });

  it("clears an applied filter when the layer is turned off", async () => {
    useLayerFilterStore.setState({ activeFilterByLayer: { "road_interests:connecting_links": "f1" } });
    const onLayerChange = vi.fn();
    renderItem(onLayerChange);
    await userEvent.click(screen.getByRole("checkbox"));
    expect(clearLayerFilter).toHaveBeenCalledWith("road_interests:connecting_links");
    expect(onLayerChange).toHaveBeenCalled();
  });
});
