import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fromLonLat } from "ol/proj";
import LHRSTool from "../LHRSTool";
import { useMapStore } from "@/stores/mapStore";
import { showMessage } from "@/utils/helpersUI";

vi.mock("@/utils/openlayers/LayerManager", () => ({
  LayerManager: { addLayer: vi.fn(() => `layer-${Math.random()}`), removeLayer: vi.fn() },
}));

vi.mock("@/components/PanelComponent", () => ({
  default: ({ children, name }: { children: React.ReactNode; name: string }) => (
    <div data-testid="panel-component" data-name={name}>
      {children}
    </div>
  ),
}));

vi.mock("react-icons/fa", () => ({
  FaMapMarkerAlt: () => <span />,
  FaCopy: () => <span />,
  FaExternalLinkAlt: () => <span />,
  FaSearch: () => <span />,
}));

vi.mock("@/utils/helpersUI", () => ({ activateTab: vi.fn(), showMessage: vi.fn() }));
vi.mock("@/utils/getPublicPath", () => ({ getPublicPath: (p: string) => p }));
vi.mock("@/stores/myMapsStore", () => ({
  useMyMapsStore: { getState: () => ({ addItem: vi.fn() }) },
  createMyMapsItem: vi.fn(() => ({})),
}));
vi.mock("@/utils/myMapsHelpers", () => ({ featureToGeoJSON: () => "{}" }));

const VERSIONS = [
  { lhrs_version_title: "2020-01", lhrs_version: "jan2020", current: true },
  { lhrs_version_title: "2019-01", lhrs_version: "jan2019", current: false },
];

const point = (hwy: string, snapping_distance = 1, m_distance = 99.999) => ({
  longitude_in: -79.6471983,
  latitude_in: 44.4326453,
  hwy,
  m_distance,
  lhrs_version: "jan2020",
  basepoint: 16946,
  lhrs_offset: 0.599,
  snapping_distance,
  rank: 1,
  clrs_route: "11-2-11-00000-00",
  clrs_measurement: 12.111,
  smartcl_twp: null,
  smartcl_route: null,
  smartcl_chainage: null,
  smartcl_chainage_orientation: null,
});

type Handler = (evt: { coordinate: number[] }) => void;

function setup(postResponses: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/versions")) return { ok: true, json: async () => VERSIONS };
    const path = url.split("/").pop()!;
    return { ok: true, json: async () => ({ result: postResponses[path] ?? null }), _body: init?.body };
  });
  vi.stubGlobal("fetch", fetchMock);

  let clickHandler: Handler | null = null;
  const view = { animate: vi.fn(), fit: vi.fn() };
  const map = {
    on: vi.fn((type: string, h: Handler) => {
      if (type === "click") clickHandler = h;
      return { type };
    }),
    un: vi.fn(),
    getView: () => view,
  };
  useMapStore.setState({ map: map as never, setActiveToolId: vi.fn() });
  const posted = (path: string) =>
    fetchMock.mock.calls.filter(([u]) => String(u).endsWith(`/${path}`)).map(([, init]) => JSON.parse(String(init?.body)));
  return { fetchMock, click: (lon: number, lat: number) => act(() => clickHandler!({ coordinate: fromLonLat([lon, lat]) })), posted };
}

describe("LHRSTool", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("loads versions and selects the current one", async () => {
    setup({});
    render(<LHRSTool onClose={vi.fn()} />);
    const select = await screen.findByDisplayValue("2020-01 (current)");
    expect(select).toBeInTheDocument();
  });

  it("looks up a map click and shows Point A", async () => {
    const { click, posted } = setup({ by_xy_multi: [point("11")] });
    render(<LHRSTool onClose={vi.fn()} />);
    await screen.findByDisplayValue("2020-01 (current)");

    await click(-79.6472, 44.4326);

    expect(await screen.findByText("11 / 99.999")).toBeInTheDocument();
    const body = posted("by_xy_multi")[0];
    expect(body.version).toBe("jan2020");
    expect(body.snappingDistance).toBe(50);
    expect(body.lat).toBeCloseTo(44.4326, 4);
    expect(body.long).toBeCloseTo(-79.6472, 4);
    expect(screen.getByRole("button", { name: "Point B" })).toBeEnabled();
  });

  it("offers a deduplicated highway picker for an ambiguous click", async () => {
    const { click } = setup({ by_xy_multi: [point("400A", 1), point("400A", 3), point("11", 2), point("11", 2)] });
    render(<LHRSTool onClose={vi.fn()} />);
    await screen.findByDisplayValue("2020-01 (current)");

    await click(-79.6472, 44.4326);

    const picker = await screen.findByDisplayValue("Select Hwy...");
    const options = Array.from((picker as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(["Select Hwy...", "Hwy 400A (1 m away)", "Hwy 11 (2 m away)"]);
    expect(showMessage).toHaveBeenCalledWith("Multiple Found", expect.any(String), "warning", 3500);

    await userEvent.selectOptions(picker, "11");
    expect(await screen.findByText("11 / 99.999")).toBeInTheDocument();
  });

  it("looks up by highway and M distance", async () => {
    const { posted } = setup({ by_m_distance: point("11") });
    render(<LHRSTool onClose={vi.fn()} />);
    await screen.findByDisplayValue("2020-01 (current)");

    await userEvent.selectOptions(screen.getByDisplayValue("Select on Map"), "enterHwy");
    await userEvent.type(screen.getByLabelText("Hwy"), "11");
    await userEvent.type(screen.getByLabelText("M Dist. (km)"), "100");
    await userEvent.click(screen.getByTitle("Find"));

    expect(await screen.findByText("11 / 99.999")).toBeInTheDocument();
    expect(posted("by_m_distance")[0]).toEqual({ version: "jan2020", snappingDistance: 50, hwy: "11", distance: 100 });
  });

  it("draws a section once both points are on the same highway", async () => {
    const { click, posted } = setup({
      by_xy_multi: [point("11")],
      linear_by_m_distance: {
        geom: JSON.stringify({ type: "MultiLineString", coordinates: [[[-8866285, 5532000], [-8866000, 5533000]]] }),
        section_length: 1.5,
      },
    });
    render(<LHRSTool onClose={vi.fn()} />);
    await screen.findByDisplayValue("2020-01 (current)");

    await click(-79.6472, 44.4326); // A
    await screen.findByRole("heading", { name: "Point A" });
    await click(-79.64, 44.44); // B (active point auto-advances after A)

    expect(await screen.findByText("Section - Hwy 11")).toBeInTheDocument();
    expect(screen.getByText("1.500")).toBeInTheDocument();
    expect(screen.getByText(/Smart CL - Segment Report/)).toHaveAttribute("href", expect.stringContaining("hwy=11"));
    expect(posted("linear_by_m_distance")[0]).toMatchObject({ hwy: "11", fromDistance: 99.999, toDistance: 99.999 });
  });

  it("uses the right-click coordinate as Point A", async () => {
    const { posted } = setup({ by_xy_multi: [point("11")] });
    render(<LHRSTool onClose={vi.fn()} options={{ coordinate: fromLonLat([-79.6472, 44.4326]) }} />);

    expect(await screen.findByText("11 / 99.999")).toBeInTheDocument();
    await waitFor(() => expect(posted("by_xy_multi")).toHaveLength(1));
  });
});
