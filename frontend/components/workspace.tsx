"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Database, Layers, Menu, ShieldCheck, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { addHistory } from "@/lib/history";
import type {
  ApiErrorBody,
  HealthResponse,
  OverviewResponse,
  PipelineStepId,
  QueryResponse,
  SchemaResponse,
} from "@/lib/types";
import { ContextCard } from "./context-card";
import { DataTable } from "./data-table";
import { OverviewStrip } from "./overview-strip";
import { PipelineTrace } from "./pipeline-trace";
import { QueryComposer, type ComposerHandle } from "./query-composer";
import { ResultChart } from "./result-chart";
import { ResultKpis } from "./result-kpis";
import { ResultSummary } from "./result-summary";
import { SchemaExplorer } from "./schema-explorer";
import { SecurityPanel } from "./security-panel";
import { Logo, Sidebar } from "./sidebar";
import { SqlViewer } from "./sql-viewer";
import { ClarificationState, EmptyResultState, ErrorState, ResultsSkeleton } from "./states";
import { Badge, Card, IconButton } from "./ui";

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; prompt: string }
  | { kind: "result"; result: QueryResponse }
  | { kind: "error"; prompt: string; error: ApiErrorBody };

/** Which pipeline stage an error code stopped at (for the trace view). */
const FAILED_AT: Record<string, PipelineStepId> = {
  PROMPT_REJECTED: "guard",
  VALIDATION_ERROR: "guard",
  AI_UNAVAILABLE: "generation",
  RETRY_LIMIT_EXCEEDED: "validation",
  SQL_SECURITY_VIOLATION: "validation",
  QUERY_TIMEOUT: "execution",
  QUERY_NOT_AUTHORIZED: "execution",
  QUERY_FAILED: "execution",
  DATABASE_UNAVAILABLE: "execution",
  UNSAFE_DATABASE_ROLE: "execution",
};

