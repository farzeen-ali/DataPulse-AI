"use client";

import { ChartArea, ChartColumn, ChartBar, ChartLine, ChartPie } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell as PieCell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatAxis, formatCell, SERIES_COLORS } from "@/lib/format";
import type { ChartConfig, ChartType, Row } from "@/lib/types";
import { Card, CardHeader, Segmented } from "./ui";

const TYPE_META: Record<ChartType, { label: string; icon: React.ReactNode }> = {
  bar: { label: "Columns", icon: <ChartColumn className="size-3.5" /> },
  "horizontal-bar": { label: "Bars", icon: <ChartBar className="size-3.5" /> },
  line: { label: "Line", icon: <ChartLine className="size-3.5" /> },
  area: { label: "Area", icon: <ChartArea className="size-3.5" /> },
  pie: { label: "Donut", icon: <ChartPie className="size-3.5" /> },
};

const AXIS = { stroke: "var(--color-fg-3)", fontSize: 11, tickLine: false, axisLine: false } as const;
const GRID = "rgb(148 170 210 / 0.08)";

interface TooltipPayload {
  name?: string;
  value?: number;
  color?: string;
  dataKey?: string;
  payload?: Row;
}

function ChartTooltip({
  active,
  payload,
  label,
  config,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  config: ChartConfig;
}) {
  if (!active || !payload?.length) return null;
  const heading = config.type === "pie" ? payload[0]?.payload?.[config.xKey] : label;
  return (
    <div className="min-w-40 rounded-xl border border-line-strong bg-raised/95 px-3 py-2.5 shadow-2xl backdrop-blur">
      <p className="mb-1.5 text-xs font-medium text-fg-2">{formatCell(heading ?? null, config.xFormat)}</p>
      {payload.map((p) => {
        const s = config.series.find((x) => x.key === p.dataKey) ?? config.series[0];
        return (
          <div key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4 text-xs">
            <span className="flex items-center gap-2 text-fg-2">
              <span className="size-2 rounded-full" style={{ background: p.color ?? p.payload?.fill?.toString() }} />
              {s.label}
            </span>
            <span className="font-mono font-medium tabular-nums text-fg">{formatCell(p.value ?? null, s.format)}</span>
          </div>
        );
      })}
    </div>
  );
}

export function ResultChart({ config, rows }: { config: ChartConfig; rows: Row[] }) {
  const options = useMemo(
    () => [...new Set<ChartType>([config.type, ...config.alternatives])],
    [config.type, config.alternatives],
  );
  const [type, setType] = useState<ChartType>(config.type);
  const multi = config.series.length > 1;
  const primary = config.series[0];

  const data = useMemo(() => rows.map((r) => ({ ...r })), [rows]);
  const tooltip = <Tooltip cursor={{ fill: "rgb(148 170 210 / 0.06)", stroke: "rgb(148 170 210 / 0.25)" }} content={<ChartTooltip config={{ ...config, type }} />} />;
  const yTick = (v: number) => formatAxis(v, primary.format);
  const xTick = (v: string | number) => formatAxis(v, config.xFormat);

  const height = type === "horizontal-bar" ? Math.min(Math.max(rows.length * 34 + 40, 220), 520) : 300;

  return (
    <Card>
      <CardHeader
        icon={TYPE_META[type].icon}
        title={config.title}
        subtitle={`${rows.length} data points · hover for exact values`}
        actions={
          options.length > 1 ? (
            <Segmented
              label="Chart type"
              value={type}
              onChange={setType}
              options={options.map((o) => ({ value: o, label: TYPE_META[o].label, icon: TYPE_META[o].icon }))}
            />
          ) : undefined
        }
      />

      {multi && (
        <ul className="flex flex-wrap gap-4 px-5 pb-1 text-xs text-fg-2" aria-label="Legend">
          {config.series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="h-0.5 w-4 rounded-full" style={{ background: SERIES_COLORS[i] }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}

      <div className="px-2 pb-4 sm:px-4" style={{ height }} role="img" aria-label={`${TYPE_META[type].label} chart: ${config.title}. Exact values are in the data table.`}>
        <ResponsiveContainer width="100%" height="100%">
          {type === "pie" ? (
            <PieChart>
              {tooltip}
              <Pie
                data={data}
                dataKey={primary.key}
                nameKey={config.xKey}
                innerRadius="58%"
                outerRadius="82%"
                paddingAngle={1.5}
                stroke="var(--color-card)"
                strokeWidth={2}
                label={(p: { name?: string; percent?: number }) =>
                  `${formatAxis(p.name ?? "", "text")} ${Math.round((p.percent ?? 0) * 100)}%`
                }
                labelLine={false}
                fontSize={11}
                isAnimationActive
              >
                {data.map((_, i) => (
                  <PieCell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : type === "horizontal-bar" ? (
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }} barCategoryGap={6}>
              <CartesianGrid horizontal={false} stroke={GRID} />
              <XAxis type="number" tickFormatter={yTick} {...AXIS} />
              <YAxis type="category" dataKey={config.xKey} tickFormatter={xTick} width={120} {...AXIS} />
              {tooltip}
              {config.series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES_COLORS[i]} radius={[0, 4, 4, 0]} maxBarSize={18} />
              ))}
            </BarChart>
          ) : type === "bar" ? (
            <BarChart data={data} margin={{ left: 4, right: 12, top: 12, bottom: 4 }} barCategoryGap="28%">
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey={config.xKey} tickFormatter={xTick} interval="preserveStartEnd" minTickGap={12} {...AXIS} />
              <YAxis tickFormatter={yTick} width={64} {...AXIS} />
              {tooltip}
              {config.series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES_COLORS[i]} radius={[4, 4, 0, 0]} maxBarSize={44} />
              ))}
            </BarChart>
          ) : type === "line" ? (
            <LineChart data={data} margin={{ left: 4, right: 16, top: 12, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey={config.xKey} tickFormatter={xTick} minTickGap={20} {...AXIS} />
              <YAxis tickFormatter={yTick} width={64} {...AXIS} />
              {tooltip}
              {config.series.map((s, i) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stroke={SERIES_COLORS[i]}
                  strokeWidth={2}
                  dot={{ r: 3, strokeWidth: 2, stroke: "var(--color-card)", fill: SERIES_COLORS[i] }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-card)" }}
                  type="monotone"
                />
              ))}
            </LineChart>
          ) : (
            <AreaChart data={data} margin={{ left: 4, right: 16, top: 12, bottom: 4 }}>
              <defs>
                {config.series.map((s, i) => (
                  <linearGradient key={s.key} id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES_COLORS[i]} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={SERIES_COLORS[i]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey={config.xKey} tickFormatter={xTick} minTickGap={20} {...AXIS} />
              <YAxis tickFormatter={yTick} width={64} {...AXIS} />
              {tooltip}
              {config.series.map((s, i) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stroke={SERIES_COLORS[i]}
                  strokeWidth={2}
                  fill={`url(#area-${s.key})`}
                  type="monotone"
                  dot={{ r: 3, strokeWidth: 2, stroke: "var(--color-card)", fill: SERIES_COLORS[i] }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-card)" }}
                />
              ))}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
