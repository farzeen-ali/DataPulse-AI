import type { Cell, ColumnFormat } from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const dec = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function formatCell(value: Cell | undefined, format: ColumnFormat): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    switch (format) {
      case "currency":
        return usd.format(value);
      case "integer":
        return int.format(value);
      case "percent":
        return `${dec.format(value)}%`;
      default:
        return dec.format(value);
    }
  }
  if (format === "month") return formatMonth(value);
  if (format === "date") return formatDate(value);
  if (format === "datetime") return formatDateTime(value);
  return value;
}

/** Short axis label. */
export function formatAxis(value: Cell | undefined, format: ColumnFormat): string {
  if (typeof value === "number") {
    if (format === "currency") return usdCompact.format(value);
    if (format === "percent") return `${compact.format(value)}%`;
    return compact.format(value);
  }
  if (typeof value === "string" && format === "month") {
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? value
      : d.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  if (typeof value === "string" && (format === "date" || format === "datetime")) return formatDate(value);
  const s = String(value ?? "");
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
}

export function formatMonth(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      });
}

export function formatCurrency(n: number, compactForm = false): string {
  return compactForm ? usdCompact.format(n) : usd.format(n);
}

export function formatInt(n: number): string {
  return int.format(n);
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1) return "<1 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const SERIES_COLORS = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
  "var(--color-series-7)",
  "var(--color-series-8)",
];
