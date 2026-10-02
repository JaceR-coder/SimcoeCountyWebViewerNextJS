import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { addAppStat, trackEvent, trackTheme, trackTool, trackMapLoad, trackBasemap, trackLayer, trackGroup, trackMyMaps, trackSearch } from "@/lib/appStats";
import { useAppStore } from "@/stores/appStore";

describe("appStats (py-Geomatics analytics beacon)", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    useAppStore.setState({ config: { title: "Interactive Map" } as never });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const lastCall = () => {
    const [url, init] = fetchSpy.mock.calls.at(-1) as [string, RequestInit];
    return { url, init, body: JSON.parse(init.body as string) };
  };

  it("posts to the same-origin /geomatics analytics beacon", () => {
    trackTool("Measure");
    const { url, init, body } = lastCall();
    expect(url).toMatch(/\/geomatics\/analytics\/event$/);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(body).toEqual({ application: "imap", event_name: "tool.opened", entity_type: "tool", entity_id: "Measure", metadata: { client: "nextjs" } });
  });

  it.each([
    [() => trackTheme("511"), "theme.opened", "theme", "511"],
    [() => trackBasemap("Blank Map"), "basemap.changed", "basemap", "Blank Map"],
    [() => trackMapLoad("public"), "session_started", "map", "public"],
  ])("maps helpers onto the legacy event catalog (%#)", (call, eventName, entityType, entityId) => {
    (call as () => void)();
    expect(lastCall().body).toMatchObject({ event_name: eventName, entity_type: entityType, entity_id: entityId });
  });

  it("records layer toggles by GeoServer layer name, with on/off events", () => {
    trackLayer("lhrs_routes", "LHRS", "LHRS Routes", true);
    expect(lastCall().body).toMatchObject({ event_name: "layer.enabled", entity_id: "lhrs_routes", metadata: { client: "nextjs", group: "LHRS", display_name: "LHRS Routes" } });
    trackLayer("lhrs_routes", "LHRS", "LHRS Routes", false);
    expect(lastCall().body.event_name).toBe("layer.disabled");
  });

  it("sends generic stats as ui_action events", () => {
    addAppStat("PyGeomatics", "Button");
    expect(lastCall().body).toMatchObject({ event_name: "ui_action", entity_type: "ui_control", entity_id: "PyGeomatics", metadata: { description: "Button" } });
    trackGroup("Pavement");
    expect(lastCall().body).toMatchObject({ entity_id: "Group", metadata: { description: "Pavement" } });
    trackMyMaps();
    expect(lastCall().body).toMatchObject({ entity_id: "MyMaps" });
  });

  it("records search length but never the search text", () => {
    trackSearch("Address", "123 Main St");
    const { body } = lastCall();
    expect(body).toMatchObject({ event_name: "search.performed", entity_id: "Address", metadata: { query_length: 11 } });
    expect(JSON.stringify(body)).not.toContain("Main");
  });

  it("does nothing when config.includeAppStats is false or config isn't loaded", () => {
    useAppStore.setState({ config: { includeAppStats: false } as never });
    trackEvent("tool.opened", "tool", "Measure");
    useAppStore.setState({ config: null });
    trackEvent("tool.opened", "tool", "Measure");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never throws when the network fails", () => {
    fetchSpy.mockRejectedValue(new Error("offline"));
    expect(() => trackTool("Measure")).not.toThrow();
  });
});
