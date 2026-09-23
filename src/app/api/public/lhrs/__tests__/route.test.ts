import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/services/lhrs", async () => {
  class LHRSInputError extends Error {}
  return {
    LHRSInputError,
    getVersions: vi.fn(),
    LOOKUPS: { by_xy_multi: vi.fn(), by_basepoint: vi.fn(), by_m_distance: vi.fn(), linear_by_m_distance: vi.fn() },
  };
});

import * as service from "@/lib/services/lhrs";
import { POST } from "@/app/api/public/lhrs/[lookup]/route";
import { GET } from "@/app/api/public/lhrs/versions/route";

const post = (lookup: string, body: string) =>
  POST(new NextRequest(`http://localhost/api/public/lhrs/${lookup}`, { method: "POST", body }), { params: Promise.resolve({ lookup }) });

describe("/api/public/lhrs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("wraps results in the legacy {result} envelope", async () => {
    vi.mocked(service.LOOKUPS.by_m_distance).mockResolvedValue({ hwy: "11" } as never);
    const res = await post("by_m_distance", JSON.stringify({ hwy: "11" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { hwy: "11" } });
    expect(service.LOOKUPS.by_m_distance).toHaveBeenCalledWith({ hwy: "11" });
  });

  it("404s an unknown lookup, including prototype keys", async () => {
    expect((await post("by_xy", "{}")).status).toBe(404);
    expect((await post("constructor", "{}")).status).toBe(404);
  });

  it("400s bad JSON and non-object bodies", async () => {
    expect((await post("by_xy_multi", "not json")).status).toBe(400);
    expect((await post("by_xy_multi", "[1,2]")).status).toBe(400);
  });

  it("400s input errors with the service's message", async () => {
    vi.mocked(service.LOOKUPS.by_xy_multi).mockRejectedValue(new service.LHRSInputError('"long" must be a number.'));
    const res = await post("by_xy_multi", "{}");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('"long" must be a number.');
  });

  it("500s database failures without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(service.LOOKUPS.by_basepoint).mockRejectedValue(new Error('function postgisftw.lhrs_by_bpoint does not exist'));
    const res = await post("by_basepoint", "{}");
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("LHRS lookup failed.");
  });

  it("returns versions", async () => {
    vi.mocked(service.getVersions).mockResolvedValue([{ lhrs_version_title: "2020-01", lhrs_version: "jan2020", current: true }]);
    const res = await GET();
    expect(await res.json()).toHaveLength(1);
  });
});
