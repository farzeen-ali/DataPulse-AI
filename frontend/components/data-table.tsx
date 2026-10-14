"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Download, Search, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn, formatCell } from "@/lib/format";
import type { ColumnMeta, Row } from "@/lib/types";
import { Badge, Card, CardHeader, IconButton } from "./ui";

const PAGE_SIZES = [10, 25, 50];

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Neutralise spreadsheet formula injection from database text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function DataTable({ columns, rows, truncated }: { columns: ColumnMeta[]; rows: Row[]; truncated: boolean }) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q
      ? rows.filter((r) => columns.some((c) => formatCell(r[c.key], c.format).toLowerCase().includes(q)))
      : rows;
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.key];
        const y = b[sort.key];
        if (x === y) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [rows, columns, query, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = filtered.slice(current * pageSize, current * pageSize + pageSize);

  function toggleSort(key: string) {
    setSort((s) => (s?.key !== key ? { key, dir: "desc" } : s.dir === "desc" ? { key, dir: "asc" } : null));
    setPage(0);
  }

  function exportCsv() {
    const lines = [columns.map((c) => csvEscape(c.name)).join(",")];
    for (const r of filtered) lines.push(columns.map((c) => csvEscape(r[c.key])).join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "datapulse-results.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardHeader
        icon={<Table2 className="size-4" />}
        title="Query results"
        subtitle={`${rows.length} ${rows.length === 1 ? "row" : "rows"} · ${columns.length} columns · real database data`}
        actions={
          <>
            {truncated && <Badge tone="warn">Row limit reached</Badge>}
            <IconButton label="Export CSV" onClick={exportCsv}>
              <Download className="size-4" />
            </IconButton>
          </>
        }
      />

      <div className="flex flex-col gap-2 px-5 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block sm:w-72">
          <span className="sr-only">Filter rows</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-fg-3" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Filter rows…"
            className="h-8 w-full rounded-lg border border-line bg-surface pr-3 pl-8 text-xs text-fg placeholder:text-fg-3 focus:border-accent/50 focus:outline-none"
          />
        </label>
        {query && (
          <p className="text-xs text-fg-3" role="status">
            {filtered.length} matching {filtered.length === 1 ? "row" : "rows"}
          </p>
        )}
      </div>

      <div className="mx-3 overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-max border-collapse text-left text-[13px]">
          <thead className="sticky top-0 bg-card-2">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const numeric = c.kind === "number";
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
                    className={cn("border-b border-line px-3 py-2 font-medium text-fg-2", numeric && "text-right")}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded text-xs tracking-wide uppercase hover:text-fg",
                        numeric && "flex-row-reverse",
                        active && "text-fg",
                      )}
                    >
                      {c.label}
                      {active ? (
                        sort!.dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r, i) => (
              <tr key={i} className="border-b border-line/60 transition-colors last:border-0 hover:bg-white/[0.025]">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "max-w-xs truncate px-3 py-2 text-fg",
                      c.kind === "number" && "text-right font-mono tabular-nums",
                      c.isIdentifier && "text-fg-3",
                    )}
                    title={typeof r[c.key] === "string" ? String(r[c.key]) : undefined}
                  >
                    {c.key === "status" || c.name === "status" ? (
                      <StatusPill value={String(r[c.key] ?? "")} />
                    ) : (
                      formatCell(r[c.key], c.format)
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-fg-3">
                  No rows match “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs text-fg-3">
        <label className="flex items-center gap-2">
          Rows per page
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="h-7 rounded-md border border-line bg-surface px-1.5 text-fg-2 focus:outline-none"
          >
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            {filtered.length === 0 ? 0 : current * pageSize + 1}–{Math.min(filtered.length, (current + 1) * pageSize)} of{" "}
            {filtered.length}
          </span>
          <IconButton label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
            <ChevronLeft className="size-4" />
          </IconButton>
          <IconButton label="Next page" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            <ChevronRight className="size-4" />
          </IconButton>
        </div>
      </footer>
    </Card>
  );
}

function StatusPill({ value }: { value: string }) {
  const tone = value === "completed" ? "good" : value === "pending" ? "warn" : value === "cancelled" ? "bad" : "neutral";
  return <Badge tone={tone}>{value || "—"}</Badge>;
}
