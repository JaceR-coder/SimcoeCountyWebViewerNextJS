import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WeatherRadar, { parseTimeDimension } from "../WeatherRadar";

describe("WeatherRadar", () => {
  beforeEach(() => {
    // Minimal stub of window.map used by the component to avoid errors
    (globalThis as any).window = (globalThis as any).window || {};
    (globalThis as any).window.map = {
      getLayers: () => ({ getArray: () => [] }),
      addLayer: () => {},
      removeLayer: () => {},
      getView: () => ({ getCenter: () => null }),
      getSize: () => null,
    };
  });

  afterEach(() => {
    try {
      delete (globalThis as any).window.map;
    } catch {}
  });

  it("mounts without throwing", () => {
    expect(() => render(<WeatherRadar />)).not.toThrow();
  });

  it("expands a GeoMet time dimension into frames", () => {
    const frames = parseTimeDimension("2026-10-02T10:18:00Z/2026-10-02T13:18:00Z/PT6M");
    expect(frames).toHaveLength(31);
    expect(frames[0].toISOString()).toBe("2026-10-02T10:18:00.000Z");
    expect(frames[30].toISOString()).toBe("2026-10-02T13:18:00.000Z");
  });

  it("accepts a list of instants", () => {
    const frames = parseTimeDimension("2026-10-02T13:00:00Z,2026-10-02T12:00:00Z");
    expect(frames.map((d) => d.toISOString())).toEqual(["2026-10-02T12:00:00.000Z", "2026-10-02T13:00:00.000Z"]);
  });
});
