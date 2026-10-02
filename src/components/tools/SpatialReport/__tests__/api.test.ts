import { describe, it, expect, vi, afterEach } from "vitest";
import { getReportableLayers, previewReport, ReportAuthError, getJobStatus } from "../api";

const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

describe("spatial report api client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls py-Geomatics same-origin through the /geomatics rewrite, as an XHR", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, [{ qualified_name: "ws:a", title: "A" }]));
    vi.stubGlobal("fetch", fetchMock);
    const layers = await getReportableLayers(["ws:a", "ws:b"]);
    expect(layers).toEqual([{ qualified_name: "ws:a", title: "A" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/geomatics/gis_reports/api/reportable-layers?layers=ws%3Aa&layers=ws%3Ab");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers["X-Requested-With"]).toBe("XMLHttpRequest");
  });

  it("skips the request when no layers are visible", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getReportableLayers([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts JSON payloads", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { total_features: 3, per_layer_counts: {}, severity: "none" }));
    vi.stubGlobal("fetch", fetchMock);
    await previewReport({ layers: ["ws:a"] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/geomatics/gis_reports/api/preview");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ layers: ["ws:a"] });
  });

  it("raises ReportAuthError on 401 so the UI can prompt for sign-in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: "unauthorized", message: "Please log in to use this tool." })));
    await expect(getJobStatus(1)).rejects.toBeInstanceOf(ReportAuthError);
  });

  it("prefers the backend's human-readable message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { error: "You do not have permission to use spatial reporting." })));
    await expect(previewReport({})).rejects.toThrow("You do not have permission to use spatial reporting.");
  });
});
