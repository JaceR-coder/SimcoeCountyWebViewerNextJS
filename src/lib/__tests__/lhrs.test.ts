import { describe, it, expect, vi, beforeEach } from "vitest";

const queryRawUnsafe = vi.fn();
const queryRaw = vi.fn();
vi.mock("@/lib/prisma", () => ({ default: { $queryRawUnsafe: (...a: unknown[]) => queryRawUnsafe(...a), $queryRaw: (...a: unknown[]) => queryRaw(...a) } }));

import { byMDistance, byXYMulti, byBasepoint, linearByMDistance, getVersions, LHRSInputError } from "@/lib/services/lhrs";

describe("lhrs service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("binds by_m_distance params positionally, never interpolating input", async () => {
    queryRawUnsafe.mockResolvedValue([{ hwy: "11", m_distance: 99.999 }]);
    const result = await byMDistance({ version: "jan2020", snappingDistance: "50", hwy: "11'; drop table x;--", distance: "100" });
    const [sql, ...values] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("postgisftw.lhrs_by_m_distance($1::text, $2::int, $3::text, $4::numeric)");
    expect(sql).not.toContain("drop table");
    expect(values).toEqual(["jan2020", 50, "11'; drop table x;--", 100]);
    expect(result).toEqual({ hwy: "11", m_distance: 99.999 });
  });

  it("selects explicit, JSON-safe columns (no geom, no numeric/bigint)", async () => {
    queryRawUnsafe.mockResolvedValue([]);
    await byXYMulti({ version: "jan2020", long: -79.6, lat: 44.4 });
    const sql: string = queryRawUnsafe.mock.calls[0][0];
    expect(sql).not.toMatch(/SELECT\s+\*/);
    expect(sql).not.toMatch(/\br\.geom\b/);
    expect(sql).toContain("r.snapping_distance::int");
    expect(sql).toContain("r.m_distance::float8");
  });

  it("defaults the snapping distance", async () => {
    queryRawUnsafe.mockResolvedValue([]);
    await byXYMulti({ version: "jan2020", long: -79.6, lat: 44.4 });
    expect(queryRawUnsafe.mock.calls[0][2]).toBe(50);
  });

  it("returns null when a single-row lookup finds nothing", async () => {
    queryRawUnsafe.mockResolvedValue([]);
    expect(await byBasepoint({ version: "jan2020", basepoint: 99999999, offset: 0 })).toBeNull();
    expect(await linearByMDistance({ version: "jan2020", hwy: "11", fromDistance: 1, toDistance: 2 })).toBeNull();
  });

  it.each([
    [{ long: -79.6, lat: 44.4 }, "version"],
    [{ version: "jan2020", lat: 44.4 }, "long"],
    [{ version: "jan2020", long: "abc", lat: 44.4 }, "long"],
    [{ version: "jan2020", long: -79.6, lat: 44.4, snappingDistance: 0 }, "snappingDistance"],
    [{ version: "jan2020", long: -79.6, lat: 44.4, snappingDistance: 999999 }, "snappingDistance"],
  ])("rejects invalid input %j", async (body, field) => {
    await expect(byXYMulti(body)).rejects.toThrow(LHRSInputError);
    await expect(byXYMulti(body)).rejects.toThrow(field);
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("reads versions", async () => {
    queryRaw.mockResolvedValue([{ lhrs_version_title: "2020-01", lhrs_version: "jan2020", current: true }]);
    expect(await getVersions()).toHaveLength(1);
  });
});
