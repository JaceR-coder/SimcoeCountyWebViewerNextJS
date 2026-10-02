"use client";

/**
 * Spatial Report tool - ported from the legacy SimcoeCountyWebViewer SpatialReport.jsx (Phase 5a).
 *
 * Pick one or more reportable layers (the ones currently turned on in the TOC), scope the report to
 * the whole layer, a drawn area, another layer's geometry or an LHRS range, optionally group,
 * filter and calculate, preview the size, view the rows in a table, and generate an Excel /
 * GeoPackage / KML / GeoJSON export as a background job with live progress.
 *
 * Backend: py-Geomatics app.gis_reports, reached same-origin via the /geomatics rewrite with the
 * user's py-Geomatics login (see api.ts). Visible to everyone; signed-out users get a sign-in prompt.
 * Filter Map shows only the matching features on the map (utils/mapFilter.ts); a filter can be saved
 * to its layer, toggled from the Layers tab (TOC/LayerItem.tsx) and loaded back into this form.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaSignInAlt, FaSyncAlt } from "react-icons/fa";
import PanelComponent from "@/components/PanelComponent";
import { useLayerManagerStore } from "@/stores/layerManagerStore";
import { useLayerFilterStore, type SavedLayerFilter } from "@/stores/layerFilterStore";
import { applyMapFilter, clearMapFilter, ensureLayerVisible, qualifiedLayerName } from "@/utils/mapFilter";
import { useImapAuthStore } from "@/stores/imapAuthStore";
import { useSpatialReportStore, formatLookup } from "@/stores/spatialReportStore";
import { showMessage } from "@/utils/helpersUI";
import * as api from "./api";
import { ReportAuthError, type ExportFormat, type PreviewResult, type ReportableLayer, type TableResult } from "./api";
import { buildPayload, canFilterMap, canRun, canRunReason, canSaveFilter, canViewTable, criteriaFromPayload, formPatchFromCriteria, isAdvanced, isProximityActive, type GroupingMode, type Scope } from "./payload";
import { AggregateBuilder, BufferControl, FieldPicker, FilterBuilder, GroupingControl, LoadingRow, Muted, OutputToggles, ProgressBar, ReferenceScope, Section, SectionHeader, SummaryPreview } from "./ReportControls";
import AreaDraw from "./AreaDraw";
import LhrsRangeScope from "./LhrsRangeScope";
import ReportTableModal from "./ReportTableModal";
import SavedFiltersModal from "./SavedFiltersModal";

const POLL_INTERVAL_MS = 1500;

interface SpatialReportToolProps {
  name?: string;
  helpLink?: string;
  hideHeader?: boolean;
  onClose: () => void;
  onSidebarVisibility?: () => void;
  config?: Record<string, unknown>;
}

interface JobProgress {
  stage?: string;
  progress?: number;
  layerIndex?: number;
  layerCount?: number;
  featuresDone?: number;
  featuresTotal?: number;
}

const SCOPES: { value: Scope; label: string }[] = [
  { value: "layer", label: "Entire Layer(s)" },
  { value: "area", label: "Map Area" },
  { value: "reference", label: "Reference Layer" },
  { value: "lhrs", label: "LHRS Range" },
];

/**
 * Qualified `workspace:layer` names of every GeoServer layer actually drawn on the map. Read from
 * the layer manager (the OL layers, as legacy getVisibleGeoServerLayerNames() walked window.map)
 * rather than tocStore's `visible` flags: switching TOC groups hides the other groups' layers on the
 * map without clearing their flags, so those flags over- and under-report what's really on.
 */
function useVisibleGeoServerLayerNames(): string[] {
  const tocLayers = useLayerManagerStore((s) => s.layers.TOC);
  return useMemo(
    () =>
      Array.from(
        new Set(
          tocLayers
            .filter((l) => l.visible && l.layer?.getVisible() !== false)
            .map(qualifiedLayerName)
            .filter((n): n is string => !!n),
        ),
      ).sort(),
    [tocLayers],
  );
}

