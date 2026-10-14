"use client";

import { CircleCheck, CircleX, Lock, ShieldCheck } from "lucide-react";
import type { SecurityCheck } from "@/lib/types";
import { Badge, Card, CardHeader } from "./ui";

export function SecurityPanel({
  checks,
  blocked,
  rowLimit,
  timeoutMs,
}: {
  checks: SecurityCheck[];
  blocked?: boolean;
  rowLimit?: number;
  timeoutMs?: number;
}) {
  const passed = checks.filter((c) => c.passed).length;
  return (
    <Card>
      <CardHeader
        icon={<ShieldCheck className="size-4" />}
        title="Security validation"
        subtitle={blocked ? "Query blocked before execution" : "Deterministic server-side controls"}
        actions={
          <Badge tone={blocked ? "bad" : "good"}>
            {passed}/{checks.length} passed
          </Badge>
        }
      />
      <ul className="space-y-1 px-3 pb-3">
        {checks.map((c) => (
          <li key={c.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-white/[0.02]">
            {c.passed ? (
              <CircleCheck className="size-4 shrink-0 text-good" aria-label="Passed" />
            ) : (
              <CircleX className="size-4 shrink-0 text-bad" aria-label="Failed" />
            )}
            <span className={c.passed ? "text-fg-2" : "font-medium text-fg"}>{c.label}</span>
          </li>
        ))}
      </ul>
      {(rowLimit || timeoutMs) && !blocked && (
        <div className="mx-3 mb-3 flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-fg-3">
          <Lock className="size-3.5 shrink-0" />
          <span>
            Max {rowLimit} rows · {timeoutMs} ms timeout · no PII columns · read-only role
          </span>
        </div>
      )}
    </Card>
  );
}
