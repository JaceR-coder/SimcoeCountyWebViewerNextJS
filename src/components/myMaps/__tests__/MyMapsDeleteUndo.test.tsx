import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import MyMapsItem from "@/components/myMaps/MyMapsItem";
import { ToastContainer } from "@/components/Toast/ToastContainer";
import { useMyMapsStore, type MyMapsItem as Item } from "@/stores/myMapsStore";
import { useToastStore } from "@/hooks/useToast";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
}));

const item = (id: string, patch: Partial<Item> = {}): Item => ({
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

const s = () => useMyMapsStore.getState();

describe("My Maps delete with undo", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    useMyMapsStore.setState({ items: [item("a"), item("b", { folderId: "f1" }), item("c")], folders: [{ id: "f1", label: "F" }], activeFolderId: null });
  });

  it("deletes with an Undo toast that restores the item in place, folder included", () => {
    s().deleteItemWithUndo("b");
    expect(s().items.map((i) => i.id)).toEqual(["a", "c"]);

    const toast = useToastStore.getState().toasts[0];
    expect(toast.message).toBe('Deleted "Item b".');
    expect(toast.action?.label).toBe("Undo");

    toast.action!.onClick();
    expect(s().items.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(s().items[1].folderId).toBe("f1");

    toast.action!.onClick(); // a second undo can't duplicate it
    expect(s().items).toHaveLength(3);
  });

  it("shows the Undo button on the toast and restores when clicked", () => {
    render(<ToastContainer />);
    act(() => s().deleteItemWithUndo("a"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(s().items.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  describe("delete button", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const renderItem = (onDelete = vi.fn()) => {
      render(<MyMapsItem item={s().items[0]} onLabelChange={vi.fn()} onDelete={onDelete} />);
      return onDelete;
    };

    it("needs a second click to delete", () => {
      const onDelete = renderItem();
      fireEvent.click(screen.getByRole("button", { name: "Delete Item a" }));
      act(() => vi.advanceTimersByTime(1000));
      expect(onDelete).not.toHaveBeenCalled();

      const armed = screen.getByRole("button", { name: "Click again to delete Item a" });
      expect(armed).toHaveAttribute("title", "Click again to delete");
      fireEvent.click(armed);
      act(() => vi.advanceTimersByTime(400)); // fade-out animation
      expect(onDelete).toHaveBeenCalledWith("a");
    });

    it("disarms if the second click doesn't come within 2.5 seconds", () => {
      const onDelete = renderItem();
      fireEvent.click(screen.getByRole("button", { name: "Delete Item a" }));
      act(() => vi.advanceTimersByTime(2600));
      fireEvent.click(screen.getByRole("button", { name: "Delete Item a" }));
      act(() => vi.advanceTimersByTime(400));
      expect(onDelete).not.toHaveBeenCalled();
    });
  });
});
