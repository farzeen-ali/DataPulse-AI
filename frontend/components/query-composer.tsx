"use client";

import { motion } from "framer-motion";
import { ArrowUp, CalendarRange, ChartLine, CornerDownLeft, ListOrdered, LoaderCircle, PieChart, Sparkles, Trophy } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/format";

export const EXAMPLES: Array<{ prompt: string; kind: string; icon: ReactNode }> = [
  { prompt: "Show the top five customers by spending", kind: "Ranking", icon: <Trophy className="size-3.5" /> },
  { prompt: "Compare monthly revenue", kind: "Trend", icon: <ChartLine className="size-3.5" /> },
  { prompt: "Which product categories generate the most revenue?", kind: "Comparison", icon: <PieChart className="size-3.5" /> },
  { prompt: "Find completed orders from this month", kind: "Filter", icon: <CalendarRange className="size-3.5" /> },
  { prompt: "Which products have the highest number of orders?", kind: "Volume", icon: <ListOrdered className="size-3.5" /> },
];

const MAX = 500;

export interface ComposerHandle {
  focus: () => void;
  setValue: (v: string) => void;
}

export const QueryComposer = forwardRef<
  ComposerHandle,
  { loading: boolean; onSubmit: (prompt: string) => void; compact?: boolean }
>(function QueryComposer({ loading, onSubmit, compact }, ref) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    setValue: (v: string) => setValue(v),
  }));

  const trimmed = value.trim();
  const canSubmit = trimmed.length >= 3 && trimmed.length <= MAX && !loading;

  function submit(prompt = trimmed) {
    if (prompt.length >= 3 && prompt.length <= MAX && !loading) onSubmit(prompt);
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={cn(
          "group relative rounded-2xl border bg-card shadow-card transition-all duration-300",
          "border-line-strong focus-within:border-accent/50 focus-within:shadow-glow",
        )}
      >
        <div aria-hidden className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-br from-accent/[0.08] via-transparent to-cyan/[0.05] opacity-0 transition-opacity group-focus-within:opacity-100" />
        <label htmlFor="prompt" className="sr-only">
          Ask a business question
        </label>
        <div className="relative flex items-start gap-3 px-4 pt-4">
          <Sparkles className="mt-1 size-5 shrink-0 text-accent" aria-hidden />
          <textarea
            id="prompt"
            ref={inputRef}
            value={value}
            maxLength={MAX}
            rows={compact ? 1 : 2}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Ask about revenue, customers, products or orders…"
            className="field-sizing-content max-h-40 min-h-12 w-full resize-none bg-transparent text-[15px] leading-relaxed text-fg placeholder:text-fg-3 focus:outline-none"
            aria-describedby="prompt-help"
          />
        </div>
        <div className="relative flex items-center justify-between gap-3 px-4 pt-1 pb-3">
          <p id="prompt-help" className="hidden items-center gap-1.5 text-[11px] text-fg-3 sm:flex">
            <kbd className="inline-flex h-5 items-center gap-0.5 rounded border border-line-strong bg-surface px-1.5 font-sans">
              <CornerDownLeft className="size-3" /> Enter
            </kbd>
            to run ·
            <kbd className="inline-flex h-5 items-center rounded border border-line-strong bg-surface px-1.5 font-sans">Shift + Enter</kbd>
            new line
          </p>
          <div className="flex items-center gap-3">
            <span className={cn("font-mono text-[11px] tabular-nums", value.length > MAX * 0.9 ? "text-warn" : "text-fg-3")}>
              {value.length}/{MAX}
            </span>
            <button
              type="submit"
              disabled={!canSubmit}
              aria-label={loading ? "Running query" : "Run query"}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-sm font-medium transition-all",
                canSubmit
                  ? "bg-accent text-white shadow-[0_8px_24px_-8px_rgb(76_141_255/0.7)] hover:bg-accent-strong active:scale-[0.97]"
                  : "cursor-not-allowed bg-white/[0.05] text-fg-3",
              )}
            >
              {loading ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
              <span className="hidden sm:inline">{loading ? "Analyzing" : "Analyze"}</span>
            </button>
          </div>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Example questions">
        {EXAMPLES.map((ex, i) => (
          <motion.button
            key={ex.prompt}
            type="button"
            disabled={loading}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.04 }}
            onClick={() => {
              setValue(ex.prompt);
              submit(ex.prompt);
            }}
            className="group/ex inline-flex items-center gap-2 rounded-full border border-line bg-card/70 py-1.5 pr-3 pl-2 text-xs text-fg-2 transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-fg disabled:opacity-50"
          >
            <span className="grid size-5 place-items-center rounded-full bg-white/[0.04] text-fg-3 group-hover/ex:text-accent">
              {ex.icon}
            </span>
            {ex.prompt}
          </motion.button>
        ))}
      </div>
    </div>
  );
});
