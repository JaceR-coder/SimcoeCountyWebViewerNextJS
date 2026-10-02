import { describe, it, expect, beforeAll } from "vitest";
import { transform } from "ol/proj";
import { coordinateSystems, copyFormats, formatCopyText, fromZone, hasZones, registerMtoProjections, resolveZone, toZone, zoneTitle } from "../mtoCoordinateSystems";

const system = (name: string) => {
  const found = coordinateSystems.find((s) => s.projection === name);
  if (!found) throw new Error(`no system ${name}`);
  return found;
};

const webMercator = (lon: number, lat: number) => transform([lon, lat], "EPSG:4326", "EPSG:3857");

// GRS80 meridian arc length from the equator to 45°N
const MERIDIAN_ARC_45 = 4984944.378;

describe("mtoCoordinateSystems", () => {
  beforeAll(() => registerMtoProjections());

  it("loads the legacy MTO coordinate systems", () => {
    expect(coordinateSystems.map((s) => s.projection)).toEqual(["Lat / Long", "MTM (NAD83)", "UTM (NAD83)", "UTM (NAD27)", "Ontario MNR Lambert (NAD83)", "Web Mercator"]);
    expect(system("MTM (NAD83)").zones.map((z) => z.zone)).toEqual(["8", "9", "10", "11", "12", "13", "14", "15", "16"]);
    expect(hasZones(system("UTM (NAD83)"))).toBe(true);
    expect(hasZones(system("Lat / Long"))).toBe(false);
  });

  it.each([
    ["North Bay", -79.4608, 46.3091, "MTM (NAD83)", "10"],
    ["Sudbury", -80.993, 46.4917, "MTM (NAD83)", "12"],
    ["Ottawa", -75.6972, 45.4215, "MTM (NAD83)", "9"],
    ["Timmins", -81.3333, 48.4758, "UTM (NAD83)", "17N"],
    ["Kenora", -94.4894, 49.767, "UTM (NAD83)", "15N"],
    ["Ottawa", -75.6972, 45.4215, "UTM (NAD27)", "18N"],
  ])("auto-detects the zone for %s in %s", (_place, lon, lat, systemName, expectedZone) => {
    const { zone, exact } = resolveZone(system(systemName), lon, lat);
    expect(exact).toBe(true);
    expect(zone.zone).toBe(expectedZone);
  });

  it("falls back to the nearest zone outside every boundary", () => {
    // Far north of the MTM zone boxes, near zone 13's central meridian
    const { zone, exact } = resolveZone(system("MTM (NAD83)"), -84, 60);
    expect(exact).toBe(false);
    expect(zone.zone).toBe("13");
  });

  it("projects MTM zone 10 exactly on its central meridian", () => {
    const [x, y] = toZone(webMercator(-79.5, 45), "EPSG:2952");
    expect(x).toBeCloseTo(304800, 2);
    expect(y).toBeCloseTo(0.9999 * MERIDIAN_ARC_45, 0);
  });

  it("projects UTM 17N (NAD83) exactly on its central meridian", () => {
    const [x, y] = toZone(webMercator(-81, 45), "EPSG:2958");
    expect(x).toBeCloseTo(500000, 2);
    expect(y).toBeCloseTo(0.9996 * MERIDIAN_ARC_45, 0);
  });

  it("round-trips every zone to within a millimetre", () => {
    const start = webMercator(-81.3333, 48.4758);
    for (const s of coordinateSystems) {
      for (const z of s.zones) {
        const back = fromZone(toZone(start, z.code), z.code);
        expect(back[0]).toBeCloseTo(start[0], 3);
        expect(back[1]).toBeCloseTo(start[1], 3);
      }
    }
  });

  it("builds legacy-style titles and copy text", () => {
    const mtm = system("MTM (NAD83)");
    const title = zoneTitle(mtm, mtm.zones[2]);
    expect(title).toBe("MTM (NAD83) - 10");
    expect(zoneTitle(system("Lat / Long"), system("Lat / Long").zones[0])).toBe("Lat / Long");
    expect(copyFormats.map((f) => f.title)).toEqual(["Y,X", "X,Y", "Coordinate X,Y", "Coordinate Y,X"]);
    expect(formatCopyText("[coord] [y],[x]", title, "1.5", "2.5")).toBe("MTM (NAD83) - 10 2.5,1.5");
  });
});
