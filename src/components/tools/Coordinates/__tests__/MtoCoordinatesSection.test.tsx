import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { transform } from "ol/proj";
import MtoCoordinatesSection from "../MtoCoordinatesSection";

vi.mock("react-icons/fa", () => ({
  FaCrosshairs: () => <span />,
  FaSearchPlus: () => <span />,
  FaMapMarkerAlt: () => <span />,
  FaCopy: () => <span />,
}));

vi.mock("@/utils/helpersBrowser", () => ({ glowContainer: () => {} }));

// North Bay - MTM zone 10 / UTM 17N
const northBay = transform([-79.4608, 46.3091], "EPSG:4326", "EPSG:3857");

const setup = () => {
  const onMovePoint = vi.fn();
  const utils = render(<MtoCoordinatesSection capturedPoint={null} livePoint={null} onMovePoint={onMovePoint} onMyMapsClick={vi.fn()} copyToClipboard={vi.fn()} />);
  const rerenderWith = (captured: { coord: number[]; id: number }) =>
    utils.rerender(<MtoCoordinatesSection capturedPoint={captured} livePoint={null} onMovePoint={onMovePoint} onMyMapsClick={vi.fn()} copyToClipboard={vi.fn()} />);
  return { onMovePoint, rerenderWith };
};

const xInput = () => document.getElementById("sc-coordinate-mto-x") as HTMLInputElement;
const yInput = () => document.getElementById("sc-coordinate-mto-y") as HTMLInputElement;

describe("MtoCoordinatesSection", () => {
  it("shows a captured point as lat/long by default", () => {
    const { rerenderWith } = setup();
    rerenderWith({ coord: northBay, id: 1 });
    expect(Number(xInput().value)).toBeCloseTo(-79.4608, 6);
    expect(Number(yInput().value)).toBeCloseTo(46.3091, 6);
  });

  it("picks the zone automatically when the coordinate system changes", () => {
    const { rerenderWith } = setup();
    rerenderWith({ coord: northBay, id: 1 });
    fireEvent.change(screen.getByLabelText("Coordinate system"), { target: { value: "1" } }); // MTM (NAD83)
    expect((screen.getByLabelText("Zone") as HTMLSelectElement).value).toBe("EPSG:2952"); // zone 10
    // Just west of zone 10's central meridian (-79.5 is 304800 m)
    expect(Number(xInput().value)).toBeGreaterThan(304800);
    expect(Number(xInput().value)).toBeLessThan(310000);
    expect((screen.getByLabelText("Formatted coordinates") as HTMLInputElement).value).toBe(`${yInput().value},${xInput().value}`);
  });

  it("moves the marker to typed coordinates in the selected zone", () => {
    const { onMovePoint, rerenderWith } = setup();
    rerenderWith({ coord: northBay, id: 1 });
    fireEvent.change(screen.getByLabelText("Coordinate system"), { target: { value: "2" } }); // UTM (NAD83)
    fireEvent.change(xInput(), { target: { value: "500000" } });
    const [coord, mode] = onMovePoint.mock.calls.at(-1) as [number[], string];
    expect(mode).toBe("pan");
    // Easting 500000 in UTM 17N is its central meridian, -81°
    expect(transform(coord, "EPSG:3857", "EPSG:4326")[0]).toBeCloseTo(-81, 6);
  });
});
