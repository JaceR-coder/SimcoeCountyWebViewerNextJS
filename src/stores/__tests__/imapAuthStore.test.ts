import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useImapAuthStore, isTocLayerLocked } from "@/stores/imapAuthStore";

const tokenBody = (over: Record<string, unknown> = {}) => ({ token: "t", expires_in: 300, all_layers: false, layers: ["WS:Public_A"], user_display_name: null, ...over });

describe("imapAuthStore", () => {
  beforeEach(() => {
    useImapAuthStore.getState().stop();
    useImapAuthStore.setState({ status: "idle", userDisplayName: null, allLayers: false, grantedLayers: new Set(), expiresAt: 0 });
  });
  afterEach(() => {
    useImapAuthStore.getState().stop();
    vi.unstubAllGlobals();
  });

  it("loads login + grants from py-Geomatics' token endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => tokenBody({ user_display_name: "Jane Doe" }) });
    vi.stubGlobal("fetch", fetchMock);
    await useImapAuthStore.getState().refresh();
    const s = useImapAuthStore.getState();
    expect(fetchMock.mock.calls[0][0]).toBe("/geomatics/imap/token");
    expect(s.status).toBe("ready");
    expect(s.userDisplayName).toBe("Jane Doe");
    expect(s.grantedLayers.has("ws:public_a")).toBe(true);
  });

  it("re-checks login when the tab regains focus (e.g. after logging in on another tab)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => tokenBody() })
      .mockResolvedValueOnce({ ok: true, json: async () => tokenBody({ user_display_name: "Jane Doe", all_layers: true }) });
    vi.stubGlobal("fetch", fetchMock);
    useImapAuthStore.getState().start();
    await vi.waitFor(() => expect(useImapAuthStore.getState().status).toBe("ready"));
    expect(useImapAuthStore.getState().userDisplayName).toBeNull();

    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(useImapAuthStore.getState().userDisplayName).toBe("Jane Doe"));
    expect(useImapAuthStore.getState().allLayers).toBe(true);

    // visibilitychange + focus firing together only trigger one re-check
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports an error state when py-Geomatics is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await useImapAuthStore.getState().refresh();
    expect(useImapAuthStore.getState().status).toBe("error");
  });

  it("builds a relative login link back to the current page", () => {
    const here = window.location.pathname + window.location.search;
    expect(useImapAuthStore.getState().loginUrl()).toBe(`/geomatics/loginuser/login?next=${encodeURIComponent(here)}`);
    // Relative only - py-Geomatics rejects a `next` with a host
    expect(decodeURIComponent(useImapAuthStore.getState().loginUrl().split("next=")[1])).toMatch(/^\//);
  });

  it("logs out, then reloads the anonymous state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, type: "opaqueredirect" })
      .mockResolvedValueOnce({ ok: true, json: async () => tokenBody() });
    vi.stubGlobal("fetch", fetchMock);
    useImapAuthStore.setState({ status: "ready", userDisplayName: "Jane Doe" });
    await useImapAuthStore.getState().logout();
    expect(fetchMock.mock.calls[0][0]).toBe("/geomatics/loginuser/logout");
    expect(useImapAuthStore.getState().userDisplayName).toBeNull();
  });
});

describe("isTocLayerLocked", () => {
  const ready = { status: "ready" as const, allLayers: false, grantedLayers: new Set(["ws:public_a"]) };
  const proxied = (name: string) => ({ name, wfsUrl: "/geoserver-proxy/LHRS/ows/wfs?service=wfs" });

  it("locks proxied GeoServer layers that aren't granted", () => {
    expect(isTocLayerLocked(ready, proxied("ws:secret"))).toBe(true);
    expect(isTocLayerLocked(ready, proxied("WS:Public_A"))).toBe(false);
  });

  it("never locks layers outside py-Geomatics' control", () => {
    expect(isTocLayerLocked(ready, { ...proxied("ws:secret"), userLayer: true })).toBe(false);
    expect(isTocLayerLocked(ready, { name: "ws:secret", wfsUrl: "https://opengis.simcoe.ca/geoserver/wfs" })).toBe(false);
    expect(isTocLayerLocked(ready, proxied("ArcGIS Layer"))).toBe(false);
  });

  it("locks nothing for all-layers users or before access info has loaded", () => {
    expect(isTocLayerLocked({ ...ready, allLayers: true }, proxied("ws:secret"))).toBe(false);
    expect(isTocLayerLocked({ ...ready, status: "loading" }, proxied("ws:secret"))).toBe(false);
  });
});
