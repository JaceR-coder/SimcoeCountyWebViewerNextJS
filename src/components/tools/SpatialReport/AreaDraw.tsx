"use client";

/**
 * "Map Area" scope - draw a polygon or box on the map. Ported from the legacy ReportAreaDraw.jsx.
 * The drawn area stays on the map while this scope is shown, and is redrawn from the stored
 * GeoJSON if the panel is reopened.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import Draw, { createBox } from "ol/interaction/Draw";
import { Vector as VectorSource } from "ol/source";
import { Vector as VectorLayer } from "ol/layer";
import { Fill, Stroke, Style } from "ol/style";
import { GeoJSON } from "ol/format";
import { useMapStore } from "@/stores/mapStore";
import { LayerManager } from "@/utils/openlayers/LayerManager";

const geojson = new GeoJSON();
const areaStyle = new Style({ stroke: new Stroke({ color: "#1d4ed8", width: 2 }), fill: new Fill({ color: "rgba(29, 78, 216, 0.12)" }) });

export default function AreaDraw({ areaGeoJSON, onAreaDrawn }: { areaGeoJSON?: object; onAreaDrawn: (g: object | undefined) => void }) {
  const map = useMapStore((s) => s.map);
  const setActiveToolId = useMapStore((s) => s.setActiveToolId);
  const [drawing, setDrawing] = useState(false);
  const sourceRef = useRef<VectorSource | null>(null);
  const drawRef = useRef<Draw | null>(null);

  const stopDrawing = useCallback(() => {
    if (drawRef.current && map) map.removeInteraction(drawRef.current);
    drawRef.current = null;
    setDrawing(false);
    setActiveToolId(null);
  }, [map, setActiveToolId]);

  useEffect(() => {
    if (!map) return;
    const source = new VectorSource();
    sourceRef.current = source;
    const layerId = LayerManager.addLayer(new VectorLayer({ source, style: areaStyle, zIndex: 999 }), "Tools", "Spatial Report Area", { visible: true });
    return () => {
      if (drawRef.current) map.removeInteraction(drawRef.current);
      drawRef.current = null;
      setActiveToolId(null);
      if (layerId) LayerManager.removeLayer(layerId);
      sourceRef.current = null;
    };
  }, [map, setActiveToolId]);

  // Keep the map graphic in sync with the stored area (also restores it when the panel reopens)
  useEffect(() => {
    const source = sourceRef.current;
    if (!source || drawing) return;
    source.clear();
    if (areaGeoJSON) {
      source.addFeature(geojson.readFeature({ type: "Feature", geometry: areaGeoJSON, properties: {} }, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }) as never);
    }
  }, [areaGeoJSON, drawing, map]);

  const startDrawing = (kind: "Polygon" | "Box") => {
    if (!map || !sourceRef.current) return;
    stopDrawing();
    sourceRef.current.clear();
    const draw = new Draw({ source: sourceRef.current, type: kind === "Box" ? "Circle" : "Polygon", geometryFunction: kind === "Box" ? createBox() : undefined });
    draw.on("drawend", (evt) => {
      const geometry = evt.feature.getGeometry();
      if (geometry) onAreaDrawn(geojson.writeGeometryObject(geometry, { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }));
      // Remove on the next tick - removing a Draw interaction inside its own drawend handler
      // swallows the final click and can re-trigger other map click handlers
      setTimeout(stopDrawing, 0);
    });
    drawRef.current = draw;
    map.addInteraction(draw);
    // Suppress property/identify clicks while the user is placing vertices
    setActiveToolId("spatialreport-draw");
    setDrawing(true);
  };

  return (
    <div className="flex flex-wrap gap-1 items-center">
      <button type="button" className="btn btn-xs btn-outline" disabled={drawing} onClick={() => startDrawing("Polygon")}>
        Draw Polygon
      </button>
      <button type="button" className="btn btn-xs btn-outline" disabled={drawing} onClick={() => startDrawing("Box")}>
        Draw Box
      </button>
      {drawing && (
        <button type="button" className="btn btn-xs" onClick={stopDrawing}>
          Cancel Drawing
        </button>
      )}
      {areaGeoJSON && !drawing && (
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => onAreaDrawn(undefined)}>
          Clear Area
        </button>
      )}
      <span className="text-xs text-base-content/70 w-full">{drawing ? "Click to add points; double-click to finish." : areaGeoJSON ? "Area drawn." : "No area drawn yet."}</span>
    </div>
  );
}
