import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getImapToken = vi.fn();
vi.mock("@/lib/geomatics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/geomatics")>();
  return { ...actual, GEOMATICS_URL: "https://geo.example/geomatics", getImapToken: (...a: unknown[]) => getImapToken(...a) };
});

import { GET, POST } from "@/app/geoserver-proxy/[...path]/route";

const upstream = (status: number, body = "PNG", headers: Record<string, string> = { "content-type": "image/png" }) => new Response(body, { status, headers });

const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe("/geoserver-proxy route", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    getImapToken.mockResolvedValue("tok-1");
  });

  it("forwards GETs to the py-Geomatics proxy with the caller's token", async () => {
    fetchMock.mockResolvedValue(upstream(200, "PNG", { "content-type": "image/png", "cache-control": "max-age=60", "set-cookie": "x=1" }));
    const req = new NextRequest("http://localhost/geoserver-proxy/LHRS/ows?service=WMS&layers=ws:a&imap_token=spoofed", {
      headers: { cookie: "session=abc; scwv.session-token=nextauth" },
    });

    const res = await GET(req, ctx(["LHRS", "ows"]));

    expect(getImapToken).toHaveBeenCalledWith("session=abc", { forceRefresh: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://geo.example/geomatics/imap/geoserver/LHRS/ows?service=WMS&layers=ws%3Aa");
    expect(init.headers["X-IMap-Token"]).toBe("tok-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("max-age=60");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.text()).toBe("PNG");
  });

  it("re-encodes path segments with spaces", async () => {
    fetchMock.mockResolvedValue(upstream(200));
    await GET(new NextRequest("http://localhost/geoserver-proxy/Operations%20Winter/ows"), ctx(["Operations Winter", "ows"]));
    expect(fetchMock.mock.calls[0][0]).toBe("https://geo.example/geomatics/imap/geoserver/Operations%20Winter/ows");
  });

  it("forwards POST bodies (large CQL filters) unchanged", async () => {
    fetchMock.mockResolvedValue(upstream(200));
    const req = new NextRequest("http://localhost/geoserver-proxy/wms", {
      method: "POST",
      body: "LAYERS=ws%3Aa&CQL_FILTER=INTERSECTS(geom%2C...)",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    await POST(req, ctx(["wms"]));
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(new TextDecoder().decode(init.body)).toBe("LAYERS=ws%3Aa&CQL_FILTER=INTERSECTS(geom%2C...)");
  });

  it("retries a 403 once with a fresh token", async () => {
    getImapToken.mockResolvedValueOnce("stale").mockResolvedValueOnce("fresh");
    fetchMock.mockResolvedValueOnce(upstream(403, "denied", { "content-type": "text/html" })).mockResolvedValueOnce(upstream(200));
    const res = await GET(new NextRequest("http://localhost/geoserver-proxy/wms?layers=ws:a"), ctx(["wms"]));
    expect(getImapToken).toHaveBeenLastCalledWith("", { forceRefresh: true });
    expect(fetchMock.mock.calls[1][1].headers["X-IMap-Token"]).toBe("fresh");
    expect(res.status).toBe(200);
  });

  it("passes a genuine denial through after the retry", async () => {
    fetchMock.mockImplementation(async () => upstream(403, "Not permitted", { "content-type": "text/html" }));
    const res = await GET(new NextRequest("http://localhost/geoserver-proxy/wms?layers=ws:secret"), ctx(["wms"]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.status).toBe(403);
  });

  it("returns 502 when py-Geomatics can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getImapToken.mockRejectedValue(new Error("py-Geomatics token request failed (503)"));
    const res = await GET(new NextRequest("http://localhost/geoserver-proxy/wms"), ctx(["wms"]));
    expect(res.status).toBe(502);
  });
});
