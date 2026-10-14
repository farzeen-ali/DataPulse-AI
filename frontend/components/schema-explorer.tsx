"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BookOpen, Database, KeyRound, Link2, Lock, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { SchemaResponse } from "@/lib/types";
import { Badge, IconButton, Skeleton } from "./ui";

export function SchemaExplorer({
  open,
  onClose,
  schema,
  error,
}: {
  open: boolean;
  onClose: () => void;
  schema: SchemaResponse | null;
  error: string | null;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-canvas/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="schema-title"
            tabIndex={-1}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col border-l border-line bg-surface shadow-2xl focus:outline-none"
          >
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 id="schema-title" className="flex items-center gap-2 text-base font-semibold text-fg">
                  <Database className="size-4 text-accent" /> Approved schema
                </h2>
                <p className="mt-0.5 text-xs text-fg-3">The only data the AI can see — and the database role can read.</p>
              </div>
              <IconButton label="Close schema explorer" onClick={onClose}>
                <X className="size-4" />
              </IconButton>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              {error && <p className="rounded-xl border border-warn/25 bg-warn/10 p-3 text-sm text-fg-2">{error}</p>}
              {!schema && !error && (
                <div className="space-y-3">
                  {Array.from({ length: 3 }, (_, i) => (
                    <Skeleton key={i} className="h-40 w-full rounded-2xl" />
                  ))}
                </div>
              )}
              {schema && (
                <>
                  {schema.tables.map((t) => (
                    <section key={t.name} className="overflow-hidden rounded-2xl border border-line bg-card">
                      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
                        <div>
                          <h3 className="font-mono text-sm font-semibold text-fg">{t.name}</h3>
                          <p className="mt-0.5 text-xs text-fg-3">{t.description}</p>
                        </div>
                        <Badge>{t.label}</Badge>
                      </header>
                      <table className="w-full text-[13px]">
                        <tbody>
                          {t.columns.map((c) => (
                            <tr key={c.name} className="border-b border-line/60 last:border-0">
                              <td className="w-40 px-4 py-2 align-top">
                                <span className="flex items-center gap-1.5 font-mono text-fg">
                                  {c.primaryKey && <KeyRound className="size-3 text-warn" aria-label="Primary key" />}
                                  {c.references && <Link2 className="size-3 text-accent" aria-label="Foreign key" />}
                                  {c.name}
                                </span>
                              </td>
                              <td className="w-28 px-2 py-2 align-top font-mono text-xs text-[#c5a3ff]">{c.type}</td>
                              <td className="px-4 py-2 align-top text-xs text-fg-3">
                                {c.description}
                                {c.references && (
                                  <span className="block text-accent/80">
                                    → {c.references.table}.{c.references.column}
                                  </span>
                                )}
                                {c.examples.length > 0 && (
                                  <span className="mt-1 flex flex-wrap gap-1">
                                    {c.examples.map((e) => (
                                      <code key={e} className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px] text-fg-2">
                                        {e}
                                      </code>
                                    ))}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                          {t.restrictedColumns.map((c) => (
                            <tr key={c} className="bg-bad/[0.04]">
                              <td className="px-4 py-2 font-mono text-fg-3 line-through decoration-fg-3/50">
                                <span className="flex items-center gap-1.5">
                                  <Lock className="size-3 text-bad" aria-hidden /> {c}
                                </span>
                              </td>
                              <td colSpan={2} className="px-2 py-2 text-xs text-fg-3">
                                Restricted PII — not granted to the analytics role and blocked by the validator.
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  ))}

                  <section>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
                      <Link2 className="size-4 text-accent" /> Relationships
                    </h3>
                    <ul className="space-y-1.5">
                      {schema.relationships.map((r) => (
                        <li key={`${r.from.table}.${r.from.column}`} className="rounded-xl border border-line bg-card px-3 py-2 text-xs text-fg-2">
                          <code className="text-fg">
                            {r.from.table}.{r.from.column} → {r.to.table}.{r.to.column}
                          </code>
                          <span className="block text-fg-3">{r.description}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
                      <BookOpen className="size-4 text-accent" /> Business rules
                    </h3>
                    <ul className="space-y-1.5">
                      {schema.businessRules.map((r) => (
                        <li key={r.id} className="rounded-xl border border-line bg-card px-3 py-2 text-xs leading-relaxed text-fg-2">
                          <span className="font-medium text-fg">{r.title}.</span> {r.rule}
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="rounded-2xl border border-good/20 bg-good/[0.05] p-4">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
                      <ShieldCheck className="size-4 text-good" /> Query policy
                    </h3>
                    <ul className="mt-2 grid gap-1 text-xs text-fg-2 sm:grid-cols-2">
                      <li>Statements: {schema.policy.statementTypes.join(", ")} only</li>
                      <li>Max rows returned: {schema.policy.maxRowLimit}</li>
                      <li>Max joins: {schema.policy.maxJoins}</li>
                      <li>Max subquery depth: {schema.policy.maxSubqueryDepth}</li>
                      <li className="sm:col-span-2">{schema.policy.allowedFunctions.length} allow-listed SQL functions</li>
                    </ul>
                  </section>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