export default function SpatialReportTool({ name = "Spatial Tool", helpLink, hideHeader = false, onClose, onSidebarVisibility, config }: SpatialReportToolProps) {
  const helpLinks = (config?.sectionHelpLinks as Record<string, string> | undefined) ?? {};

  // ── Auth ────────────────────────────────────────────────────────────────
  const authStatus = useImapAuthStore((s) => s.status);
  const userDisplayName = useImapAuthStore((s) => s.userDisplayName);
  const [authRequired, setAuthRequired] = useState(false);
  const signedIn = !!userDisplayName && !authRequired;
  useEffect(() => {
    if (userDisplayName) setAuthRequired(false);
  }, [userDisplayName]);

  // ── Form ────────────────────────────────────────────────────────────────
  const form = useSpatialReportStore((s) => s.form);
  const layerFields = useSpatialReportStore((s) => s.layerFields);
  const referenceLayerFields = useSpatialReportStore((s) => s.referenceLayerFields);
  const containerLayerFields = useSpatialReportStore((s) => s.containerLayerFields);
  const { update, setSelectedLayers, setLayerFields, setReferenceLayerFields, setContainerLayerFields } = useSpatialReportStore.getState();
  const advanced = isAdvanced(form);

  // ── Request state ───────────────────────────────────────────────────────
  const visibleLayerNames = useVisibleGeoServerLayerNames();
  const [layers, setLayers] = useState<ReportableLayer[]>([]);
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState<string>();
  const [fieldsLoading, setFieldsLoading] = useState({ primary: false, reference: false, container: false });
  const [gdalAvailable, setGdalAvailable] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("xlsx");
  const [preview, setPreview] = useState<PreviewResult>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [job, setJob] = useState<JobProgress>({});
  const [mapFilterLoading, setMapFilterLoading] = useState(false);
  const mapFilterActive = useLayerFilterStore((s) => s.mapFilterActive);
  const [saveFilterName, setSaveFilterName] = useState<string | null>(null);
  const [savedFiltersOpen, setSavedFiltersOpen] = useState(false);
  const mapFilterAbort = useRef<AbortController | null>(null);
  const [table, setTable] = useState<{ open: boolean; loading: boolean; error?: string; result?: TableResult }>({ open: false, loading: false });

  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentJobId = useRef<number | null>(null);
  const mounted = useRef(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const busy = previewLoading || generating;

  // py-Geomatics rejected the session (expired / logged out elsewhere): show the sign-in prompt and
  // refresh the shared login state so the header updates too
  const requireAuth = useCallback(() => {
    setAuthRequired(true);
    useImapAuthStore.getState().refresh();
  }, []);

  const handleError = useCallback((title: string, err: unknown) => {
    if (err instanceof ReportAuthError) {
      requireAuth();
      return;
    }
    showMessage(title, (err as Error).message, "error", 8000);
  }, [requireAuth]);

  const scrollToBottom = () => setTimeout(() => containerRef.current?.closest(".overflow-auto, .overflow-y-auto")?.scrollTo({ top: 1e9, behavior: "smooth" }), 50);

  const layerTitle = useCallback((qn: string) => layers.find((l) => l.qualified_name === qn)?.title ?? qn, [layers]);

  // Any form change invalidates a shown preview
  const change = useCallback(
    (patch: Parameters<typeof update>[0]) => {
      update(patch);
      setPreview(undefined);
    },
    [update],
  );

  // ── Loading reportable layers / formats ─────────────────────────────────
  const loadLayers = useCallback(async () => {
    setLayersLoading(true);
    setLayersError(undefined);
    try {
      const result = await api.getReportableLayers(visibleLayerNames);
      if (!mounted.current) return;
      setLayers(result);
      // Drop selections that are no longer on the map / reportable
      const available = new Set(result.map((l) => l.qualified_name));
      const kept = useSpatialReportStore.getState().form.selectedLayers.filter((n) => available.has(n));
      if (kept.length !== useSpatialReportStore.getState().form.selectedLayers.length) setSelectedLayers(kept);
    } catch (err) {
      if (err instanceof ReportAuthError) requireAuth();
      else setLayersError((err as Error).message);
    } finally {
      if (mounted.current) setLayersLoading(false);
    }
  }, [visibleLayerNames, setSelectedLayers, requireAuth]);

  // Reload whenever the set of layers on the map changes, not just on mount: the sidebar keeps this
  // tool mounted (forceRenderTabPanel) while layers are toggled in the Layers tab, so a mount-only
  // load left the list stale. Debounced so a batch of TOC toggles is one request.
  const visibleKey = visibleLayerNames.join("|");
  useEffect(() => {
    if (!signedIn) return;
    const timer = setTimeout(loadLayers, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, visibleKey]);

  useEffect(() => {
    if (!signedIn) return;
    api
      .getExportFormats()
      .then((r) => mounted.current && setGdalAvailable(!!r.gdal_available))
      .catch(() => {}); // non-fatal: GeoPackage/KML/GeoJSON just stay unavailable
  }, [signedIn]);

  // ── Field lookups ───────────────────────────────────────────────────────
  const primaryLayer = advanced ? form.selectedLayers[0] : undefined;
  // layerFields deliberately isn't a dependency: setLayerFields() changing it re-ran this effect,
  // whose cleanup cancelled the request that had just finished, so the .finally() never cleared
  // fieldsLoading and the Filters section spun on "Loading layer fields..." forever. Read the
  // current value from the store instead.
  useEffect(() => {
    if (!signedIn || !primaryLayer || useSpatialReportStore.getState().layerFields?.qualified_name === primaryLayer) return;
    let cancelled = false;
    setFieldsLoading((s) => ({ ...s, primary: true }));
    api
      .getLayerFields(primaryLayer)
      .then((info) => !cancelled && setLayerFields(info))
      .catch((err) => !cancelled && handleError("Could Not Load Fields", err))
      .finally(() => !cancelled && setFieldsLoading((s) => ({ ...s, primary: false })));
    return () => {
      cancelled = true;
      // A superseded request never reaches its .finally() update, so clear the flag here
      setFieldsLoading((s) => ({ ...s, primary: false }));
    };
  }, [signedIn, primaryLayer, setLayerFields, handleError]);

  const loadSideFields = useCallback(
    (which: "reference" | "container", layerName: string) => {
      const setter = which === "reference" ? setReferenceLayerFields : setContainerLayerFields;
      if (!layerName) {
        setter(undefined);
        return;
      }
      setFieldsLoading((s) => ({ ...s, [which]: true }));
      api
        .getLayerFields(layerName)
        .then((info) => mounted.current && setter(info))
        .catch(() => mounted.current && setter(undefined)) // non-fatal: the dependent picker stays empty
        .finally(() => mounted.current && setFieldsLoading((s) => ({ ...s, [which]: false })));
    },
    [setReferenceLayerFields, setContainerLayerFields],
  );

  // ── Actions ─────────────────────────────────────────────────────────────
  const payload = () => buildPayload(useSpatialReportStore.getState().form, formatLookup(layerFields), formatLookup(referenceLayerFields));

  const onPreview = async () => {
    if (!canRun(form)) return;
    setPreviewLoading(true);
    setPreview(undefined);
    try {
      const result = await api.previewReport(payload());
      if (!mounted.current) return;
      setPreview(result);
      scrollToBottom();
    } catch (err) {
      handleError("Preview Failed", err);
    } finally {
      if (mounted.current) setPreviewLoading(false);
    }
  };

  const onViewTable = async () => {
    if (!canViewTable(form)) return;
    setTable({ open: true, loading: true });
    try {
      const result = await api.fetchReportTable(payload());
      if (mounted.current) setTable({ open: true, loading: false, result });
    } catch (err) {
      if (err instanceof ReportAuthError) requireAuth();
      if (mounted.current) setTable({ open: true, loading: false, error: (err as Error).message });
    }
  };

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const finishJob = () => {
    stopPolling();
    currentJobId.current = null;
    if (mounted.current) {
      setGenerating(false);
      setJob({});
    }
  };

  const poll = async (jobId: number, format: ExportFormat) => {
    if (currentJobId.current !== jobId) return;
    try {
      const status = await api.getJobStatus(jobId);
      if (currentJobId.current !== jobId) return; // cancelled or superseded meanwhile
      if (status.status === "cancelled") {
        finishJob();
        showMessage("Report Cancelled", "Report generation was cancelled.", "warning", 5000);
      } else if (status.status === "failed") {
        finishJob();
        showMessage("Report Failed", status.error || "The report could not be generated.", "error", 8000);
      } else if (status.status === "completed") {
        setJob({ stage: "Preparing download...", progress: 100 });
        try {
          await api.downloadJob(jobId, format);
          showMessage("Report Ready", "Your spatial report has downloaded.", "success", 5000);
        } catch (err) {
          handleError("Report Failed", err);
        } finally {
          finishJob();
        }
      } else {
        setJob({
          stage: status.stage || "Working...",
          progress: status.stage_count ? Math.round(((status.stage_index ?? 0) / status.stage_count) * 100) : undefined,
          layerIndex: status.layer_index,
          layerCount: status.layer_count,
          featuresDone: status.features_done,
          featuresTotal: status.total_features,
        });
        pollTimer.current = setTimeout(() => poll(jobId, format), POLL_INTERVAL_MS);
      }
    } catch (err) {
      finishJob();
      handleError("Report Failed", err);
    }
  };

  const onGenerate = async () => {
    if (!canRun(form) || generating) return;
    if (preview && (preview.severity === "confirm" || preview.severity === "block_unless_admin")) {
      if (!window.confirm(preview.message || "This report is large. Continue?")) return;
    }
    // Captured now: the dropdown may change while a multi-minute job runs
    const format = exportFormat;
    setTable((t) => ({ ...t, open: false }));
    setGenerating(true);
    setJob({ stage: "Starting..." });
    scrollToBottom();
    try {
      const { job_id } = await api.startReportJob({ ...payload(), export_format: format });
      currentJobId.current = job_id;
      poll(job_id, format);
    } catch (err) {
      finishJob();
      handleError("Report Failed", err);
    }
  };

  // Best-effort on the backend; the job row is marked cancelled as soon as this succeeds
  const onCancel = async () => {
    const jobId = currentJobId.current;
    if (!jobId) return;
    try {
      await api.cancelJob(jobId);
      if (currentJobId.current !== jobId) return;
      finishJob();
      showMessage("Report Cancelled", "Report generation was cancelled.", "warning", 5000);
    } catch (err) {
      handleError("Cancel Failed", err);
    }
  };

  // ── Filter Map / saved filters ──────────────────────────────────────────
  // Explicit actions only: editing the form never touches the map by itself.
  const onFilterMap = async () => {
    if (!canFilterMap(form)) return;
    const controller = new AbortController();
    mapFilterAbort.current = controller;
    setMapFilterLoading(true);
    try {
      const result = await api.buildMapFilter(payload(), controller.signal);
      const matched = result.targets.reduce((sum, t) => sum + (t.matched_count || 0), 0);
      const zoomed = applyMapFilter(result);
      if (matched === 0) showMessage("No Features Match", "No features on the map match the current scope/filters.", "warning", 6000);
      else if (!zoomed) showMessage("Map Filtered", `${matched} feature(s) matched, but the map could not be zoomed to their extent.`, "success", 6000);
      else showMessage("Map Filtered", `${matched} feature(s) matched.`, "success", 5000);
    } catch (err) {
      if (controller.signal.aborted) {
        if (mounted.current) showMessage("Filter Map Cancelled", "The Filter Map request was cancelled.", "warning", 4000);
      } else handleError("Filter Map Failed", err);
    } finally {
      mapFilterAbort.current = null;
      if (mounted.current) setMapFilterLoading(false);
    }
  };

  const onSaveFilter = () => {
    const name = saveFilterName?.trim();
    if (!name || !canSaveFilter(form)) return;
    const layerName = form.selectedLayers[0];
    useLayerFilterStore.getState().saveFilter(layerName, name, criteriaFromPayload(payload()));
    setSaveFilterName(null);
    showMessage("Filter Saved", `Saved "${name}" to layer "${layerTitle(layerName)}". Toggle it from the Layers tab.`, "success", 5000);
  };

  // Rebuilds a saved filter's scope/filters in the form, as if entered by hand
  const onLoadSavedFilter = (layerName: string, filter: SavedLayerFilter) => {
    if (!layers.some((l) => l.qualified_name === layerName) && !ensureLayerVisible(layerName)) {
      showMessage("Layer Not Available", `"${layerTitle(layerName)}" isn't in the Layers list, so this filter can't be loaded.`, "warning", 6000);
      return;
    }
    setSelectedLayers([layerName]);
    const patch = formPatchFromCriteria(filter.criteria);
    change(patch);
    if (patch.scope === "reference" && patch.scopeReferenceLayer) loadSideFields("reference", patch.scopeReferenceLayer);
    showMessage("Filter Loaded", `Loaded "${filter.name}" for layer "${layerTitle(layerName)}".`, "success", 4000);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopPolling();
      currentJobId.current = null;
      mapFilterAbort.current?.abort();
    };
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────
  const panel = (children: React.ReactNode) => (
    <PanelComponent name={name} helpLink={helpLink} hideHeader={hideHeader} onClose={onClose} onSidebarVisibility={onSidebarVisibility}>
      <div ref={containerRef} className="relative w-full text-base-content p-2 space-y-3">
        {children}
      </div>
    </PanelComponent>
  );

  if (authStatus === "idle" || authStatus === "loading") return panel(<LoadingRow label="Checking your pyGeomatics login..." />);

  if (!signedIn) {
    return panel(
      <div className="card bg-base-100 border border-base-300 p-4 space-y-3 text-center">
        <p className="text-sm font-medium">Sign in to use the Spatial Tool</p>
        <p className="text-xs text-base-content/70">Spatial reports use your pyGeomatics account and its layer permissions.</p>
        {authStatus === "error" && <p className="text-xs text-error">pyGeomatics can&apos;t be reached right now.</p>}
        <button type="button" className="btn btn-primary btn-sm mx-auto" onClick={() => (window.location.href = useImapAuthStore.getState().loginUrl())}>
          <FaSignInAlt /> Sign In
        </button>
      </div>,
    );
  }

  const filterable = layerFields?.filterable_fields ?? [];
  const reason = canRunReason(form);
  const grouped = advanced ? form.groupingMode !== "none" : isProximityActive(form);
  const showFieldsFilters = advanced && form.groupingMode !== "proximity";

  return panel(
    <>
      {/* LAYERS */}
      <Section>
        <SectionHeader title="Layers" helpLink={helpLinks.layers} />
        <div className="flex items-center justify-between gap-2">
          <Muted>Only layers currently turned on in the map are shown.</Muted>
          <button type="button" className="btn btn-xs btn-ghost" onClick={loadLayers} disabled={layersLoading} title="Reload the layer list from the map">
            <FaSyncAlt size={10} /> Refresh
          </button>
        </div>
        {layersLoading && <LoadingRow label="Loading layers..." />}
        {!layersLoading && layersError && <p className="text-xs text-error">{layersError}</p>}
        {!layersLoading && !layersError && layers.length === 0 && <Muted>No reportable layers are turned on. Turn on the layers you want in the Layers tab, then click Refresh.</Muted>}
        {!layersLoading && layers.length > 0 && (
          <div className="max-h-48 overflow-y-auto border border-base-300 rounded p-1">
            {layers.map((l) => (
              <label key={l.qualified_name} className="flex items-center gap-2 text-xs py-0.5 cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox checkbox-xs"
                  checked={form.selectedLayers.includes(l.qualified_name)}
                  onChange={() => {
                    const sel = form.selectedLayers;
                    setSelectedLayers(sel.includes(l.qualified_name) ? sel.filter((n) => n !== l.qualified_name) : [...sel, l.qualified_name]);
                    setPreview(undefined);
                  }}
                />
                {l.title}
              </label>
            ))}
          </div>
        )}
      </Section>

      {/* SCOPE */}
      <Section>
        <SectionHeader title="Report Scope" helpLink={helpLinks.scope} />
        <div className="grid grid-cols-2 gap-1">
          {SCOPES.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="radio" name="sc-report-scope" className="radio radio-xs" checked={form.scope === s.value} onChange={() => change({ scope: s.value })} />
              {s.label}
            </label>
          ))}
        </div>

        {form.scope === "area" && <AreaDraw areaGeoJSON={form.areaGeoJSON} onAreaDrawn={(g) => change({ areaGeoJSON: g })} />}

        {form.scope === "reference" && (
          <ReferenceScope
            layers={layers}
            layer={form.scopeReferenceLayer}
            predicate={form.scopeReferencePredicate}
            distance={form.scopeReferenceDistanceM}
            filters={form.scopeReferenceFilters}
            filterableFields={referenceLayerFields?.filterable_fields ?? []}
            fieldsLoading={fieldsLoading.reference}
            onLayerChange={(v) => {
              change({ scopeReferenceLayer: v, scopeReferenceFilters: [] });
              loadSideFields("reference", v);
            }}
            onPredicateChange={(p) => change({ scopeReferencePredicate: p })}
            onDistanceChange={(d) => change({ scopeReferenceDistanceM: d })}
            onFiltersChange={(f) => change({ scopeReferenceFilters: f })}
          />
        )}

        {form.scope === "lhrs" && (
          <LhrsRangeScope
            rangeGeoJSON={form.lhrsRangeGeoJSON}
            predicate={form.lhrsRangePredicate}
            distance={form.lhrsRangeDistanceM}
            onPredicateChange={(p) => change({ lhrsRangePredicate: p })}
            onDistanceChange={(d) => change({ lhrsRangeDistanceM: d })}
            onRangeChange={(g) => change({ lhrsRangeGeoJSON: g })}
          />
        )}
      </Section>

      {form.selectedLayers.length > 1 && <Muted>Field selection, filters, attribute/reference-layer grouping and calculations need exactly one selected layer.</Muted>}

      {/* GROUPING */}
      <Section>
        <SectionHeader title="Grouping" helpLink={helpLinks.grouping} />
        {advanced ? (
          <GroupingControl
            // Remount per layer: the store resets the buffer to 0 when the layer changes, and the
            // buffer input keeps its own displayed value
            key={primaryLayer}
            mode={form.groupingMode}
            onModeChange={(m: GroupingMode) => change({ groupingMode: m })}
            bufferM={form.bufferDistanceM}
            onBufferChange={(m) => change({ bufferDistanceM: m })}
            attributeField={form.groupingAttributeField}
            attributeFieldOptions={filterable}
            onAttributeFieldChange={(v) => change({ groupingAttributeField: v })}
            containerLayers={layers}
            containerLayer={form.groupingContainerLayer}
            containerLabelField={form.groupingContainerLabelField}
            containerLabelFieldOptions={containerLayerFields?.filterable_fields ?? []}
            containerPredicate={form.groupingContainerPredicate}
            containerFieldsLoading={fieldsLoading.container}
            onContainerLayerChange={(v) => {
              change({ groupingContainerLayer: v, groupingContainerLabelField: "" });
              loadSideFields("container", v);
            }}
            onContainerLabelFieldChange={(v) => change({ groupingContainerLabelField: v })}
            onContainerPredicateChange={(p) => change({ groupingContainerPredicate: p })}
          />
        ) : (
          <BufferControl key="multi-buffer" valueM={form.bufferDistanceM} onChange={(m) => change({ bufferDistanceM: m })} />
        )}
      </Section>

      {/* FILTERS / CALCULATIONS / OUTPUT FIELDS */}
      {showFieldsFilters && (
        <Section>
          <SectionHeader title="Filters" helpLink={helpLinks.filters} />
          {fieldsLoading.primary ? (
            <LoadingRow label="Loading layer fields..." />
          ) : (
            <>
              <FilterBuilder filters={form.filters} fields={filterable} onChange={(f) => change({ filters: f })} />
              <span className="font-bold text-xs block pt-1">Calculations</span>
              <AggregateBuilder aggregates={form.aggregates} fields={filterable} onChange={(a) => update({ aggregates: a })} />
              <span className="font-bold text-xs block pt-1">Output Fields</span>
              <FieldPicker fields={layerFields?.output_fields ?? []} selected={form.outputFields} onChange={(s) => update({ outputFields: s })} />
            </>
          )}
        </Section>
      )}

      {/* OUTPUT */}
      <Section>
        <SectionHeader title="Included in report" helpLink={helpLinks.output} />
        <OutputToggles
          includeRaw={form.outputIncludeRaw}
          includeGroupedDetail={form.outputIncludeGroupedDetail}
          includeSummarySheet={form.outputIncludeSummarySheet}
          includeLhrs={form.outputIncludeLhrs}
          grouped={grouped}
          hasAggregates={advanced && form.aggregates.length > 0}
          lhrsAvailable={!isProximityActive(form)}
          onChange={update}
        />
        <label className={`flex items-start gap-2 text-xs ${isProximityActive(form) ? "cursor-pointer" : "opacity-60"}`}>
          <input type="checkbox" className="checkbox checkbox-xs mt-0.5" disabled={!isProximityActive(form)} checked={form.includeThumbnails} onChange={(e) => update({ includeThumbnails: e.target.checked })} />
          Include a map thumbnail for each group (proximity grouping only)
        </label>
      </Section>

      {/* ACTIONS */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-outline" disabled={!canRun(form) || busy} onClick={onPreview}>
            {previewLoading ? "Previewing..." : "Preview"}
          </button>
          {advanced && (
            <button type="button" className="btn btn-sm btn-outline" disabled={!canViewTable(form) || busy} onClick={onViewTable} title={form.groupingMode === "proximity" ? "Not available with proximity grouping" : undefined}>
              View Table
            </button>
          )}
        </div>

        <span className="font-bold text-xs block">Export</span>
        <div className="flex flex-wrap gap-2 items-center">
          <select className="select select-bordered select-sm" value={exportFormat} disabled={busy} onChange={(e) => setExportFormat(e.target.value as ExportFormat)} aria-label="Export format">
            <option value="xlsx">Excel (.xlsx)</option>
            <option value="gpkg" disabled={!gdalAvailable}>
              GeoPackage (.gpkg){gdalAvailable ? "" : " - unavailable"}
            </option>
            <option value="kml" disabled={!gdalAvailable}>
              KML (.kml){gdalAvailable ? "" : " - unavailable"}
            </option>
            <option value="geojson" disabled={!gdalAvailable}>
              GeoJSON (.zip){gdalAvailable ? "" : " - unavailable"}
            </option>
          </select>
          <button type="button" className="btn btn-sm btn-primary" disabled={!canRun(form) || busy} onClick={onGenerate}>
            {generating ? "Generating..." : "Generate Report"}
          </button>
          {generating && (
            <button type="button" className="btn btn-sm btn-error btn-outline" onClick={onCancel} title="Stop generating this report - may take a moment to actually stop.">
              Cancel
            </button>
          )}
        </div>
        {!busy && reason && <Muted>{reason}</Muted>}
        {!busy && exportFormat !== "xlsx" && grouped && <Muted>GeoPackage/KML/GeoJSON exports are flat feature files - grouping and summaries are Excel-only and will be ignored.</Muted>}
      </div>

      {/* FILTER MAP */}
      <Section>
        <SectionHeader title="Filter Map" helpLink={helpLinks.filterMap} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-sm btn-outline" disabled={!canFilterMap(form) || busy || mapFilterLoading} onClick={onFilterMap} title="Show only matching features on the map and zoom to them - doesn't change the layer or affect other users.">
            {mapFilterLoading ? "Filtering Map..." : "Filter Map"}
          </button>
          <button type="button" className="btn btn-sm btn-outline" disabled={!mapFilterActive || mapFilterLoading} onClick={clearMapFilter} title="Restore the map to its normal, unfiltered state.">
            Clear Map Filter
          </button>
          {mapFilterLoading && (
            <button type="button" className="btn btn-sm btn-error btn-outline" onClick={() => mapFilterAbort.current?.abort()} title="Stop this Filter Map request.">
              Cancel
            </button>
          )}
        </div>
        {!canFilterMap(form) && !mapFilterActive && <Muted>Set a Map Area, Reference Layer or LHRS Range scope, or a filter, to enable Filter Map.</Muted>}
        {saveFilterName === null ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm btn-outline" disabled={!canSaveFilter(form)} onClick={() => setSaveFilterName("")} title="Save the current scope/filter to the selected layer, as a quick toggle in the Layers tab.">
              Save Map Filter to Layer
            </button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setSavedFiltersOpen(true)} title="Browse every filter saved to any layer.">
              View Saved Filters
            </button>
          </div>
        ) : (
          <form
            className="flex flex-wrap gap-2 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              onSaveFilter();
            }}
          >
            <input autoFocus type="text" className="input input-bordered input-sm flex-1 min-w-0" placeholder="Name this filter" aria-label="Filter name" value={saveFilterName} onChange={(e) => setSaveFilterName(e.target.value)} />
            <button type="submit" className="btn btn-sm btn-primary" disabled={!saveFilterName.trim()}>
              Save
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSaveFilterName(null)}>
              Cancel
            </button>
          </form>
        )}
      </Section>

      {generating && <ProgressBar {...job} />}
      <SummaryPreview preview={preview} layerTitle={layerTitle} />

      <SavedFiltersModal open={savedFiltersOpen} onClose={() => setSavedFiltersOpen(false)} layerTitle={layerTitle} onLoad={onLoadSavedFilter} />
      <ReportTableModal open={table.open} loading={table.loading} error={table.error} result={table.result} onClose={() => setTable({ open: false, loading: false })} onGenerate={onGenerate} />
    </>,
  );
}
