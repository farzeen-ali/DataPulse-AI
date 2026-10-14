"use client";

import { motion } from "framer-motion";
import { TrendingDown, TrendingUp } from "lucide-react";
import { cn, formatCell, formatMonth } from "@/lib/format";
import type { QueryResponse } from "@/lib/types";

interface Tile {
  label: string;
  value: string;
  note?: string;
  delta?: number | null;
}

/** KPI tiles derived deterministically from the real result aggregates. */
export function ResultKpis({ result }: { result: QueryResponse }) {
  const tiles: Tile[] = [];
  const agg = result.aggregates[0];
  // "Total Revenue" → "revenue", so labels read "Total revenue", not "Total total revenue".
  const metric = agg ? agg.label.replace(/^(total|sum|avg|average)\s+/i, "").toLowerCase() : "";

  if (result.rowCount === 1 && result.columns.length) {
    const row = result.rows[0];
    for (const c of result.columns.filter((c) => !c.isIdentifier).slice(0, 4)) {
      tiles.push({ label: c.label, value: formatCell(row[c.key], c.format) });
    }
  } else if (agg) {
    if (result.trend) {
      tiles.push({
        label: `Latest · ${formatMonth(result.trend.lastPeriod)}`,
        value: formatCell(result.trend.lastValue, agg.format),
        delta: result.trend.changePct,
        note: `vs ${formatMonth(result.trend.firstPeriod)}`,
      });
    }
    tiles.push({ label: `Total ${metric}`, value: formatCell(agg.sum, agg.format), note: `across ${agg.count} rows` });
    tiles.push({
      label: `Highest ${metric}`,
      value: formatCell(agg.max, agg.format),
      note: agg.maxLabel && !result.trend ? agg.maxLabel : undefined,
    });
    tiles.push({ label: `Average ${metric}`, value: formatCell(agg.avg, agg.format) });
  }

  if (!tiles.length) return null;
  return (
    <div className={cn("grid gap-3", tiles.length >= 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2 lg:grid-cols-3")}>
      {tiles.slice(0, 4).map((t, i) => (
        <motion.div
          key={t.label}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * i, duration: 0.3 }}
          className="rounded-2xl border border-line bg-card px-4 py-3.5 shadow-card"
        >
          <p className="truncate text-xs text-fg-3">{t.label}</p>
          <p className="mt-1 truncate text-xl font-semibold tracking-tight text-fg">{t.value}</p>
          <div className="mt-1 flex items-center gap-1.5 text-xs">
            {t.delta !== undefined && t.delta !== null && (
              <span className={cn("inline-flex items-center gap-1 font-medium", t.delta >= 0 ? "text-good" : "text-bad")}>
                {t.delta >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                {t.delta > 0 ? "+" : ""}
                {t.delta}%
              </span>
            )}
            {t.note && <span className="truncate text-fg-3">{t.note}</span>}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
