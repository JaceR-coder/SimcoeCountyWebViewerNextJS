import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MyMapsItems from "@/components/myMaps/MyMapsItems";
import MyMapsItemPopup from "@/components/myMaps/MyMapsItemPopup";
import { useMyMapsStore, type MyMapsItem } from "@/stores/myMapsStore";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const item = (id: string, patch: Partial<MyMapsItem> = {}): MyMapsItem => ({
  id,
  label: `Item ${id}`,
  labelVisible: false,
  labelRotation: 0,
  featureGeoJSON: "",
  style: {},
  visible: true,
  drawType: "Point",
  geometryType: "Point",
  ...patch,
});

/** Minimal DataTransfer: jsdom's drag events don't carry one */
function dataTransfer() {
  const data: Record<string, string> = {};
  return {
    data,
    get types() {
      return Object.keys(data);
    },
    setData: (type: string, value: string) => (data[type] = value),
    getData: (type: string) => data[type] ?? "",
    setDragImage: vi.fn(),
    effectAllowed: "",
    dropEffect: "",
  };
}

/** Drag the item's handle onto target */
function drag(itemLabel: string, target: Element) {
  const dt = dataTransfer();
  fireEvent.dragStart(screen.getByLabelText(`Drag ${itemLabel}`), { dataTransfer: dt });
  fireEvent.dragOver(target, { dataTransfer: dt });
  fireEvent.drop(target, { dataTransfer: dt });
}

const props = { onLabelChange: vi.fn(), onItemDelete: vi.fn(), onSaveFolder: vi.fn(), onExportFolder: vi.fn() };
const s = () => useMyMapsStore.getState();
const folderOf = (id: string) => s().items.find((i) => i.id === id)!.folderId ?? null;

describe("My Maps folders UI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMyMapsStore.setState({
      items: [item("a"), item("b", { folderId: "f1" }), item("c", { folderId: "f1" })],
      folders: [{ id: "f1", label: "Culverts", panelOpen: true }],
      activeFolderId: null,
    });
  });

  it("shows folders above the root items, with counts", () => {
    render(<MyMapsItems {...props} />);
    const folder = screen.getByTestId("mymaps-folder");
    expect(folder).toHaveTextContent("Culverts - (2)");
    expect(within(folder).getByText("Item b")).toBeInTheDocument();
    expect(within(screen.getByTestId("mymaps-root-items")).getByText("Item a")).toBeInTheDocument();
  });

  it("drags an item into a folder and back to root", () => {
    render(<MyMapsItems {...props} />);
    drag("Item a", screen.getByTitle("Collapse folder"));
    expect(folderOf("a")).toBe("f1");

    drag("Item a", screen.getByTestId("mymaps-root-items"));
    expect(folderOf("a")).toBeNull();
  });

  it("drops onto another item to reorder next to it", () => {
    render(<MyMapsItems {...props} />);
    const target = screen.getByText("Item c").closest("[data-testid='mymaps-item']")!;
    drag("Item a", target);
    expect(s().items.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(folderOf("a")).toBe("f1");
  });

  it("ignores ordinary text dragged onto a folder", () => {
    render(<MyMapsItems {...props} />);
    const dt = dataTransfer();
    dt.setData("text/plain", "a");
    fireEvent.drop(screen.getByTitle("Collapse folder"), { dataTransfer: dt });
    expect(folderOf("a")).toBeNull();
  });

  it("creates a folder and shows the active workspace banner", async () => {
    render(<MyMapsItems {...props} />);
    await userEvent.click(screen.getByRole("button", { name: /New Folder/ }));
    expect(s().folders[0].label).toBe("New Folder 2");

    await userEvent.click(screen.getByRole("button", { name: "Folder options for Culverts" }));
    await userEvent.click(screen.getByText("Set as Active Workspace"));
    expect(s().activeFolderId).toBe("f1");
    expect(screen.getByTestId("mymaps-active-folder")).toHaveTextContent("Adding new items to: Culverts");

    await userEvent.click(within(screen.getByTestId("mymaps-active-folder")).getByRole("button", { name: "Clear" }));
    expect(s().activeFolderId).toBeNull();
  });

  it("renames, saves and deletes from the folder menu", async () => {
    render(<MyMapsItems {...props} />);
    await userEvent.click(screen.getByRole("button", { name: "Folder options for Culverts" }));
    await userEvent.click(screen.getByText("Rename Folder"));
    const input = screen.getByLabelText("Folder name");
    await userEvent.clear(input);
    await userEvent.type(input, "Hwy 11{Enter}");
    expect(s().folders[0].label).toBe("Hwy 11");

    await userEvent.click(screen.getByRole("button", { name: "Folder options for Hwy 11" }));
    await userEvent.click(screen.getByText("Save Folder (Get Shareable Link)"));
    expect(props.onSaveFolder).toHaveBeenCalledWith(expect.objectContaining({ id: "f1" }));

    await userEvent.click(screen.getByRole("button", { name: "Folder options for Hwy 11" }));
    await userEvent.click(screen.getByText("Delete Folder"));
    expect(s().folders).toEqual([]);
    expect(s().items.every((i) => !i.folderId)).toBe(true); // items kept, moved to root
  });

  it("moves an item from its Tools menu, including into a new folder", async () => {
    const onMoveToFolder = vi.fn();
    render(<MyMapsItemPopup item={s().items[1]} position={{ x: 0, y: 0 }} isOpen onClose={vi.fn()} folders={s().folders} onMoveToFolder={onMoveToFolder} />);
    await userEvent.hover(screen.getByText("Move to Folder"));
    // already in Culverts, so offered Root Items and a new folder but not Culverts
    expect(screen.queryByText("Culverts")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Root Items"));
    expect(onMoveToFolder).toHaveBeenCalledWith(expect.objectContaining({ id: "b" }), null);
  });
});
