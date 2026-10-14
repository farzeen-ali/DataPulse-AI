"use client";

import { BadgeCheck, Clock, Database, Rows3, Sparkles, Timer } from "lucide-react";
import { formatCell, formatMs } from "@/lib/format";
import type { QueryResponse } from "@/lib/types";
import { Badge, Card } from "./ui";

export function ResultSummary({ result }: { result: QueryResponse }) {
  const s = result.summary;
  if (!s) return null;
  return (
    <Card className="overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />
      <div className="p-5 sm:p-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone="accent" icon={<Sparkles className="size-3" />}>
            Executive summary
          </Badge>
          {s.grounded && (
            <Badge
              tone="good"
              icon={<BadgeCheck className="size-3" />}
              title="Every number in this summary was checked against the query results."
            >
              {s.source === "ai" ? `Grounded · ${s.numbersVerified} numbers verified` : "Computed from results"}
            </Badge>
          )}
          {s.fallbackReason === "ungrounded_numbers" && (
            <Badge tone="warn" title="The AI summary contained figures not present in the data, so it was replaced.">
              AI draft rejected: unverified numbers
            </Badge>
          )}
        </div>
        <h2 className="text-xl font-semibold tracking-tight text-balance text-fg sm:text-2xl">{s.headline}</h2>
        <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-fg-2">{s.text}</p>
        {s.highlights.length > 0 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {s.highlights.map((h, i) => (
              <li key={i} className="flex gap-2.5 rounded-xl border border-line bg-surface/60 px-3 py-2.5 text-[13px] text-fg-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                {h}
              </li>
            ))}
          </ul>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-px border-t border-line bg-line text-xs sm:grid-cols-4">
        <Meta icon={<Rows3 className="size-3.5" />} label="Rows" value={`${result.rowCount}${result.truncated ? "+" : ""}`} />
        <Meta icon={<Database className="size-3.5" />} label="DB execution" value={formatMs(result.timings.executionMs)} />
        <Meta icon={<Timer className="size-3.5" />} label="Total time" value={formatMs(result.timings.totalMs)} />
        <Meta
          icon={<Clock className="size-3.5" />}
          label="Executed"
          value={formatCell(result.executedAt, "datetime").replace(/, \d{4}/, "")}
        />
      </dl>
    </Card>
  );
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 bg-card px-5 py-3">
      <span className="text-fg-3">{icon}</span>
      <div className="min-w-0">
        <dt className="text-fg-3">{label}</dt>
        <dd className="truncate font-mono font-medium tabular-nums text-fg">{value}</dd>
      </div>
    </div>
  );
}
