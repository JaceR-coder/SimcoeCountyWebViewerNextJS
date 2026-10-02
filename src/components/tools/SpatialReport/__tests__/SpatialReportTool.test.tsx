import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SpatialReportTool from "../SpatialReportTool";
import { qualifiedLayerName, applyMapFilter } from "@/utils/mapFilter";
import { useLayerFilterStore } from "@/stores/layerFilterStore";
import { useImapAuthStore } from "@/stores/imapAuthStore";
import { useSpatialReportStore } from "@/stores/spatialReportStore";
import { useLayerManagerStore } from "@/stores/layerManagerStore";

vi.mock("@/components/PanelComponent", () => ({
  default: ({ children, name }: { children: React.ReactNode; name: string }) => <div data-testid="panel" data-name={name}>{children}</div>,
}));
vi.mock("react-icons/fa", () => ({
  FaSignInAlt: () => <span />,
  FaSyncAlt: () => <span />,
  FaQuestion: () => <span />,
  FaTrash: () => <span />,
  FaPlus: () => <span />,
}));
vi.mock("@/utils/helpersUI", () => ({ showMessage: vi.fn(), activateTab: vi.fn() }));
// Map-interactive scopes are exercised separately; stub them here
vi.mock("../AreaDraw", () => ({ default: () => <div data-testid="area-draw" /> }));
// Map effects are covered by utils/__tests__/mapFilter.test.ts
vi.mock("@/utils/mapFilter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/mapFilter")>()),
  applyMapFilter: vi.fn(() => true),
  clearMapFilter: vi.fn(),
  ensureLayerVisible: vi.fn(() => true),
}));
vi.mock("../LhrsRangeScope", () => ({ default: () => <div data-testid="lhrs-scope" /> }));

const LAYERS = [
  { qualified_name: "ws:culverts", title: "Culverts" },
  { qualified_name: "ws:signs", title: "Signs" },
];