export function Workspace() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [health, setHealth] = useState<HealthResponse | null | "error">(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [schema, setSchema] = useState<SchemaResponse | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const composer = useRef<ComposerHandle>(null);
  const inflight = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const loadOverview = useCallback(() => {
    api
      .overview()
      .then((o) => {
        setOverview(o);
        setOverviewError(null);
      })
      .catch((e: unknown) => setOverviewError(e instanceof ApiError ? e.body.message : "unavailable"));
  }, []);

  // Initial data: health, workspace KPIs, schema.
  useEffect(() => {
    let alive = true;
    const pollHealth = () =>
      api
        .health()
        .then((h) => alive && setHealth(h))
        .catch(() => alive && setHealth("error"));
    pollHealth();
    const timer = setInterval(pollHealth, 30_000);
    loadOverview();
    api
      .schema()
      .then((s) => alive && setSchema(s))
      .catch((e: unknown) => alive && setSchemaError(e instanceof ApiError ? e.body.message : "Schema unavailable."));
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [loadOverview]);

  // Indeterminate progress highlight while the request is in flight.
  useEffect(() => {
    if (phase.kind !== "loading") return;
    const timer = setInterval(() => setActiveStep((s) => Math.min(s + 1, 5)), 900);
    return () => clearInterval(timer);
  }, [phase.kind]);

  // "/" focuses the composer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        e.preventDefault();
        composer.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const run = useCallback(
    async (prompt: string) => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      setActiveStep(0);
      setPhase({ kind: "loading", prompt });
      setNavOpen(false);
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

      try {
        const result = await api.query(prompt, controller.signal);
        if (controller.signal.aborted) return;
        setPhase({ kind: "result", result });
        addHistory({ id: result.id, prompt: result.prompt, status: result.status, rowCount: result.rowCount, at: result.executedAt });
      } catch (e) {
        if (controller.signal.aborted) return;
        const error: ApiErrorBody =
          e instanceof ApiError ? e.body : { statusCode: 0, code: "INTERNAL_ERROR", message: "Unexpected error." };
        setPhase({ kind: "error", prompt, error });
      }
    },
    [],
  );

  const pick = useCallback(
    (prompt: string) => {
      composer.current?.setValue(prompt);
      void run(prompt);
    },
    [run],
  );

  const loading = phase.kind === "loading";

  return (
    <div className="relative min-h-dvh">
      <Backdrop />

      {/* Desktop sidebar */}
      <Sidebar
        health={health}
        onOpenSchema={() => setSchemaOpen(true)}
        onPick={pick}
        className="fixed inset-y-0 left-0 z-30 hidden w-[264px] lg:flex"
      />

      {/* Mobile navigation drawer */}
      <AnimatePresence>
        {navOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.div className="absolute inset-0 bg-canvas/70 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setNavOpen(false)} />
            <motion.div className="absolute inset-y-0 left-0 w-[280px]" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: "spring", damping: 30, stiffness: 300 }}>
              <Sidebar health={health} onOpenSchema={() => { setNavOpen(false); setSchemaOpen(true); }} onPick={pick} className="w-full" />
              <IconButton label="Close menu" onClick={() => setNavOpen(false)} className="absolute top-5 right-3">
                <X className="size-4" />
              </IconButton>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="relative lg:pl-[264px]">
        {/* Top bar */}
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/75 backdrop-blur-xl">
          <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <IconButton label="Open menu" onClick={() => setNavOpen(true)} className="lg:hidden">
                <Menu className="size-5" />
              </IconButton>
              <div className="lg:hidden">
                <Logo />
              </div>
              <nav aria-label="Breadcrumb" className="hidden items-center gap-2 text-sm lg:flex">
                <span className="text-fg-3">Workspace</span>
                <span className="text-fg-3/50">/</span>
                <span className="font-medium text-fg">Analytics</span>
              </nav>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="accent" icon={<Sparkles className="size-3" />} className="hidden sm:inline-flex">
                Gemini 2.5 Flash
              </Badge>
              <button
                type="button"
                onClick={() => setSchemaOpen(true)}
                className="inline-flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-white/[0.03] px-3 text-xs font-medium text-fg-2 transition-colors hover:bg-white/[0.06] hover:text-fg"
              >
                <Database className="size-3.5" /> <span className="hidden sm:inline">Schema</span>
              </button>
            </div>
          </div>
        </header>

        <main id="workspace" className="mx-auto max-w-[1400px] space-y-8 px-4 pt-8 pb-16 sm:px-6 lg:px-8">
          {/* Hero */}
          <section className="max-w-3xl">
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <p className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3 py-1 text-xs font-medium text-[#9fc2ff]">
                <span className="size-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
                AI business intelligence · live PostgreSQL
              </p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-balance text-fg sm:text-[42px] sm:leading-[1.1]">
                Ask your business data{" "}
                <span className="bg-gradient-to-r from-[#8fb8ff] via-accent to-cyan bg-clip-text text-transparent">anything.</span>
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-2">
                Plain-English questions become validated, read-only SQL over your Supabase data — with interactive charts and
                executive summaries where every number is checked against the result set.
              </p>
              <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-fg-2">
                <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-good" /> AST-validated SQL</li>
                <li className="flex items-center gap-2"><Database className="size-4 text-accent" /> Least-privilege, read-only role</li>
                <li className="flex items-center gap-2"><Layers className="size-4 text-cyan" /> Vectorless schema retrieval</li>
                <li className="flex items-center gap-2"><BadgeCheck className="size-4 text-warn" /> Grounded summaries</li>
              </ul>
            </motion.div>
          </section>

          <OverviewStrip data={overview} error={overviewError} />

          <section aria-label="Ask a question">
            <QueryComposer ref={composer} loading={loading} onSubmit={(p) => void run(p)} />
          </section>

          {/* Results */}
          <section ref={resultsRef} aria-live="polite" aria-busy={loading} className="scroll-mt-20">
            <AnimatePresence mode="wait">
              <motion.div
                key={phase.kind === "result" ? phase.result.id : phase.kind}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
              >
                {phase.kind !== "idle" && (
                  <p className="mb-3 flex items-center gap-2 text-sm text-fg-3">
                    <Sparkles className="size-4 text-accent" />
                    <span className="truncate">
                      {phase.kind === "loading" ? "Analyzing" : "Results for"}{" "}
                      <span className="text-fg">“{phase.kind === "result" ? phase.result.prompt : phase.prompt}”</span>
                    </span>
                  </p>
                )}

                <div className="grid gap-4 xl:grid-cols-12">
                  <div className="min-w-0 space-y-4 xl:col-span-8">
                    {phase.kind === "idle" && <IdleState />}
                    {phase.kind === "loading" && <ResultsSkeleton />}
                    {phase.kind === "error" && <ErrorState error={phase.error} onRetry={() => void run(phase.prompt)} />}
                    {phase.kind === "result" && <ResultBody result={phase.result} onPick={pick} />}
                  </div>

                  <aside className="min-w-0 space-y-4 xl:col-span-4">
                    <PipelineTrace
                      mode={
                        phase.kind === "loading"
                          ? "running"
                          : phase.kind === "result"
                            ? "done"
                            : phase.kind === "error"
                              ? "failed"
                              : "idle"
                      }
                      steps={phase.kind === "result" ? phase.result.steps : undefined}
                      totalMs={phase.kind === "result" ? phase.result.timings.totalMs : undefined}
                      activeIndex={activeStep}
                      failedAt={phase.kind === "error" ? (FAILED_AT[phase.error.code] ?? "generation") : undefined}
                    />
                    {phase.kind === "result" && phase.result.sql && (
                      <>
                        <SqlViewer
                          sql={phase.result.sql}
                          limitInjected={phase.result.security.limitInjected}
                          attempts={phase.result.attempts.length}
                        />
                        <SecurityPanel
                          checks={phase.result.security.checks}
                          rowLimit={phase.result.security.rowLimit}
                          timeoutMs={phase.result.security.timeoutMs}
                        />
                      </>
                    )}
                    {phase.kind === "result" && <ContextCard result={phase.result} />}
                  </aside>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>
        </main>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-6 text-xs text-fg-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <p>DataPulse AI — secure natural-language analytics.</p>
            <p>Credentials and API keys never leave the server.</p>
          </div>
        </footer>
      </div>

      <SchemaExplorer open={schemaOpen} onClose={() => setSchemaOpen(false)} schema={schema} error={schemaError} />
    </div>
  );
}

