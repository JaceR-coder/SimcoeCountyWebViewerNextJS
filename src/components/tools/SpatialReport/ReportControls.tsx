"use client";

/**
 * Small Spatial Report form controls, ported from the legacy spatialreport/Report*.jsx components
 * (FilterBuilder, AggregateBuilder, FieldPicker, BufferControl, GroupingControl, ReferenceScope,
 * OutputToggles, SummaryPreview, ProgressBar).
 */

import React, { useState } from "react";
import { FaQuestion, FaTrash, FaPlus } from "react-icons/fa";
import type { AggregateRow, FilterRow, GroupingMode, SpatialPredicate } from "./payload";
import type { PreviewResult, ReportableLayer } from "./api";

const selectCls = "select select-bordered select-xs w-full";
const inputCls = "input input-bordered input-xs w-full";

export function SectionHeader({ title, helpLink }: { title: string; helpLink?: string }) {
  return (
    <div className="flex items-center justify-between mb-1">
      <span className="font-bold text-sm">{title}</span>
      {helpLink && (
        // New tab rather than an in-app iframe: the KB needs a py-Geomatics login
        <button type="button" className="btn btn-ghost btn-xs btn-circle" title={`Help: ${title}`} onClick={() => window.open(helpLink, "_blank")}>
          <FaQuestion size={10} />
        </button>
      )}
    </div>
  );
}

export function Section({ children }: { children: React.ReactNode }) {
  return <div className="card card-compact bg-base-100 border border-base-300 p-3 space-y-2">{children}</div>;
}

export const Muted = ({ children }: { children: React.ReactNode }) => <p className="text-xs text-base-content/70">{children}</p>;

export const LoadingRow = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2 text-xs text-base-content/70">
    <span className="loading loading-spinner loading-xs" /> {label}
  </div>
);

// ─── Filters ────────────────────────────────────────────────────────────────

const OPERATORS = [
  { value: "eq", label: "=" },
  { value: "ne", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "contains", label: "contains" },
  { value: "in", label: "is one of" },
  { value: "is_null", label: "is blank" },
  { value: "is_not_null", label: "is not blank" },
];
const NO_VALUE_OPERATORS = ["is_null", "is_not_null"];

