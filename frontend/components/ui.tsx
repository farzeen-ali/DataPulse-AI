"use client";

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

/** Shared, minimal design-system primitives. */

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "relative rounded-2xl border border-line bg-card shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  icon,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-card-2 text-fg-2">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-tight text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-xs text-fg-3">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}

type Tone = "neutral" | "accent" | "good" | "warn" | "bad";

const toneClasses: Record<Tone, string> = {
  neutral: "border-line-strong bg-white/[0.03] text-fg-2",
  accent: "border-accent/25 bg-accent-soft text-[#9fc2ff]",
  good: "border-good/25 bg-good/10 text-[#7fe0aa]",
  warn: "border-warn/25 bg-warn/10 text-[#f6cf7f]",
  bad: "border-bad/25 bg-bad/10 text-[#f7a3a3]",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
  title,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClasses[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ComponentProps<"button"> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "grid size-8 place-items-center rounded-lg border border-transparent text-fg-3 transition-colors",
        "hover:border-line hover:bg-white/[0.04] hover:text-fg disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors",
              active ? "bg-raised text-fg shadow-sm" : "text-fg-3 hover:text-fg-2",
            )}
          >
            {o.icon}
            <span className={o.icon ? "sr-only sm:not-sr-only" : undefined}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      aria-hidden
      style={style}
      className={cn(
        "animate-shimmer rounded-md bg-[linear-gradient(90deg,rgb(255_255_255/0.03)_0%,rgb(255_255_255/0.07)_50%,rgb(255_255_255/0.03)_100%)] bg-[length:800px_100%]",
        className,
      )}
    />
  );
}

export function StatusDot({ tone }: { tone: "good" | "warn" | "bad" | "idle" }) {
  const color = {
    good: "bg-good",
    warn: "bg-warn",
    bad: "bg-bad",
    idle: "bg-fg-3",
  }[tone];
  return (
    <span className="relative flex size-2">
      {tone === "good" && <span className={cn("absolute inset-0 rounded-full opacity-60 animate-pulse-dot", color)} />}
      <span className={cn("relative size-2 rounded-full", color)} />
    </span>
  );
}
