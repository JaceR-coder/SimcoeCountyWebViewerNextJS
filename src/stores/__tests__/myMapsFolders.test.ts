import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMyMapsStore, type MyMapsItem } from "@/stores/myMapsStore";

const http = { get: vi.fn(), post: vi.fn() };
vi.mock("@/lib/axiosInstance", () => ({ getAxiosClient: () => http }));

const storage: Record<string, string> = {};
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (k in storage ? storage[k] : null),
    setItem: (k: string, v: string) => (storage[k] = v),
    removeItem: (k: string) => delete storage[k],
    clear: () => Object.keys(storage).forEach((k) => delete storage[k]),
  },
});
Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => undefined) } });

const item = (id: string, patch: Partial<MyMapsItem> = {}): MyMapsItem => ({
  id,
  label: id,
  labelVisible: false,
  labelRotation: 0,
  featureGeoJSON: JSON.stringify({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { id } }),
  style: { fill: { color: [255, 0, 0, 0.8] } },
  visible: true,
  drawType: "Point",
  geometryType: "Point",
  ...patch,
});

const s = () => useMyMapsStore.getState();
const ids = (items: MyMapsItem[]) => items.map((i) => i.id);

// A share-link record exactly as the legacy SimcoeCountyWebViewer saves it (OL "_"-suffixed styles,
// folderId on every item, top-level folders/activeFolderId) - see web_search.tbl_mymaps
const LEGACY_SNAPSHOT = {
  drawType: "Cancel",
  drawColor: "#e90808",
  drawStyle: null,
  items: [
    {
      id: "OB6qXDXB-",
      label: "Drawing 55",
      folderId: "fld-hwy11",
      labelVisible: false,
      labelStyle: null,
      labelRotation: 0,
      featureGeoJSON: JSON.stringify({ type: "Feature", geometry: { type: "LineString", coordinates: [[-8790397.35, 5627848.68], [-8789971.76, 5626810.8]] }, properties: { id: "OB6qXDXB-", label: "Drawing 55", labelVisible: false, drawType: "LineString", isParcel: false } }),
      style: { geometry_: null, fill_: { color_: [233, 8, 8, 0.8] }, stroke_: { color_: [233, 8, 8, 0.8], lineDash_: null, width_: 3 }, image_: null, text_: null },
      visible: true,
      drawType: "LineString",
      geometryType: "LineString",
    },
    {
      id: "rootItem1",
      label: "Loose point",
      folderId: null,
      labelVisible: false,
      labelStyle: null,
      labelRotation: 0,
      featureGeoJSON: JSON.stringify({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { id: "rootItem1" } }),
      style: { geometry_: null, fill_: { color_: [0, 0, 255, 0.8] }, stroke_: null, image_: null, text_: null },
      visible: true,
      drawType: "Point",
      geometryType: "Point",
    },
  ],
  folders: [{ id: "fld-hwy11", label: "Hwy 11 work", panelOpen: true }],
  activeFolderId: null,
  isRootDragOver: false,
  toolTipClass: "sc-hidden",
  toolTipId: "abc",
  tooltipClass: "sc-hidden",
};

