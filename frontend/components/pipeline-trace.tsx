"use client";

import { motion } from "framer-motion";
import {
  BrainCircuit,
  Check,
  CircleDashed,
  Database,
  Layers,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn, formatMs } from "@/lib/format";
import type { PipelineStep, PipelineStepId } from "@/lib/types";
import { Card, CardHeader } from "./ui";

const STEPS: Array<{ id: PipelineStepId; label: string; hint: string; icon: ReactNode }> = [
  { id: "guard", label: "Prompt security", hint: "Injection & intent screening", icon: <ShieldCheck className="size-3.5" /> },
  { id: "intent", label: "Intent analysis", hint: "Ranking, trend, comparison…", icon: <ScanSearch className="size-3.5" /> },
  { id: "context", label: "Schema context", hint: "Only relevant tables & rules", icon: <Layers className="size-3.5" /> },
  { id: "generation", label: "SQL generation", hint: "Gemini 2.5 Flash", icon: <BrainCircuit className="size-3.5" /> },
  { id: "validation", label: "Security validation", hint: "PostgreSQL AST allowlist", icon: <ShieldCheck className="size-3.5" /> },
  { id: "execution", label: "Database execution", hint: "Read-only, least-privilege", icon: <Database className="size-3.5" /> },
  { id: "summary", label: "Business summary", hint: "Numbers verified against rows", icon: <Sparkles className="size-3.5" /> },
];

export type TraceMode = "idle" | "running" | "done" | "failed";

export function PipelineTrace({
  mode,
  steps,
  totalMs,
  activeIndex = 0,
  failedAt,
}: {
  mode: TraceMode;
  steps?: PipelineStep[];
  totalMs?: number;
  /** While running: which step the indeterminate highlight sits on. */
  activeIndex?: number;
  /** For errors: the stage that stopped the request (earlier stages passed). */
  failedAt?: PipelineStepId;
}) {
  const failedIndex = failedAt ? STEPS.findIndex((s) => s.id === failedAt) : -1;
  const byId = new Map(steps?.map((s) => [s.id, s]));

  return (
    <Card>
      <CardHeader
        icon={<Workflow className="size-4" />}
        title="SQL agent pipeline"
        subtitle={
          mode === "running"
            ? "Processing your question…"
            : mode === "failed"
              ? "Stopped safely — nothing unsafe was executed"
              : mode === "done" && totalMs !== undefined
                ? `Completed in ${formatMs(totalMs)}`
              : "Every question passes these stages"
        }
      />
      <ol className="relative px-5 pb-4">
        {STEPS.map((s, i) => {
          const real = byId.get(s.id);
          const status: "pending" | "running" | "done" | "failed" | "skipped" =
            mode === "running"
              ? i === activeIndex
                ? "running"
                : "pending"
              : mode === "done"
                ? (real?.status ?? "skipped")
                : mode === "failed"
                  ? i < failedIndex
                    ? "done"
                    : i === failedIndex
                      ? "failed"
                      : "skipped"
                  : "pending";
          const last = i === STEPS.length - 1;

          return (
            <li key={s.id} className="relative flex gap-3 pb-3 last:pb-0">
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-7 left-[13px] h-[calc(100%-22px)] w-px",
                    status === "done" ? "bg-good/30" : "bg-line-strong",
                  )}
                />
              )}
              <span
                className={cn(
                  "relative z-10 grid size-7 shrink-0 place-items-center rounded-full border transition-colors",
                  status === "done" && "border-good/30 bg-good/10 text-good",
                  status === "failed" && "border-bad/40 bg-bad/10 text-bad",
                  status === "running" && "border-accent/50 bg-accent-soft text-accent",
                  (status === "pending" || status === "skipped") && "border-line-strong bg-card-2 text-fg-3",
                )}
              >
                {status === "done" ? (
                  <Check className="size-3.5" />
                ) : status === "failed" ? (
                  <X className="size-3.5" />
                ) : status === "skipped" ? (
                  <CircleDashed className="size-3.5" />
                ) : (
                  s.icon
                )}
                {status === "running" && (
                  <motion.span
                    aria-hidden
                    className="absolute inset-0 rounded-full border border-accent/60"
                    initial={{ scale: 1, opacity: 0.8 }}
                    animate={{ scale: 1.5, opacity: 0 }}
                    transition={{ duration: 1.2, repeat: Infinity }}
                  />
                )}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p
                    className={cn(
                      "truncate text-[13px] font-medium",
                      status === "pending" || status === "skipped" ? "text-fg-2" : "text-fg",
                    )}
                  >
                    {s.label}
                  </p>
                  {real && mode === "done" && real.status !== "skipped" && (
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-3">{formatMs(real.durationMs)}</span>
                  )}
                </div>
                <p className={cn("truncate text-xs", status === "failed" ? "text-bad" : "text-fg-3")}>
                  {mode === "done" && real?.detail
                    ? real.detail
                    : status === "running"
                      ? "In progress…"
                      : status === "failed" && mode === "failed"
                        ? "Stopped here"
                        : status === "skipped" && (mode === "done" || mode === "failed")
                          ? "Not reached"
                        : s.hint}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