function mockApi(routes: Record<string, unknown>) {
  const fetchMock = vi.fn(async (url: string) => {
    const path = url.replace("/geomatics/gis_reports/api/", "").split("?")[0];
    const body = routes[path];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({ error: `no mock for ${path}` }) };
    if (body instanceof Response) return body;
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Map layers as the layer manager holds them - the Spatial Tool reads what's actually drawn, not tocStore flags
const mapLayer = (name: string, visible: boolean) => ({ id: name, name, visible, layer: { getVisible: () => visible } });
const setMapLayers = (layers: ReturnType<typeof mapLayer>[]) =>
  useLayerManagerStore.setState((s) => ({ layers: { ...s.layers, TOC: layers } }) as never);

const signIn = (name: string | null) => useImapAuthStore.setState({ status: "ready", userDisplayName: name, allLayers: true, grantedLayers: new Set(), refresh: vi.fn() } as never);

describe("SpatialReportTool", () => {
  beforeEach(() => {
    useSpatialReportStore.getState().reset();
    setMapLayers([mapLayer("ws:culverts", true), mapLayer("ws:signs", true), mapLayer("ws:hidden", false)]);
    useLayerFilterStore.setState({ saved: {}, activeFilterByLayer: {}, mapFilterActive: false });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows a sign-in prompt to signed-out users", () => {
    signIn(null);
    mockApi({});
    render(<SpatialReportTool onClose={vi.fn()} />);
    expect(screen.getByText("Sign in to use the Spatial Tool")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign In/ })).toBeInTheDocument();
  });

  it("offers only the reportable layers that are turned on in the TOC", async () => {
    signIn("Jane Doe");
    const fetchMock = mockApi({ "reportable-layers": LAYERS, "export-formats": { gdal_available: true } });
    render(<SpatialReportTool onClose={vi.fn()} />);
    expect(await screen.findByLabelText("Culverts")).toBeInTheDocument();
    const layersCall = fetchMock.mock.calls.find(([u]) => String(u).includes("reportable-layers"))![0];
    expect(layersCall).toContain("layers=ws%3Aculverts&layers=ws%3Asigns");
    expect(layersCall).not.toContain("hidden");
  });

  it("reloads the layer list when layers are turned on while the tool is open", async () => {
    signIn("Jane Doe");
    const fetchMock = mockApi({ "reportable-layers": LAYERS, "export-formats": { gdal_available: false } });
    render(<SpatialReportTool onClose={vi.fn()} />);
    await screen.findByLabelText("Culverts");

    act(() => setMapLayers([mapLayer("ws:culverts", true), mapLayer("ws:signs", true), mapLayer("ws:hidden", true)]));

    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter(([u]) => String(u).includes("reportable-layers"));
      expect(String(calls[calls.length - 1][0])).toContain("ws%3Ahidden");
    });
  });

  it("qualifies layer names from workspace-scoped sources", () => {
    const meta = (groupUrl: string) => ({ groupUrl });
    expect(qualifiedLayerName({ name: "connecting_links", metadata: meta("/geoserver-proxy/road_interests/ows?service=wms&request=GetCapabilities") })).toBe("road_interests:connecting_links");
    expect(qualifiedLayerName({ name: "other_regional_data:lhrs_routes", metadata: meta("/geoserver-proxy/LHRS/ows?service=wms") })).toBe("other_regional_data:lhrs_routes");
    expect(qualifiedLayerName({ name: "Imagery_2020", metadata: {} })).toBeUndefined();
  });

  it("splits more than 25 visible layers across requests", async () => {
    signIn("Jane Doe");
    setMapLayers(Array.from({ length: 30 }, (_, i) => mapLayer(`ws:layer${i}`, true)));
    const fetchMock = mockApi({ "reportable-layers": LAYERS, "export-formats": { gdal_available: false } });
    render(<SpatialReportTool onClose={vi.fn()} />);
    await screen.findAllByLabelText("Culverts");
    const calls = fetchMock.mock.calls.filter(([u]) => String(u).includes("reportable-layers"));
    expect(calls).toHaveLength(2);
    expect(calls.map(([u]) => new URL(String(u), "http://x").searchParams.getAll("layers").length).sort()).toEqual([25, 5]);
  });

  it("shows the filter builder once the selected layer's fields load", async () => {
    signIn("Jane Doe");
    mockApi({
      "reportable-layers": LAYERS,
      "export-formats": { gdal_available: false },
      "layer-fields": { qualified_name: "ws:culverts", output_fields: [{ name: "hwy" }], filterable_fields: ["hwy"] },
    });
    render(<SpatialReportTool onClose={vi.fn()} />);
    await userEvent.click(await screen.findByLabelText("Culverts"));
    await waitFor(() => expect(screen.queryByText("Loading layer fields...")).not.toBeInTheDocument());
    expect(screen.getByText("Calculations")).toBeInTheDocument();
  });

  it("previews a report for the selected layer", async () => {
    signIn("Jane Doe");
    const fetchMock = mockApi({
      "reportable-layers": LAYERS,
      "export-formats": { gdal_available: false },
      "layer-fields": { qualified_name: "ws:culverts", output_fields: [{ name: "hwy" }], filterable_fields: ["hwy"] },
      preview: { total_features: 42, per_layer_counts: { "ws:culverts": 42 }, severity: "none" },
    });
    render(<SpatialReportTool onClose={vi.fn()} />);
    await userEvent.click(await screen.findByLabelText("Culverts"));

    await userEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("Culverts: 42")).toBeInTheDocument();
    const previewCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/preview"))!;
    expect(JSON.parse(String(previewCall[1]!.body))).toMatchObject({ scope: "layer", layers: ["ws:culverts"], output_fields: ["hwy"] });
  });

  it("switches to the sign-in prompt when py-Geomatics rejects the session", async () => {
    signIn("Jane Doe");
    mockApi({ "reportable-layers": new Response(JSON.stringify({ error: "unauthorized", message: "Please log in to use this tool." }), { status: 401 }), "export-formats": { gdal_available: false } });
    render(<SpatialReportTool onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Sign in to use the Spatial Tool")).toBeInTheDocument());
    expect(useImapAuthStore.getState().refresh).toHaveBeenCalled();
  });

  it("disables running until a layer is selected, and says why", async () => {
    signIn("Jane Doe");
    mockApi({ "reportable-layers": LAYERS, "export-formats": { gdal_available: false } });
    render(<SpatialReportTool onClose={vi.fn()} />);
    await screen.findByLabelText("Culverts");
    expect(screen.getByRole("button", { name: "Generate Report" })).toBeDisabled();
    expect(screen.getByText("Select at least one layer to continue.")).toBeInTheDocument();
  });

  describe("Filter Map and saved filters", () => {
    const HWY_11 = [{ field: "hwy", operator: "eq", value: "11" }];
    const withHwyFilter = () => {
      useSpatialReportStore.getState().setSelectedLayers(["ws:culverts"]);
      useSpatialReportStore.getState().update({ filters: HWY_11 });
    };

    it("filters the map with the current filters", async () => {
      signIn("Jane Doe");
      const result = { targets: [{ layer: "ws:culverts", cql_filter: "hwy = '11'", matched_count: 4 }], combined_extent: [0, 0, 1, 1], working_srid: 26917 };
      const fetchMock = mockApi({ "reportable-layers": LAYERS, "export-formats": { gdal_available: false }, "layer-fields": { qualified_name: "ws:culverts", output_fields: [{ name: "hwy" }], filterable_fields: ["hwy"] }, "map-filter": result });
      withHwyFilter();
      render(<SpatialReportTool onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Filter Map" })).toBeEnabled());

      await userEvent.click(screen.getByRole("button", { name: "Filter Map" }));

      await waitFor(() => expect(applyMapFilter).toHaveBeenCalledWith(result));
      const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/map-filter"))!;
      expect(JSON.parse(String((call as unknown[])[1] && ((call as unknown[])[1] as RequestInit).body))).toMatchObject({ layers: ["ws:culverts"], filters: HWY_11 });
    });

    it("keeps Filter Map disabled until there's a scope or filter", async () => {
      signIn("Jane Doe");
      mockApi({ "reportable-layers": LAYERS, "export-formats": { gdal_available: false }, "layer-fields": { qualified_name: "ws:culverts", output_fields: [{ name: "hwy" }], filterable_fields: ["hwy"] } });
      render(<SpatialReportTool onClose={vi.fn()} />);
      await userEvent.click(await screen.findByLabelText("Culverts"));
      expect(screen.getByRole("button", { name: "Filter Map" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Save Map Filter to Layer" })).toBeDisabled();
    });

    it("saves the current filter to the selected layer", async () => {
      signIn("Jane Doe");
      mockApi({ "reportable-layers": LAYERS, "export-formats": { gdal_available: false }, "layer-fields": { qualified_name: "ws:culverts", output_fields: [{ name: "hwy" }], filterable_fields: ["hwy"] } });
      withHwyFilter();
      render(<SpatialReportTool onClose={vi.fn()} />);
      await waitFor(() => expect(screen.getByRole("button", { name: "Save Map Filter to Layer" })).toBeEnabled());

      await userEvent.click(screen.getByRole("button", { name: "Save Map Filter to Layer" }));
      await userEvent.type(screen.getByLabelText("Filter name"), "Hwy 11 culverts");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      const saved = useLayerFilterStore.getState().saved["ws:culverts"];
      expect(saved).toHaveLength(1);
      expect(saved[0]).toMatchObject({ name: "Hwy 11 culverts", criteria: { scope: "layer", filters: HWY_11 } });
    });

    it("loads a saved filter back into the form", async () => {
      signIn("Jane Doe");
      mockApi({ "reportable-layers": LAYERS, "export-formats": { gdal_available: false }, "layer-fields": { qualified_name: "ws:culverts", output_fields: [{ name: "hwy" }], filterable_fields: ["hwy"] } });
      useLayerFilterStore.setState({ saved: { "ws:culverts": [{ id: "f1", name: "Hwy 11 culverts", createdAt: 0, criteria: { scope: "layer", filters: HWY_11 } }] } });
      render(<SpatialReportTool onClose={vi.fn()} />);
      await screen.findByLabelText("Culverts");

      await userEvent.click(screen.getByRole("button", { name: "View Saved Filters" }));
      await userEvent.click(await screen.findByText("Hwy 11 culverts"));

      const { form } = useSpatialReportStore.getState();
      expect(form.selectedLayers).toEqual(["ws:culverts"]);
      expect(form.filters).toEqual(HWY_11);
      expect(screen.getByLabelText("Culverts")).toBeChecked();
    });
  });
});