describe("My Maps folders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(storage).forEach((k) => delete storage[k]);
    useMyMapsStore.setState({ items: [], folders: [], activeFolderId: null, drawType: "Cancel" });
  });

  it("creates folders at the top with legacy's default names", () => {
    const first = s().createFolder();
    const second = s().createFolder();
    expect(s().folders.map((f) => f.label)).toEqual(["New Folder 2", "New Folder 1"]);
    expect(s().folders.map((f) => f.id)).toEqual([second, first]);
    expect(s().folders[0].panelOpen).toBe(true);
  });

  it("puts new items in the active workspace folder, unless the caller chose one", () => {
    const folder = s().createFolder("Work");
    s().addItem(item("a"));
    s().setActiveFolder(folder);
    s().addItem(item("b"));
    s().addItem(item("c", { folderId: null }));
    expect(s().items.find((i) => i.id === "a")!.folderId).toBeNull();
    expect(s().items.find((i) => i.id === "b")!.folderId).toBe(folder);
    expect(s().items.find((i) => i.id === "c")!.folderId).toBeNull();

    s().setActiveFolder(folder); // same folder again clears back to root
    expect(s().activeFolderId).toBeNull();
  });

  it("deletes only the folder - items move to root and it stops being active", () => {
    const folder = s().createFolder();
    s().setActiveFolder(folder);
    s().addItem(item("a"));
    s().deleteFolder(folder);
    expect(s().folders).toEqual([]);
    expect(s().items).toHaveLength(1);
    expect(s().items[0].folderId).toBeNull();
    expect(s().activeFolderId).toBeNull();
  });

  it("renames, collapses and toggles a folder's items", () => {
    const folder = s().createFolder();
    useMyMapsStore.setState({ items: [item("a", { folderId: folder }), item("b")] });
    s().renameFolder(folder, "Culverts");
    s().toggleFolder(folder);
    s().setFolderVisibility(folder, false);
    expect(s().folders[0]).toMatchObject({ label: "Culverts", panelOpen: false });
    expect(s().items.map((i) => i.visible)).toEqual([false, true]);
  });

  it("drag-reorders an item next to its target, across folders", () => {
    const folder = s().createFolder();
    useMyMapsStore.setState({ items: [item("a"), item("b", { folderId: folder }), item("c", { folderId: folder })] });
    s().reorderItem("a", "c", folder);
    expect(ids(s().items)).toEqual(["b", "a", "c"]);
    expect(s().items[1].folderId).toBe(folder);

    s().moveItemToFolder("a", null);
    expect(s().items[1].folderId).toBeNull();
  });

  it("round-trips folders through localStorage in the legacy shape", () => {
    const folder = s().createFolder("Work");
    s().setActiveFolder(folder);
    s().addItem(item("a"));

    const saved = JSON.parse(storage["myMaps"]);
    expect(saved.folders).toEqual([{ id: folder, label: "Work", panelOpen: true }]);
    expect(saved.activeFolderId).toBe(folder);
    expect(saved.items[0].folderId).toBe(folder);

    useMyMapsStore.setState({ items: [], folders: [], activeFolderId: null });
    s().loadFromStorage();
    expect(s().folders).toEqual([{ id: folder, label: "Work", panelOpen: true }]);
    expect(s().activeFolderId).toBe(folder);
    expect(s().items[0].folderId).toBe(folder);
  });

  it("imports a legacy share link with its folders", async () => {
    http.get.mockResolvedValue({ data: { id: "b0b1c79e-b1fb-11f1-8ec9-2fefa42d73f8", json: JSON.stringify(LEGACY_SNAPSHOT) } });

    const result = await s().importFromApi("b0b1c79e-b1fb-11f1-8ec9-2fefa42d73f8");

    expect(result.success).toBe(true);
    expect(s().folders).toEqual([{ id: "fld-hwy11", label: "Hwy 11 work", panelOpen: true }]);
    const drawing = s().items.find((i) => i.id === "OB6qXDXB-")!;
    expect(drawing.folderId).toBe("fld-hwy11");
    // legacy OL "_" style converted to this app's style JSON
    expect(drawing.style).toMatchObject({ stroke: { color: [233, 8, 8, 0.8], width: 3 } });
    expect(s().items.find((i) => i.id === "rootItem1")!.folderId).toBeNull();

    // importing again adds nothing twice
    await s().importFromApi("b0b1c79e-b1fb-11f1-8ec9-2fefa42d73f8");
    expect(s().folders).toHaveLength(1);
    expect(s().items).toHaveLength(2);
  });

  it("saves one folder to a shareable link, in a shape legacy's import merges", async () => {
    http.post.mockResolvedValue({ data: { id: "new-id" } });
    const folder = s().createFolder("Share me");
    useMyMapsStore.setState({ items: [item("in", { folderId: folder }), item("out")] });

    const result = await s().saveToApi({ folderId: folder });

    expect(result).toMatchObject({ success: true, id: "new-id" });
    const body = http.post.mock.calls[0][1];
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["in"]);
    expect(body.items[0].folderId).toBe(folder);
    expect(body.folders).toEqual([{ id: folder, label: "Share me", panelOpen: true }]);
    // legacy getStyleFromJSON reads OL "_"-suffixed styles
    expect(body.items[0].style).toMatchObject({ fill_: { color_: [255, 0, 0, 0.8] } });
  });

  it("won't save an empty folder", async () => {
    const folder = s().createFolder();
    const result = await s().saveToApi({ folderId: folder });
    expect(result.success).toBe(false);
    expect(http.post).not.toHaveBeenCalled();
  });
});
