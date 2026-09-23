import { describe, it, expect, vi, afterEach } from "vitest";
import { dedupeByHwy, buildSmartCLReportUrl, byMDistance, byXYMulti, type LHRSPointResult } from "../lhrsApi";

const row = (hwy: string, snapping_distance: number, rank = 1): LHRSPointResult => ({
  longitude_in: -79.6,
  latitude_in: 44.4,
  hwy,
  m_distance: 100,
  lhrs_version: "jan2020",
  basepoint: 16946,
  lhrs_offset: 0.599,
  snapping_distance,
  rank,
  clrs_route: null,
  clrs_measurement: null,
  smartcl_twp: null,
  smartcl_route: null,
  smartcl_chainage: null,
  smartcl_chainage_orientation: null,
});

describe("dedupeByHwy", () => {
  it("keeps the closest row per highway, closest first", () => {
    // Real shape from lhrs_by_xy_multiple at the Hwy 11 / 400A concurrency
    const rows = [row("400A", 3), row("400A", 1), row("400A", 1, 2), row("11", 2), row("11", 5)];
    const out = dedupeByHwy(rows);
    expect(out.map((r) => [r.hwy, r.snapping_distance, r.rank])).toEqual([
      ["400A", 1, 1],
      ["11", 2, 1],
    ]);
  });

  it("returns an empty list for no matches", () => {
    expect(dedupeByHwy([])).toEqual([]);
  });
});

describe("buildSmartCLReportUrl", () => {
  it("maps points onto the configured param names (x = lat, y = long, as the legacy tool sent them)", () => {
    const url = buildSmartCLReportUrl(
      { report_url: "https://example/smartcl/segments", params: { startX: "x1", startY: "y1", endX: "x2", endY: "y2", hwy: "hwy" } },
      { lat: 44.1, long: -79.1 },
      { lat: 44.2, long: -79.2 },
      "11",
    );
    expect(url).toBe("https://example/smartcl/segments?x1=44.1&y1=-79.1&x2=44.2&y2=-79.2&hwy=11");
  });
});

describe("request helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("unwraps the {result} envelope and posts JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: row("11", 1) }) });
    vi.stubGlobal("fetch", fetchMock);
    const result = await byMDistance("/api-base", { version: "jan2020", snappingDistance: 50, hwy: "11", distance: 100 });
    expect(result?.hwy).toBe("11");
    expect(fetchMock).toHaveBeenCalledWith("/api-base/by_m_distance", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ version: "jan2020", snappingDistance: 50, hwy: "11", distance: 100 });
  });

  it("treats a null result as no rows for by_xy_multi", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ result: null }) }));
    expect(await byXYMulti("/api-base", { version: "jan2020", snappingDistance: 50, lat: 9, long: -9 })).toEqual([]);
  });

  it("surfaces the backend's error message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: '"long" must be a number.' }) }));
    await expect(byXYMulti("/api-base", { version: "jan2020", snappingDistance: 50, lat: 1, long: NaN })).rejects.toThrow('"long" must be a number.');
  });
});
