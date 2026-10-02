import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// $queryRaw is a tagged template: capture the SQL text and bound values of each call
const calls: { sql: string; values: unknown[] }[] = [];
const rows = vi.hoisted(() => ({ next: [] as unknown[] }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return rows.next;
    }),
  },
}));

import { search, searchById, getSearchTypes, toTsQueryText } from "@/lib/services/search";

const osmFetch = (body: unknown, ok = true) =>
  vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: ok ? 200 : 403, headers: { "content-type": ok ? "application/json" : "text/plain" } }));

describe("search service (legacy web_search index)", () => {
  beforeEach(() => {
    calls.length = 0;
    rows.next = [];
    vi.stubGlobal("fetch", osmFetch("Access denied", false));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("needs at least 2 characters", async () => {
    expect(await search("a", "All", undefined, 10)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("uses a quick prefix match for short strings", async () => {
    rows.next = [{ name: "Hwy 11", type: "MTO Jurisdiction", location_id: "1" }];
    const result = await search("hwy", "All", undefined, 5);
    expect(result).toHaveLength(1);
    expect(calls[0].sql).toContain("FROM web_search.tbl_search_ts_mv");
    expect(calls[0].sql).not.toContain("to_tsquery_partial");
    expect(calls[0].values).toEqual(["hwy", null, null, 5]); // All -> no type filter
  });

  it("ranks longer strings with the full-text query, filtering by type", async () => {
    rows.next = [{ name: "10 DUNLOP DR", type: "Address", location_id: "17001" }];
    await search("10 dunlop", "Address", undefined, 10);
    expect(calls[0].sql).toContain("public.to_tsquery_partial(");
    expect(calls[0].sql).toContain("ts_rank_cd");
    expect(calls[0].values).toContain("Address");
  });

  it("strips tsquery operators so user input can't break the query", async () => {
    expect(toTsQueryText("hwy (11) & o'brien:*")).toBe("hwy 11 o brien");
    await search("hwy (11) & o'brien", "All", undefined, 10);
    expect(calls[0].values).toContain("hwy 11 o brien");
  });

  it("caps the limit", async () => {
    await search("hwy", "All", undefined, 5000);
    expect(calls[0].values.at(-1)).toBe(100);
  });

  it("falls back to Open Street Map only when the index finds nothing", async () => {
    vi.stubGlobal("fetch", osmFetch([{ display_name: "Sudbury, Ontario", type: "city", lat: "46.49", lon: "-80.99", place_id: "7", address: { city: "Sudbury" } }]));
    const result = await search("sudbury", "All", undefined, 10);
    expect(result).toEqual([expect.objectContaining({ name: "Sudbury, Ontario", type: "City - Open Street Map", place_id: "7", location_id: null })]);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("viewbox=-95.16"); // Ontario, not Simcoe County
  });

  it("doesn't call Open Street Map when the index has results", async () => {
    const fetchMock = osmFetch([]);
    vi.stubGlobal("fetch", fetchMock);
    rows.next = [{ name: "SUDBURY", type: "Municipality", location_id: "9" }];
    await search("sudbury", "All", undefined, 10);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("goes straight to Open Street Map for that type, and survives a non-JSON reply", async () => {
    expect(await search("customer", "Open Street Map", undefined, 10)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("looks up one result with its geometry and associated layers", async () => {
    rows.next = [{ name: "Contract 1950-0113", location_id: "17", geojson: "{}", assoc_layers: "contracts:x@contracts_and_future_projects" }];
    const result = await searchById("17");
    expect(result?.assoc_layers).toContain("contracts:x");
    expect(calls[0].sql).toContain("LEFT JOIN web_search.tbl_search_layers");
    expect(calls[0].values).toEqual(["17"]);
  });

  it("rejects non-numeric ids without querying", async () => {
    expect(await searchById("1; drop table x")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("lists the index's result types", async () => {
    rows.next = [{ type: "Address" }, { type: "Contracts" }];
    expect(await getSearchTypes()).toEqual(["Address", "Contracts"]);
  });
});
