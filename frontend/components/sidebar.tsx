"use client";

import { Activity, Database, History, LayoutDashboard, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { clearHistory, useHistory } from "@/lib/history";
import { cn } from "@/lib/format";
import type { HealthResponse } from "@/lib/types";
import { StatusDot } from "./ui";

export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative grid size-8 place-items-center overflow-hidden rounded-[10px] bg-gradient-to-br from-accent to-[#1d4fd8] shadow-[0_6px_20px_-6px_rgb(76_141_255/0.8)]">
        <svg viewBox="0 0 24 24" className="size-[18px] text-white" fill="none" aria-hidden>
          <path d="M3 13h3.5l2.5-6 4 11 2.5-7H21" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="leading-tight">
        <p className="text-[15px] font-semibold tracking-tight text-fg">
          DataPulse <span className="text-accent">AI</span>
        </p>
        <p className="text-[11px] text-fg-3">Analytics intelligence</p>
      </div>
    </div>
  );
}

export function Sidebar({
  health,
  onOpenSchema,
  onPick,
  className,
}: {
  health: HealthResponse | null | "error";
  onOpenSchema: () => void;
  onPick: (prompt: string) => void;
  className?: string;
}) {
  const history = useHistory();
  const h = health === "error" ? null : health;

  const services: Array<{ label: string; tone: "good" | "warn" | "bad" | "idle"; value: string }> = [
    {
      label: "API",
      tone: health === "error" ? "bad" : h ? "good" : "idle",
      value: health === "error" ? "Offline" : h ? "Online" : "Checking",
    },
    {
      label: "Database",
      tone: !h ? "idle" : h.services.database === "up" ? "good" : "bad",
      value: !h ? "—" : h.services.database === "up" ? "Connected" : h.services.database === "down" ? "Down" : "Not set",
    },
    {
      label: "Gemini",
      tone: !h ? "idle" : h.services.ai === "configured" ? "good" : "warn",
      value: !h ? "—" : h.services.ai === "configured" ? "Ready" : "No key",
    },
    {
      label: "Read-only role",
      tone: !h ? "idle" : h.security.leastPrivilegeRole ? "good" : "bad",
      value: !h ? "—" : h.security.leastPrivilegeRole ? "Verified" : "Unverified",
    },
  ];

  return (
    <aside className={cn("flex h-full flex-col gap-6 border-r border-line bg-surface/80 px-4 py-5 backdrop-blur-xl", className)}>
      <div className="px-1">
        <Logo />
      </div>

      <nav aria-label="Main" className="space-y-1">
        <p className="px-2 pb-1 text-[11px] font-medium tracking-wider text-fg-3 uppercase">Workspace</p>
        <a
          href="#workspace"
          aria-current="page"
          className="flex items-center gap-2.5 rounded-lg bg-accent-soft px-2.5 py-2 text-sm font-medium text-fg"
        >
          <LayoutDashboard className="size-4 text-accent" /> Analytics workspace
        </a>
        <button
          type="button"
          onClick={onOpenSchema}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-fg-2 transition-colors hover:bg-white/[0.04] hover:text-fg"
        >
          <Database className="size-4" /> Schema explorer
        </button>
      </nav>

      <section className="min-h-0 flex-1 space-y-1 overflow-y-auto" aria-label="Recent questions">
        <div className="flex items-center justify-between px-2 pb-1">
          <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-fg-3 uppercase">
            <History className="size-3" /> Recent
          </p>
          {history.length > 0 && (
            <button type="button" onClick={clearHistory} aria-label="Clear history" className="rounded p-1 text-fg-3 hover:text-fg">
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
        {history.length === 0 && <p className="px-2 text-xs leading-relaxed text-fg-3">Questions you ask appear here.</p>}
        {history.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.prompt)}
            className="group flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-fg-2 transition-colors hover:bg-white/[0.04] hover:text-fg"
          >
            <Sparkles className="mt-0.5 size-3 shrink-0 text-fg-3 group-hover:text-accent" />
            <span className="line-clamp-2">{item.prompt}</span>
          </button>
        ))}
      </section>

      <section aria-label="System status" className="rounded-xl border border-line bg-card p-3">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wider text-fg-3 uppercase">
          <Activity className="size-3" /> System status
        </p>
        <ul className="space-y-1.5">
          {services.map((s) => (
            <li key={s.label} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2 text-fg-2">
                <StatusDot tone={s.tone} />
                {s.label}
              </span>
              <span className="text-fg-3">{s.value}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2.5 text-[11px] text-fg-3">
          <ShieldCheck className="size-3 text-good" /> AST-validated, read-only SQL
        </p>
      </section>
    </aside>
  );
}
