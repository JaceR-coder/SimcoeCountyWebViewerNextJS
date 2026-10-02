"use client";

/**
 * "View Table" - capped, synchronous preview of the rows a generated report would contain
 * (POST /gis_reports/api/table). Ported from the legacy ReportTableModal.jsx (react-table) as a
 * plain searchable/sortable table; the backend caps the row count, so no virtualization is needed.
 */

import React, { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import type { TableResult } from "./api";

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined || a === "") return 1;
  if (b === null || b === undefined || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function DataGrid({ columns, rows }: { columns: string[]; rows: Record<string, unknown>[] }) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ column: string; desc: boolean } | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = q ? rows.filter((r) => columns.some((c) => formatCell(r[c]).toLowerCase().includes(q))) : rows;
    if (sort) {
      out = [...out].sort((x, y) => compare(x[sort.column], y[sort.column]) * (sort.desc ? -1 : 1));
    }
    return out;
  }, [rows, columns, search, sort]);

  const toggleSort = (column: string) => setSort((s) => (s?.column !== column ? { column, desc: false } : s.desc ? null : { column, desc: true }));

  return (
    <div className="space-y-2">
      <input className="input input-bordered input-sm w-full max-w-xs" placeholder={`Search ${rows.length.toLocaleString()} row(s)...`} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search table" />
      <div className="overflow-auto max-h-[60vh] border border-base-300 rounded">
        <table className="table table-xs table-pin-rows">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} className="cursor-pointer select-none whitespace-nowrap bg-base-200" onClick={() => toggleSort(c)} aria-sort={sort?.column === c ? (sort.desc ? "descending" : "ascending") : "none"}>
                  {c}
                  {sort?.column === c ? (sort.desc ? " ▼" : " ▲") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={i} className="hover">
                {columns.map((c) => (
                  <td key={c} className="whitespace-nowrap max-w-[18rem] truncate" title={formatCell(row[c])}>
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-base-content/70">
        Showing {visible.length.toLocaleString()} of {rows.length.toLocaleString()} fetched row(s)
      </div>
    </div>
  );
}

export default function ReportTableModal(props: { open: boolean; onClose: () => void; loading: boolean; error?: string; result?: TableResult; onGenerate: () => void }) {
  const { result } = props;
  return (
    <Modal isOpen={props.open} onClose={props.onClose} className="w-11/12 max-w-6xl">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-lg font-bold">Report Table</h2>
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm btn-primary" onClick={props.onGenerate} disabled={props.loading}>
            Generate Report
          </button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>

      {props.loading && (
        <div className="flex items-center gap-2 text-sm">
          <span className="loading loading-spinner loading-sm" /> Loading...
        </div>
      )}
      {props.error && <div className="alert alert-error text-sm">{props.error}</div>}

      {!props.loading && !props.error && result && (
        <div className="space-y-3">
          {result.truncated && (
            <div className="alert alert-warning text-xs">
              Showing {result.returned_rows.toLocaleString()} of {result.total_features.toLocaleString()} matching feature(s) - generate the report for the complete result.
            </div>
          )}

          {result.aggregate_rows && result.aggregate_rows.length > 0 && result.aggregate_labels && (
            <div className="overflow-auto">
              <table className="table table-xs">
                <thead>
                  <tr>
                    {result.grouped && <th>Group</th>}
                    {result.aggregate_labels.map((l) => (
                      <th key={l}>{l}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.aggregate_rows.map((row, i) => (
                    <tr key={i}>
                      {result.grouped && <td>{formatCell(row.group_label)}</td>}
                      {result.aggregate_labels!.map((l) => (
                        <td key={l}>{formatCell(row[l])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.rows.length === 0 ? (
            <p className="text-sm text-base-content/70">No features match the current scope/filters.</p>
          ) : (
            <DataGrid columns={result.grouped ? ["group_label", ...result.columns] : result.columns} rows={result.rows} />
          )}
        </div>
      )}
    </Modal>
  );
}