export function FilterBuilder({ filters, fields, onChange }: { filters: FilterRow[]; fields: string[]; onChange: (f: FilterRow[]) => void }) {
  if (fields.length === 0) return null;
  const update = (i: number, patch: Partial<FilterRow>) => onChange(filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-1">
      {filters.map((filter, i) => (
        <div key={i} className="flex gap-1 items-center">
          <select className={selectCls} value={filter.field} onChange={(e) => update(i, { field: e.target.value })} aria-label="Filter field">
            {fields.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select className={`${selectCls} max-w-[6.5rem]`} value={filter.operator} onChange={(e) => update(i, { operator: e.target.value })} aria-label="Filter operator">
            {OPERATORS.map((op) => (
              <option key={op.value} value={op.value}>
                {op.label}
              </option>
            ))}
          </select>
          {!NO_VALUE_OPERATORS.includes(filter.operator) && (
            <input
              className={inputCls}
              value={filter.value === undefined || filter.value === null ? "" : String(filter.value)}
              placeholder={filter.operator === "in" ? "value1, value2, ..." : "value"}
              onChange={(e) => update(i, { value: e.target.value })}
              aria-label="Filter value"
            />
          )}
          <button type="button" className="btn btn-ghost btn-xs" title="Remove filter" onClick={() => onChange(filters.filter((_, idx) => idx !== i))}>
            <FaTrash size={10} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-xs btn-outline" onClick={() => onChange([...filters, { field: fields[0] || "", operator: "eq", value: "" }])}>
        <FaPlus size={9} /> Add Filter
      </button>
    </div>
  );
}

// ─── Calculations ───────────────────────────────────────────────────────────

const FUNCTIONS = [
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
  { value: "distinct_count", label: "Distinct Count" },
];

export function AggregateBuilder({ aggregates, fields, onChange }: { aggregates: AggregateRow[]; fields: string[]; onChange: (a: AggregateRow[]) => void }) {
  if (fields.length === 0) return null;
  const update = (i: number, patch: Partial<AggregateRow>) => onChange(aggregates.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  return (
    <div className="space-y-1">
      {aggregates.map((agg, i) => (
        <div key={i} className="flex gap-1 items-center">
          <select className={`${selectCls} max-w-[8rem]`} value={agg.function} onChange={(e) => update(i, { function: e.target.value })} aria-label="Calculation">
            {FUNCTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          {agg.function !== "count" && (
            <select className={selectCls} value={agg.field || ""} onChange={(e) => update(i, { field: e.target.value })} aria-label="Calculation field">
              <option value="">Select a field...</option>
              {fields.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <button type="button" className="btn btn-ghost btn-xs ml-auto" title="Remove calculation" onClick={() => onChange(aggregates.filter((_, idx) => idx !== i))}>
            <FaTrash size={10} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-xs btn-outline" onClick={() => onChange([...aggregates, { function: "count", field: null }])}>
        <FaPlus size={9} /> Add Calculation
      </button>
    </div>
  );
}

// ─── Output fields ──────────────────────────────────────────────────────────

export function FieldPicker({ fields, selected, onChange }: { fields: { name: string }[]; selected: string[]; onChange: (s: string[]) => void }) {
  if (fields.length === 0) return null;
  const toggle = (name: string) => onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
  return (
    <div>
      <Muted>All fields are included by default - uncheck any you don&apos;t want in the report.</Muted>
      <div className="max-h-40 overflow-y-auto border border-base-300 rounded p-1 mt-1">
        {fields.map((f) => (
          <label key={f.name} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
            <input type="checkbox" className="checkbox checkbox-xs" checked={selected.includes(f.name)} onChange={() => toggle(f.name)} />
            {f.name}
          </label>
        ))}
      </div>
    </div>
  );
}

// ─── Proximity buffer ───────────────────────────────────────────────────────

const UNIT_TO_METERS: Record<string, number> = { meters: 1, kilometers: 1000, miles: 1609.34, feet: 1 / 3.281, yards: 0.9144 };

export function BufferControl({ valueM, onChange }: { valueM: number; onChange: (meters: number) => void }) {
  const [units, setUnits] = useState("meters");
  const [distance, setDistance] = useState(valueM ? String(valueM) : "0");
  const emit = (d: string, u: string) => {
    const v = parseFloat(d);
    onChange(Number.isNaN(v) || v <= 0 ? 0 : v * (UNIT_TO_METERS[u] || 1));
  };
  return (
    <div className="space-y-1">
      <span className="text-xs">Group nearby features within:</span>
      <div className="flex gap-1">
        <input
          type="number"
          min={0}
          className={inputCls}
          value={distance}
          aria-label="Buffer distance"
          onChange={(e) => {
            setDistance(e.target.value);
            emit(e.target.value, units);
          }}
        />
        <select
          className={`${selectCls} max-w-[7rem]`}
          value={units}
          aria-label="Buffer units"
          onChange={(e) => {
            setUnits(e.target.value);
            emit(distance, e.target.value);
          }}
        >
          <option value="meters">Meters</option>
          <option value="kilometers">Kilometers</option>
          <option value="miles">Miles</option>
          <option value="feet">Feet</option>
          <option value="yards">Yards</option>
        </select>
      </div>
      <Muted>0 disables grouping - each layer is listed separately in the report.</Muted>
    </div>
  );
}

// ─── Grouping ───────────────────────────────────────────────────────────────

const CONTAINER_PREDICATES: { value: SpatialPredicate; label: string }[] = [
  { value: "intersects", label: "Intersects" },
  { value: "within", label: "Within" },
  { value: "contains", label: "Contains" },
];

export function GroupingControl(props: {
  mode: GroupingMode;
  onModeChange: (m: GroupingMode) => void;
  bufferM: number;
  onBufferChange: (m: number) => void;
  attributeField: string;
  attributeFieldOptions: string[];
  onAttributeFieldChange: (v: string) => void;
  containerLayers: ReportableLayer[];
  containerLayer: string;
  containerLabelField: string;
  containerLabelFieldOptions: string[];
  containerPredicate: SpatialPredicate;
  onContainerLayerChange: (v: string) => void;
  onContainerLabelFieldChange: (v: string) => void;
  onContainerPredicateChange: (v: SpatialPredicate) => void;
  containerFieldsLoading?: boolean;
}) {
  return (
    <div className="space-y-2">
      <select className={selectCls} value={props.mode} onChange={(e) => props.onModeChange(e.target.value as GroupingMode)} aria-label="Grouping mode">
        <option value="none">No grouping</option>
        <option value="proximity">Group nearby features (buffer distance)</option>
        <option value="attribute">Group by a field</option>
        <option value="container">Group by a reference layer</option>
      </select>

      {props.mode === "proximity" && (
        <>
          <BufferControl valueM={props.bufferM} onChange={props.onBufferChange} />
          <Muted>Field selection, filters, and calculations aren&apos;t available together with proximity grouping yet.</Muted>
        </>
      )}

      {props.mode === "attribute" && (
        <select className={selectCls} value={props.attributeField} onChange={(e) => props.onAttributeFieldChange(e.target.value)} aria-label="Group by field">
          <option value="">Select a field...</option>
          {props.attributeFieldOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}

      {props.mode === "container" && (
        <div className="space-y-1">
          <select className={selectCls} value={props.containerLayer} onChange={(e) => props.onContainerLayerChange(e.target.value)} aria-label="Group by layer">
            <option value="">Select a layer to group by...</option>
            {props.containerLayers.map((l) => (
              <option key={l.qualified_name} value={l.qualified_name}>
                {l.title}
              </option>
            ))}
          </select>
          {props.containerFieldsLoading && <LoadingRow label="Loading fields..." />}
          {props.containerLayer && (
            <>
              <select className={selectCls} value={props.containerLabelField} onChange={(e) => props.onContainerLabelFieldChange(e.target.value)} aria-label="Group label field">
                <option value="">Select a field to label each group with...</option>
                {props.containerLabelFieldOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select className={selectCls} value={props.containerPredicate} onChange={(e) => props.onContainerPredicateChange(e.target.value as SpatialPredicate)} aria-label="Group match rule">
                {CONTAINER_PREDICATES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </>
          )}
          <Muted>Each feature is grouped by which feature of this layer it matches. A feature matching more than one is counted once per match.</Muted>
        </div>
      )}
    </div>
  );
}

// ─── Reference-layer scope ──────────────────────────────────────────────────

export const SCOPE_PREDICATES: { value: SpatialPredicate; label: string }[] = [
  { value: "intersects", label: "Intersects" },
  { value: "within", label: "Within" },
  { value: "contains", label: "Contains" },
  { value: "within_distance", label: "Within distance of" },
];

export function PredicatePicker({ predicate, distance, onPredicateChange, onDistanceChange, label }: { predicate: SpatialPredicate; distance: string; onPredicateChange: (p: SpatialPredicate) => void; onDistanceChange: (d: string) => void; label: string }) {
  return (
    <div className="flex gap-1">
      <select className={selectCls} value={predicate} onChange={(e) => onPredicateChange(e.target.value as SpatialPredicate)} aria-label={label}>
        {SCOPE_PREDICATES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      {predicate === "within_distance" && (
        <input type="number" min={0} className={`${inputCls} max-w-[7rem]`} placeholder="metres" value={distance} onChange={(e) => onDistanceChange(e.target.value)} aria-label={`${label} distance (m)`} />
      )}
    </div>
  );
}

export function ReferenceScope(props: {
  layers: ReportableLayer[];
  layer: string;
  predicate: SpatialPredicate;
  distance: string;
  filters: FilterRow[];
  filterableFields: string[];
  fieldsLoading: boolean;
  onLayerChange: (v: string) => void;
  onPredicateChange: (p: SpatialPredicate) => void;
  onDistanceChange: (d: string) => void;
  onFiltersChange: (f: FilterRow[]) => void;
}) {
  if (props.layers.length === 0) return <Muted>No reportable layers are currently available to use as a reference layer.</Muted>;
  return (
    <div className="space-y-1">
      <select className={selectCls} value={props.layer} onChange={(e) => props.onLayerChange(e.target.value)} aria-label="Reference layer">
        <option value="">Select a reference layer...</option>
        {props.layers.map((l) => (
          <option key={l.qualified_name} value={l.qualified_name}>
            {l.title}
          </option>
        ))}
      </select>
      <PredicatePicker label="Reference match rule" predicate={props.predicate} distance={props.distance} onPredicateChange={props.onPredicateChange} onDistanceChange={props.onDistanceChange} />
      {props.fieldsLoading && <LoadingRow label="Loading fields..." />}
      {props.layer && props.filterableFields.length > 0 && (
        <>
          <Muted>Filter the reference layer (optional):</Muted>
          <FilterBuilder filters={props.filters} fields={props.filterableFields} onChange={props.onFiltersChange} />
        </>
      )}
      <Muted>Applies to every selected report layer, and can be combined with any grouping mode below.</Muted>
    </div>
  );
}

// ─── Output toggles ─────────────────────────────────────────────────────────

type OutputKey = "outputIncludeRaw" | "outputIncludeGroupedDetail" | "outputIncludeSummarySheet" | "outputIncludeLhrs";

export function OutputToggles(props: {
  includeRaw: boolean;
  includeGroupedDetail: boolean;
  includeSummarySheet: boolean;
  includeLhrs: boolean;
  grouped: boolean;
  hasAggregates: boolean;
  lhrsAvailable: boolean;
  onChange: (patch: Partial<Record<OutputKey, boolean>>) => void;
}) {
  const row = (checked: boolean, key: OutputKey, label: string) => (
    <label className="flex items-start gap-2 text-xs cursor-pointer">
      <input type="checkbox" className="checkbox checkbox-xs mt-0.5" checked={checked} onChange={(e) => props.onChange({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="space-y-1">
      {row(props.includeRaw, "outputIncludeRaw", "Raw feature list")}
      {props.grouped && row(props.includeGroupedDetail, "outputIncludeGroupedDetail", "Grouped detail (features listed within each group)")}
      {props.hasAggregates && row(props.includeSummarySheet, "outputIncludeSummarySheet", "Grouped summary (calculated totals only)")}
      {props.lhrsAvailable && row(props.includeLhrs, "outputIncludeLhrs", "Attach LHRS chainage/route data to each row (adds processing time)")}
    </div>
  );
}

// ─── Preview / progress ─────────────────────────────────────────────────────

const SEVERITY_CLASS: Record<string, string> = {
  none: "alert-success",
  info: "alert-info",
  confirm: "alert-warning",
  block_unless_admin: "alert-error",
  require_async: "alert-error",
};

export function SummaryPreview({ preview, layerTitle }: { preview?: PreviewResult; layerTitle: (qualifiedName: string) => string }) {
  if (!preview) return null;
  const counts = preview.per_layer_counts || {};
  return (
    <div role="status" className={`alert ${SEVERITY_CLASS[preview.severity] || "alert-info"} text-xs flex-col items-start gap-1 p-3`}>
      <div>
        <strong>Total features:</strong> {preview.total_features.toLocaleString()}
      </div>
      <ul className="list-disc ml-4">
        {Object.entries(counts).map(([layer, count]) => (
          <li key={layer}>
            {layerTitle(layer)}: {count.toLocaleString()}
          </li>
        ))}
      </ul>
      {preview.rejected_layers && preview.rejected_layers.length > 0 && <div>Not available/permitted: {preview.rejected_layers.join(", ")}</div>}
      {preview.message && <div className="font-semibold">{preview.message}</div>}
    </div>
  );
}

export function ProgressBar(props: { stage?: string; progress?: number; layerIndex?: number; layerCount?: number; featuresDone?: number; featuresTotal?: number }) {
  const parts: string[] = [];
  if (typeof props.layerIndex === "number" && typeof props.layerCount === "number") parts.push(`Layer ${props.layerIndex} of ${props.layerCount}`);
  if (typeof props.featuresTotal === "number") {
    parts.push(
      typeof props.featuresDone === "number"
        ? `${props.featuresDone.toLocaleString()} of ${props.featuresTotal.toLocaleString()} features so far`
        : `${props.featuresTotal.toLocaleString()} features`,
    );
  }
  const known = typeof props.progress === "number" && !Number.isNaN(props.progress);
  return (
    <div className="space-y-1" role="status" aria-live="polite">
      {known ? <progress className="progress progress-primary w-full" value={Math.max(4, Math.min(100, props.progress!))} max={100} /> : <progress className="progress progress-primary w-full" />}
      <div className="text-xs font-medium">{props.stage || "Starting..."}</div>
      {parts.length > 0 && <div className="text-xs text-base-content/70">{parts.join(" - ")}</div>}
    </div>
  );
}
