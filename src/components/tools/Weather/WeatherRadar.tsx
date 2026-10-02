"use client";

/**
 * Weather radar from Environment and Climate Change Canada's GeoMet WMS (the North American 1 km
 * radar composite). Replaces the County of Simcoe radar feed, which read per-station images from
 * Simcoe's own SQL Server and isn't available to i-Map. GeoMet is public, sends CORS headers (so
 * the local Print tool can capture it), and keeps the last 3 hours at 6-minute steps - frames are
 * read from the layer's WMS time dimension and shown by changing the TIME parameter.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { FaSyncAlt, FaPlay, FaPause } from "react-icons/fa";
import Slider from "rc-slider";
import "rc-slider/assets/index.css";

import ImageLayer from "ol/layer/Image";
import ImageWMS from "ol/source/ImageWMS";
import { LayerManager } from "@/utils/openlayers/LayerManager";

const GEOMET_WMS = "https://geo.weather.gc.ca/geomet";
const REFRESH_MS = 60 * 1000;
const PLAY_MS = 1000;

const PRODUCTS = {
  rain: { label: "Rain", layer: "RADAR_1KM_RRAI", style: "Radar-Rain_14colors" },
  snow: { label: "Snow", layer: "RADAR_1KM_RSNO", style: "Radar-Snow_14colors" },
} as const;
type Product = keyof typeof PRODUCTS;

const ISO_DURATION = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;

/** Expand a WMS time dimension ("start/end/PT6M", or a comma list of instants) into frame times. */
export function parseTimeDimension(value: string): Date[] {
  const frames: Date[] = [];
  for (const part of value.split(",").map((p) => p.trim()).filter(Boolean)) {
    const [start, end, period] = part.split("/");
    if (!end || !period) {
      const d = new Date(start);
      if (!Number.isNaN(d.getTime())) frames.push(d);
      continue;
    }
    const m = ISO_DURATION.exec(period);
    const stepMs = m ? ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000 : 0;
    const from = new Date(start).getTime();
    const to = new Date(end).getTime();
    if (!stepMs || Number.isNaN(from) || Number.isNaN(to)) continue;
    for (let t = from; t <= to; t += stepMs) frames.push(new Date(t));
  }
  return frames.sort((a, b) => a.getTime() - b.getTime());
}

