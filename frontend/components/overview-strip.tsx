"use client";

import { motion } from "framer-motion";
import { DollarSign, Package, ShoppingCart, TrendingDown, TrendingUp, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { cn, formatCurrency, formatInt, formatMonth } from "@/lib/format";
import type { OverviewResponse } from "@/lib/types";
import { Skeleton } from "./ui";

export function OverviewStrip({ data, error }: { data: OverviewResponse | null; error: string | null }) {
  if (error) {
    return (
      <div className="rounded-2xl border border-dashed border-line-strong bg-card/50 px-5 py-4 text-sm text-fg-3">
        Workspace metrics unavailable — {error}
      </div>
    );
  }

  const tiles: Array<{ label: string; icon: ReactNode; value?: string; foot?: ReactNode; spark?: boolean }> = data
    ? [
        {
          label: "Total revenue",
          icon: <DollarSign className="size-4" />,
          value: formatCurrency(data.revenue.total),
          spark: true,
          foot: <Delta pct={data.revenue.changePct} />,
        },
        {
          label: "Orders",
          icon: <ShoppingCart className="size-4" />,
          value: formatInt(data.orders.total),
          foot: (
            <span className="text-fg-3">
              <span className="text-good">{data.orders.completed} completed</span> · {data.orders.pending} pending ·{" "}
              {data.orders.cancelled} cancelled
            </span>
          ),
        },
        {
          label: "Customers",
          icon: <Users className="size-4" />,
          value: formatInt(data.customers),
          foot: <span className="text-fg-3">{data.products} products in catalog</span>,
        },
        {
          label: "Avg. order value",
          icon: <Package className="size-4" />,
          value: formatCurrency(data.averageOrderValue),
          foot: <span className="text-fg-3">completed orders only</span>,
        },
      ]
    : Array.from({ length: 4 }, () => ({ label: "", icon: null }));

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 * i, duration: 0.35, ease: "easeOut" }}
          className="group relative overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-card"
        >
          {data ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-fg-3">{t.label}</p>
                <span className="grid size-7 place-items-center rounded-lg bg-white/[0.03] text-fg-3">{t.icon}</span>
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-fg">{t.value}</p>
              <div className="mt-1.5 truncate text-xs">{t.foot}</div>
              {t.spark && data.monthly.length > 1 && <Sparkline data={data.monthly} />}
            </>
          ) : (
            <div className="space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
              <Skeleton className="h-3 w-40" />
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-fg-3">completed orders only</span>;
  const up = pct >= 0;
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("inline-flex items-center gap-1 font-medium", up ? "text-good" : "text-bad")}>
        {up ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
        {up ? "+" : ""}
        {pct}%
      </span>
      <span className="truncate text-fg-3">this month vs last</span>
    </span>
  );
}

function Sparkline({ data }: { data: OverviewResponse["monthly"] }) {
  const first = data[0];
  const last = data[data.length - 1];
  return (
    <div
      className="pointer-events-none absolute right-3 bottom-9 h-10 w-28 opacity-90"
      role="img"
      aria-label={`Monthly revenue from ${formatMonth(first.month)} (${formatCurrency(first.revenue)}) to ${formatMonth(last.month)} (${formatCurrency(last.revenue)})`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, bottom: 2, left: 0, right: 0 }}>
          <defs>
            <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-series-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-series-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            dataKey="revenue"
            type="monotone"
            stroke="var(--color-series-1)"
            strokeWidth={2}
            fill="url(#spark)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
