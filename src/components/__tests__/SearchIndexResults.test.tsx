import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Search from "../Search";

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/axiosInstance", () => ({ default: api }));
// A stable object, like the real hook - Search reloads its types whenever config changes identity
const configValue = vi.hoisted(() => ({ config: { storageKeys: { SearchHistory: "searchHistory" } } }));
vi.mock("@/hooks/useConfig", () => ({ useConfig: () => configValue }));
vi.mock("@/utils/storage", () => ({ appendSharedArrayItem: vi.fn(), getSharedItem: vi.fn(() => []), removeSharedArrayItem: vi.fn() }));

const appState = vi.hoisted(() => ({ urlParameters: {} as Record<string, string> }));
vi.mock("@/stores/appStore", () => ({ useAppStore: (selector: (s: typeof appState) => unknown) => selector(appState) }));

const BRIDGE = { name: "21X-0338/B1 (Bridge)", description: "Structure Name: County Rd. 28 O/P @ Hwy 115 (EBL)", type: "Bridge (MTO Structures)", location_id: "351678" };
const LOCATION = { ...BRIDGE, geojson: '{"type":"Point","coordinates":[-8700000,5500000]}', assoc_layers: "mto_assets:phm_structure_conditions_bridge@MTO_Structures" };

describe("Search with the legacy index", () => {
  let handleLocationResult: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    appState.urlParameters = {};
    handleLocationResult = vi.fn(async () => undefined);
    (window as unknown as Record<string, unknown>).searchZoomHandlers = { handleLocationResult };
    api.get.mockImplementation(async (url: string) => {
      if (url === "/public/search/types") return { data: ["Address", "Bridge (MTO Structures)"] };
      if (url.startsWith("/public/search?")) return { data: [BRIDGE] };
      if (url === "/public/search/351678") return { data: LOCATION };
      throw new Error(`unexpected ${url}`);
    });
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).searchZoomHandlers;
  });

  it("offers the index's types in the filter", async () => {
    render(<Search />);
    expect(await screen.findByRole("option", { name: "Bridge (MTO Structures)" })).toBeInTheDocument();
  });

  it("shows the description line and zooms to the full result on select", async () => {
    render(<Search />);
    await userEvent.type(screen.getByRole("textbox"), "hwy 115");
    expect(await screen.findByText(BRIDGE.description)).toBeInTheDocument();

    await userEvent.click(screen.getByText(BRIDGE.description));
    await waitFor(() => expect(handleLocationResult).toHaveBeenCalledWith(LOCATION));
  });

  it("opens a shared ?LOCATIONID= link", async () => {
    appState.urlParameters = { LOCATIONID: "351678" };
    render(<Search />);
    await waitFor(() => expect(handleLocationResult).toHaveBeenCalledWith(LOCATION));
    expect(screen.getByRole("textbox")).toHaveValue(BRIDGE.name);
  });
});