function ResultBody({ result, onPick }: { result: QueryResponse; onPick: (p: string) => void }) {
  if (result.status === "needs_clarification" || result.status === "unsupported") {
    return <ClarificationState result={result} onPick={onPick} />;
  }
  return (
    <>
      <ResultSummary result={result} />
      {result.status === "empty" ? (
        <EmptyResultState />
      ) : (
        <>
          <ResultKpis result={result} />
          {result.chart && <ResultChart key={result.id} config={result.chart} rows={result.rows} />}
          <DataTable key={`t-${result.id}`} columns={result.columns} rows={result.rows} truncated={result.truncated} />
        </>
      )}
    </>
  );
}

function IdleState() {
  const features = [
    {
      icon: <Layers className="size-4" />,
      title: "Vectorless retrieval",
      text: "A deterministic intent router selects only the relevant tables, joins and business rules for each question.",
    },
    {
      icon: <ShieldCheck className="size-4" />,
      title: "Safe text-to-SQL",
      text: "Generated SQL is parsed by the real PostgreSQL parser and checked against a strict allowlist before it runs.",
    },
    {
      icon: <BadgeCheck className="size-4" />,
      title: "Grounded insights",
      text: "Summaries are built from compact result context and every figure is verified against the returned rows.",
    },
  ];
  return (
    <Card className="overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(600px_200px_at_20%_0%,rgb(76_141_255/0.10),transparent)]" />
      <div className="relative p-6 sm:p-8">
        <h2 className="text-lg font-semibold tracking-tight text-fg">Your insights will appear here</h2>
        <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-fg-2">
          Pick an example above or type your own question. Press <kbd className="rounded border border-line-strong bg-surface px-1.5 text-xs">/</kbd> to focus the
          input from anywhere.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-surface/60 p-4">
              <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent">{f.icon}</span>
              <h3 className="mt-3 text-sm font-semibold text-fg">{f.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-fg-3">{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

function Backdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute -top-40 left-1/2 h-[520px] w-[1100px] -translate-x-1/3 rounded-full bg-[radial-gradient(closest-side,rgb(47_116_240/0.16),transparent)]" />
      <div className="absolute top-1/3 -right-40 h-[420px] w-[620px] rounded-full bg-[radial-gradient(closest-side,rgb(90_209_230/0.06),transparent)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgb(148_170_210/0.035)_1px,transparent_1px),linear-gradient(90deg,rgb(148_170_210/0.035)_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)]" />
    </div>
  );
}
