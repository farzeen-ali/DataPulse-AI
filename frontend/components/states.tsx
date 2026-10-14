"use client";

import {
  Ban,
  CircleHelp,
  Clock,
  Inbox,
  RefreshCw,
  ServerCrash,
  ShieldAlert,
  ShieldX,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ApiErrorBody, QueryResponse } from "@/lib/types";
import { SecurityPanel } from "./security-panel";
import { SqlViewer } from "./sql-viewer";
import { Badge, Card, Skeleton } from "./ui";

const ERROR_COPY: Record<string, { title: string; icon: ReactNode; tone: "warn" | "bad" }> = {
  PROMPT_REJECTED: { title: "Request blocked by prompt security", icon: <ShieldAlert className="size-5" />, tone: "warn" },
  SQL_SECURITY_VIOLATION: { title: "Generated SQL blocked before execution", icon: <ShieldX className="size-5" />, tone: "bad" },
  QUERY_NOT_AUTHORIZED: { title: "Database permissions refused the query", icon: <Ban className="size-5" />, tone: "bad" },
  QUERY_TIMEOUT: { title: "Query cancelled by the time limit", icon: <Clock className="size-5" />, tone: "warn" },
  RETRY_LIMIT_EXCEEDED: { title: "Couldn't produce a valid query", icon: <TriangleAlert className="size-5" />, tone: "warn" },
  AI_UNAVAILABLE: { title: "AI service unavailable", icon: <ServerCrash className="size-5" />, tone: "warn" },
  DATABASE_UNAVAILABLE: { title: "Database unavailable", icon: <ServerCrash className="size-5" />, tone: "warn" },
  UNSAFE_DATABASE_ROLE: { title: "Execution disabled: unsafe database role", icon: <ShieldX className="size-5" />, tone: "bad" },
  RATE_LIMITED: { title: "Slow down a little", icon: <Clock className="size-5" />, tone: "warn" },
  NETWORK_ERROR: { title: "Can't reach the API", icon: <WifiOff className="size-5" />, tone: "warn" },
  VALIDATION_ERROR: { title: "Please check your question", icon: <TriangleAlert className="size-5" />, tone: "warn" },
};

const CATEGORY_LABEL: Record<string, string> = {
  prompt_injection: "Prompt injection",
  secret_request: "Secret / instruction extraction",
  data_modification: "Write operation",
  system_access: "System catalog access",
  restricted_data: "Restricted personal data",
  invalid_input: "Invalid input",
};

export function ErrorState({ error, onRetry }: { error: ApiErrorBody; onRetry?: () => void }) {
  const copy = ERROR_COPY[error.code] ?? {
    title: "Something went wrong",
    icon: <TriangleAlert className="size-5" />,
    tone: "bad" as const,
  };
  const d = error.details;
  const retryable = ["AI_UNAVAILABLE", "DATABASE_UNAVAILABLE", "NETWORK_ERROR", "RATE_LIMITED", "INTERNAL_ERROR", "QUERY_TIMEOUT"].includes(error.code);

  return (
    <div className="space-y-4">
      <Card className={copy.tone === "bad" ? "border-bad/25" : "border-warn/25"}>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-xl ${copy.tone === "bad" ? "bg-bad/10 text-bad" : "bg-warn/10 text-warn"}`}
          >
            {copy.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-fg">{copy.title}</h2>
              <Badge tone={copy.tone}>{error.code.replaceAll("_", " ").toLowerCase()}</Badge>
              {d?.category && <Badge>{CATEGORY_LABEL[d.category] ?? d.category}</Badge>}
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{error.message}</p>
            {d?.violations && d.violations.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {d.violations.map((v, i) => (
                  <li key={i} className="flex gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-[13px] text-fg-2">
                    <ShieldX className="mt-0.5 size-3.5 shrink-0 text-bad" />
                    <span>
                      <span className="font-mono text-xs text-fg-3">{v.code}</span> — {v.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {d?.attempts && d.attempts.length > 0 && error.code === "RETRY_LIMIT_EXCEEDED" && (
              <ol className="mt-3 space-y-1.5 text-[13px] text-fg-2">
                {d.attempts.map((a) => (
                  <li key={a.attempt} className="rounded-lg border border-line bg-surface px-3 py-2">
                    <span className="font-medium text-fg">Attempt {a.attempt}</span> · {a.outcome.replaceAll("_", " ")}
                    {a.error && <span className="block text-xs text-fg-3">{a.error}</span>}
                  </li>
                ))}
              </ol>
            )}
            {retryable && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 inline-flex h-8 items-center gap-2 rounded-lg border border-line-strong bg-white/[0.03] px-3 text-xs font-medium text-fg hover:bg-white/[0.06]"
              >
                <RefreshCw className="size-3.5" /> Try again
              </button>
            )}
          </div>
        </div>
      </Card>
      {d?.sql && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SqlViewer sql={d.sql} blocked={error.code === "SQL_SECURITY_VIOLATION"} />
          {d.checks && d.checks.length > 0 && <SecurityPanel checks={d.checks} blocked={error.code === "SQL_SECURITY_VIOLATION"} />}
        </div>
      )}
    </div>
  );
}

export function ClarificationState({ result, onPick }: { result: QueryResponse; onPick: (p: string) => void }) {
  const unsupported = result.status === "unsupported";
  const suggestions = [
    "Show total revenue by category",
    "Compare monthly revenue",
    "Show the top five customers by spending",
  ];
  return (
    <Card className="border-accent/20">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <CircleHelp className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-fg">
            {unsupported ? "This question can't be answered from the available data" : "A little more detail, please"}
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-fg-2">{result.message}</p>
          <p className="mt-2 text-xs text-fg-3">
            DataPulse never guesses: nothing was executed. Available data covers customers, products and orders.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onPick(s)}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-fg-2 hover:border-accent/40 hover:text-fg"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function EmptyResultState() {
  return (
    <Card>
      <div className="flex flex-col items-center px-6 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-2xl border border-line bg-card-2 text-fg-3">
          <Inbox className="size-5" />
        </span>
        <h3 className="mt-4 text-sm font-semibold text-fg">No rows matched</h3>
        <p className="mt-1 max-w-sm text-sm text-fg-3">
          The query ran successfully against the database but returned no data. Try a wider time range or fewer filters.
        </p>
      </div>
    </Card>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading results">
      <Card className="p-6">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="mt-4 h-7 w-3/4" />
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </Card>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-6 w-28" />
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <Skeleton className="h-4 w-44" />
        <div className="mt-6 flex h-56 items-end gap-3">
          {[45, 70, 55, 90, 65, 80, 50, 75].map((h, i) => (
            <Skeleton key={i} className="flex-1 rounded-t-md rounded-b-none" style={{ height: `${h}%` }} />
          ))}
        </div>
      </Card>
    </div>
  );
}
