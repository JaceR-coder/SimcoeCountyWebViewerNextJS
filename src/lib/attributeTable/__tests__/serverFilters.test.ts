import { describe, it, expect } from "vitest";
import { buildArcgisWhere, buildWfsCql, inexactWfsFilterFields } from "../serverFilters";
import { buildWfsExportUrl } from "../wfs";
import type { ColumnSchema } from "../columnarStore";

const schema: ColumnSchema[] = [
  { name: "address", type: "string", alias: "Address" },
  { name: "shape_area", type: "number" },
  { name: "effective_datetime", type: "date" },
  { name: "active", type: "boolean", alias: "Active" },
];

describe("buildWfsCql", () => {
  it("returns undefined with no filters", () => {
    expect(buildWfsCql({}, schema)).toBeUndefined();
    expect(buildWfsCql({ address: "  " }, schema)).toBeUndefined();
  });

  it("matches text and numbers as case-insensitive substrings, escaping quotes", () => {
    expect(buildWfsCql({ address: "O'Brien St", shape_area: "12.5" }, schema)).toBe(
      `strToLowerCase("address") LIKE '%o''brien st%' AND strToLowerCase("shape_area") LIKE '%12.5%'`,
    );
  });

  it("sends only the date part of a date filter and leaves booleans to the client", () => {
    expect(buildWfsCql({ effective_datetime: "2023-10-11 04:00" }, schema)).toBe(`strToLowerCase("effective_datetime") LIKE '%2023-10-11%'`);
    expect(buildWfsCql({ effective_datetime: "oct" }, schema)).toBeUndefined();
    expect(buildWfsCql({ active: "yes" }, schema)).toBeUndefined();
  });

  it("moves the map-extent box into the CQL (GeoServer rejects bbox + CQL_FILTER)", () => {
    expect(buildWfsCql({ address: "main" }, schema, { bbox: [1, 2, 3, 4], geometryField: "wkb_geometry" })).toBe(
      `strToLowerCase("address") LIKE '%main%' AND BBOX("wkb_geometry", 1, 2, 3, 4, 'EPSG:3857')`,
    );
    // No filters: the caller keeps using the plain bbox parameter
    expect(buildWfsCql({}, schema, { bbox: [1, 2, 3, 4], geometryField: "wkb_geometry" })).toBeUndefined();
  });

  it("lists filters the server can't apply exactly", () => {
    expect(inexactWfsFilterFields({ address: "main", active: "yes", effective_datetime: "2023-10-11 04:00", shape_area: "1" }, schema)).toEqual(["Active", "effective_datetime"]);
    expect(inexactWfsFilterFields({ effective_datetime: "2023-10" }, schema)).toEqual([]);
  });
});

describe("buildArcgisWhere", () => {
  const domains = { material: [{ code: "PVC", name: "Polyvinyl Chloride" }, { code: "DI", name: "Ductile Iron" }], diameter: [{ code: 150, name: "150 mm" }] };
  const arcSchema: ColumnSchema[] = [
    { name: "NAME", type: "string" },
    { name: "MATERIAL", type: "string" },
    { name: "DIAMETER", type: "number" },
    { name: "LENGTH", type: "number" },
  ];

  it("filters text with UPPER LIKE and resolves domain names to codes", () => {
    expect(buildArcgisWhere({ NAME: "main", MATERIAL: "iron", DIAMETER: "150" }, arcSchema, domains)).toBe("UPPER(NAME) LIKE '%MAIN%' AND MATERIAL IN ('DI') AND DIAMETER IN (150)");
  });

  it("matches nothing for an unknown domain value and leaves plain numbers to the client", () => {
    expect(buildArcgisWhere({ MATERIAL: "copper" }, arcSchema, domains)).toBe("1=0");
    expect(buildArcgisWhere({ LENGTH: "12" }, arcSchema, domains)).toBeUndefined();
  });
});

describe("buildWfsExportUrl", () => {
  it("builds a CSV GetFeature without geometry, keeping filter and sort", () => {
    const url = new URL(
      buildWfsExportUrl({
        wfsUrl: "https://host/geoserver-proxy/wfs?service=WFS",
        layerName: "ner_works:assessment_parcel",
        format: "csv",
        cqlFilter: "x = 1",
        bbox: [1, 2, 3, 4],
        sortBy: { field: "address", direction: "D" },
        propertyNames: ["address", "shape_area"],
      }),
    );
    expect(url.pathname).toBe("/geoserver-proxy/wfs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      typeNames: "ner_works:assessment_parcel",
      outputFormat: "csv",
      srsName: "EPSG:3857",
      sortBy: "address D",
      CQL_FILTER: "x = 1",
      propertyName: "address,shape_area",
    });
  });

  it("builds a shapefile export with geometry and a plain bbox when there's no CQL", () => {
    const url = new URL(buildWfsExportUrl({ wfsUrl: "https://host/wfs", layerName: "a:b", format: "shapefile", bbox: [1, 2, 3, 4], propertyNames: ["x"] }));
    expect(url.searchParams.get("outputFormat")).toBe("SHAPE-ZIP");
    expect(url.searchParams.get("bbox")).toBe("1,2,3,4,EPSG:3857");
    expect(url.searchParams.has("propertyName")).toBe(false);
    expect(url.searchParams.has("count")).toBe(false);
  });
});
