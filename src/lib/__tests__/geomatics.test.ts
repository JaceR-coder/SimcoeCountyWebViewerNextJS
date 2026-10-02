import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { geomaticsCookieHeader, getImapToken, clearImapTokenCache, GEOMATICS_URL } from "@/lib/geomatics";

const jar = (cookies: Record<string, string>) => ({ get: (n: string) => (n in cookies ? { value: cookies[n] } : undefined) });

const tokenResponse = (token: string, expires_in = 300) => ({
  ok: true,
  json: async () => ({ token, expires_in, all_layers: false, layers: [], user_display_name: null }),
});

describe("geomaticsCookieHeader", () => {
  it("forwards only py-Geomatics auth cookies", () => {
    const header = geomaticsCookieHeader(jar({ session: "abc", remember_token: "r1", "scwv.session-token": "nextauth", pg_avid: "x" }));
    expect(header).toBe("session=abc; remember_token=r1");
  });

  it("is empty for an anonymous caller", () => {
    expect(geomaticsCookieHeader(jar({ other: "1" }))).toBe("");
  });
});

describe("getImapToken", () => {
  beforeEach(() => clearImapTokenCache());
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fetches with the caller's cookies and caches per session", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse("user-a")).mockResolvedValueOnce(tokenResponse("anon"));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getImapToken("session=a")).toBe("user-a");
    expect(await getImapToken("session=a")).toBe("user-a");
    expect(await getImapToken("")).toBe("anon");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${GEOMATICS_URL}/imap/token`);
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ Cookie: "session=a" });
    expect(fetchMock.mock.calls[1][1].headers).toEqual({});
  });

  it("refreshes shortly before py-Geomatics' expiry, and on demand", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValueOnce(tokenResponse("t1", 300)).mockResolvedValueOnce(tokenResponse("t2", 300)).mockResolvedValueOnce(tokenResponse("t3", 300));
    vi.stubGlobal("fetch", fetchMock);

    expect(await getImapToken("session=a")).toBe("t1");
    vi.advanceTimersByTime(269_000);
    expect(await getImapToken("session=a")).toBe("t1");
    vi.advanceTimersByTime(2_000); // past expires_in - 30s
    expect(await getImapToken("session=a")).toBe("t2");
    expect(await getImapToken("session=a", { forceRefresh: true })).toBe("t3");
  });

  it("throws when py-Geomatics is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 502 }));
    await expect(getImapToken("")).rejects.toThrow("502");
  });
});