async function fetchFrames(layerName: string): Promise<Date[]> {
  const url = `${GEOMET_WMS}?service=WMS&version=1.3.0&request=GetCapabilities&layer=${layerName}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`GeoMet capabilities failed (${response.status})`);
  const xml = new DOMParser().parseFromString(await response.text(), "text/xml");
  const dimension = Array.from(xml.getElementsByTagName("Dimension")).find((d) => d.getAttribute("name") === "time");
  return dimension?.textContent ? parseTimeDimension(dimension.textContent) : [];
}

function formatFrame(d: Date): string {
  return d.toLocaleString("en-CA", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function legendUrl(product: Product): string {
  const { layer, style } = PRODUCTS[product];
  return `${GEOMET_WMS}?service=WMS&version=1.3.0&request=GetLegendGraphic&sld_version=1.1.0&format=image/png&layer=${layer}&style=${style}&lang=en`;
}

export default function WeatherRadar(): React.ReactElement {
  const [product, setProduct] = useState<Product>("rain");
  const [frames, setFrames] = useState<Date[]>([]);
  const [frameIndex, setFrameIndex] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(0.7);

  const layerIdRef = useRef<string | null>(null);
  const sourceRef = useRef<ImageWMS | null>(null);
  const instanceIdRef = useRef<string>(crypto.randomUUID());
  // Whether the slider sits on the newest frame - a refresh then keeps it on the (new) newest one
  const atLatestRef = useRef(true);

  const currentFrame = frames[frameIndex];

  // One WMS layer for the tool's lifetime; frames and products only change its params
  useEffect(() => {
    const source = new ImageWMS({
      url: GEOMET_WMS,
      params: { LAYERS: PRODUCTS.rain.layer, STYLES: PRODUCTS.rain.style, TRANSPARENT: true, FORMAT: "image/png" },
      ratio: 1,
      crossOrigin: "anonymous",
    });
    const layer = new ImageLayer({ source, opacity: 0.7, visible: false });
    sourceRef.current = source;
    layerIdRef.current = LayerManager.addLayer(layer, "Tools", "Weather Radar", { id: `weather-radar-${instanceIdRef.current}` });

    return () => {
      if (layerIdRef.current) LayerManager.removeLayer(layerIdRef.current);
      layerIdRef.current = null;
      sourceRef.current = null;
    };
  }, []);

  const loadFrames = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await fetchFrames(PRODUCTS[product].layer);
      setError(next.length ? null : "No radar frames are available right now.");
      setFrames(next);
      setFrameIndex((i) => (atLatestRef.current ? Math.max(0, next.length - 1) : Math.min(i, Math.max(0, next.length - 1))));
    } catch (err) {
      console.error("Error fetching radar frames:", err);
      setError("Could not load radar from Environment Canada.");
    } finally {
      setIsLoading(false);
    }
  }, [product]);

  // Load on mount / product change, then refresh every minute unless paused or playing
  useEffect(() => {
    atLatestRef.current = true;
    loadFrames();
  }, [loadFrames]);

  useEffect(() => {
    if (!autoRefresh || isPlaying) return;
    const id = window.setInterval(loadFrames, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [autoRefresh, isPlaying, loadFrames]);

  // Push the selected product + frame to the map layer
  useEffect(() => {
    const source = sourceRef.current;
    const managed = layerIdRef.current ? LayerManager.getLayer(layerIdRef.current) : null;
    if (!source || !managed) return;
    const { layer: layerName, style } = PRODUCTS[product];
    if (currentFrame) source.updateParams({ LAYERS: layerName, STYLES: style, TIME: currentFrame.toISOString().replace(".000Z", "Z") });
    managed.layer.setVisible(!!currentFrame);
  }, [product, currentFrame]);

  useEffect(() => {
    const managed = layerIdRef.current ? LayerManager.getLayer(layerIdRef.current) : null;
    managed?.layer.setOpacity(opacity);
  }, [opacity]);

  // Playback loops through the frames
  useEffect(() => {
    if (!isPlaying || frames.length === 0) return;
    const id = window.setInterval(() => {
      setFrameIndex((i) => {
        const next = (i + 1) % frames.length;
        atLatestRef.current = next === frames.length - 1;
        return next;
      });
    }, PLAY_MS);
    return () => window.clearInterval(id);
  }, [isPlaying, frames.length]);

  const onSliderChange = (val: number | number[]) => {
    const idx = typeof val === "number" ? val : val[0];
    atLatestRef.current = idx === frames.length - 1;
    setFrameIndex(idx);
  };

  return (
    <div className="p-3 space-y-3 bg-base-100">
      <div className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="checkbox checkbox-sm"
          checked={autoRefresh}
          onChange={(e) => setAutoRefresh(e.target.checked)}
          disabled={isPlaying}
          title={isPlaying ? "Auto refresh disabled while playing" : ""}
        />
        <span className="text-sm">Automatically refresh every minute.</span>

        <button className="btn btn-xs btn-outline ml-auto" onClick={() => loadFrames()} disabled={isPlaying} aria-label="Refresh radar" title="Refresh now">
          <FaSyncAlt className={isLoading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="divider my-1" />

      <div className="space-y-2">
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            className="btn btn-xs btn-primary"
            onClick={() => setIsPlaying((p) => !p)}
            disabled={frames.length === 0}
            aria-label={isPlaying ? "Pause playback" : "Play playback"}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <FaPause /> : <FaPlay />}
          </button>

          <div className="flex-1 px-2">
            <Slider max={Math.max(0, frames.length - 1)} value={frameIndex} onChange={onSliderChange} />
          </div>
        </div>

        <div className="text-xs text-base-content/70">
          <span className="font-semibold">Radar Date:</span> {currentFrame ? formatFrame(currentFrame) : "-"}
        </div>

        {error && <div className="text-xs text-error">{error}</div>}
      </div>

      <div className="p-3 rounded-lg border border-base-300 bg-base-200 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-sm font-semibold">Precipitation:</span>
          {(Object.keys(PRODUCTS) as Product[]).map((key) => (
            <label key={key} className="label cursor-pointer justify-start gap-2 p-0">
              <input type="radio" name="radarproduct" className="radio radio-sm" checked={product === key} onChange={() => setProduct(key)} disabled={isPlaying} />
              <span className="label-text">{PRODUCTS[key].label}</span>
            </label>
          ))}
        </div>
        <div className="text-xs text-base-content/70">Showing the last 3 hours of the Canadian radar composite (updated every 6 minutes).</div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold">Opacity</div>
          <div className="badge badge-ghost">{Math.round(opacity * 100)}%</div>
        </div>
        <Slider included={false} max={1} min={0} step={0.01} value={opacity} onChange={(v: number | number[]) => setOpacity(typeof v === "number" ? v : v[0])} />
      </div>

      <div className="mt-3">
        <div className="text-sm font-semibold mb-1">{PRODUCTS[product].label} legend</div>
        <img src={legendUrl(product)} alt={`${PRODUCTS[product].label} radar legend`} className="bg-white p-1 rounded" />

        <div className="mt-2 border-t pt-2 text-[11px] text-center">
          <div>Weather Data Provided by Environment and Climate Change Canada (MSC GeoMet)</div>
          <div className="mt-1">
            <a href="https://weather.gc.ca/" target="_blank" rel="noreferrer" className="link">
              weather.gc.ca
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
