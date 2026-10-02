import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useAttributeTableLoader } from "@/hooks/useAttributeTableLoader";
import { useAttributeTableStore } from "@/stores/attributeTableStore";
import type { TOCLayer } from "@/stores/tocStore";

const wfs = vi.hoisted(() => ({
  describeFeatureType: vi.fn(),
  fetchWfsCount: vi.fn(),
  fetchWfsPage: vi.fn(),
}));

vi.mock("@/lib/attributeTable/wfs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/attributeTable/wfs")>()),
  ...wfs,
}));

const extent = vi.hoisted(() => ({ current: null as [number, number, number, number] | null }));
vi.mock("@/lib/attributeTable/mapIntegration", () => ({
  cacheGeometries: vi.fn(),
  getCurrentMapExtent: () => extent.current,
}));

const layer = { id: "parcels", name: "ner_works:assessment_parcel", displayName: "Parcels", wfsUrl: "/geoserver-proxy/wfs" } as unknown as TOCLayer;

describe("useAttributeTableLoader server-side filters", () => {
  beforeEach(() => {
    useAttributeTableStore.getState().closeAll();
    vi.clearAllMocks();
    extent.current = null;
    wfs.describeFeatureType.mockResolvedValue([
      { name: "wkb_geometry", type: "string", nillable: true, isGeometry: true, isIdLike: false },
      { name: "mto_index", type: "number", nillable: false, isGeometry: false, isIdLike: true },
      { name: "address", type: "string", nillable: true, isGeometry: false, isIdLike: false },
    ]);
    wfs.fetchWfsCount.mockResolvedValue(5000);
    wfs.fetchWfsPage.mockResolvedValue({ features: [{ id: "f.1", properties: { mto_index: 1, address: "1 MAIN ST" } }], numberMatched: 5000, numberReturned: 1 });
  });

  async function openAndLoad() {
    act(() => useAttributeTableStore.getState().openForLayer(layer));
    renderHook(() => useAttributeTableLoader());
    await waitFor(() => expect(useAttributeTableStore.getState().tabs[0].store).not.toBeNull());
  }

  it("sends column filters to the server for both the count and the page", async () => {
    await openAndLoad();
    expect(wfs.fetchWfsPage.mock.calls[0][0].cqlFilter).toBeUndefined();

    wfs.fetchWfsCount.mockResolvedValue(12);
    act(() => useAttributeTableStore.getState().setFilter(layer.id, "address", "Main"));

    const cql = `strToLowerCase("address") LIKE '%main%'`;
    await waitFor(() => expect(wfs.fetchWfsPage).toHaveBeenLastCalledWith(expect.objectContaining({ cqlFilter: cql, startIndex: 0 })));
    expect(wfs.fetchWfsCount).toHaveBeenLastCalledWith(expect.objectContaining({ cqlFilter: cql }));
    await waitFor(() => expect(useAttributeTableStore.getState().tabs[0].totalCount).toBe(12));
  });

  it("combines a filter with the map extent inside the CQL", async () => {
    await openAndLoad();
    extent.current = [10, 20, 30, 40];
    act(() => {
      useAttributeTableStore.getState().setBboxFilterActive(layer.id, true);
      useAttributeTableStore.getState().setFilter(layer.id, "address", "main");
    });

    await waitFor(() =>
      expect(wfs.fetchWfsPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ cqlFilter: `strToLowerCase("address") LIKE '%main%' AND BBOX("wkb_geometry", 10, 20, 30, 40, 'EPSG:3857')` }),
      ),
    );
  });
});
