"use client";

import { Layers, Link2, ScrollText, Target } from "lucide-react";
import type { QueryResponse } from "@/lib/types";
import { Badge, Card, CardHeader } from "./ui";

/** Shows what the vectorless retriever selected for this question. */
export function ContextCard({ result }: { result: QueryResponse }) {
  const { intent, context } = result;
  return (
    <Card>
      <CardHeader
        icon={<Layers className="size-4" />}
        title="Retrieved context"
        subtitle="Vectorless schema slicing — no embeddings"
      />
      <div className="space-y-3.5 px-5 pb-4 text-xs">
        <Row icon={<Target className="size-3.5" />} label="Intent">
          <div className="flex flex-wrap gap-1.5">
            {intent.intents.map((i) => (
              <Badge key={i} tone={i === intent.primary ? "accent" : "neutral"}>
                {i.replace("_", " ")}
              </Badge>
            ))}
            {intent.requestedLimit && <Badge>top {intent.requestedLimit}</Badge>}
            {intent.timeGrain && <Badge>by {intent.timeGrain}</Badge>}
          </div>
        </Row>
        <Row icon={<Layers className="size-3.5" />} label="Tables">
          <div className="flex flex-wrap gap-1.5">
            {context.tables.map((t) => (
              <code key={t} className="rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11px] text-fg">
                {t}
              </code>
            ))}
          </div>
        </Row>
        {context.relationships.length > 0 && (
          <Row icon={<Link2 className="size-3.5" />} label="Joins">
            <ul className="space-y-0.5 font-mono text-[11px] text-fg-2">
              {context.relationships.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Row>
        )}
        {context.rules.length > 0 && (
          <Row icon={<ScrollText className="size-3.5" />} label="Rules">
            <p className="leading-relaxed text-fg-2">{context.rules.join(" · ")}</p>
          </Row>
        )}
        {result.explanation && (
          <p className="rounded-lg border border-line bg-surface px-3 py-2 leading-relaxed text-fg-2">
            <span className="font-medium text-fg">Approach: </span>
            {result.explanation}
          </p>
        )}
      </div>
    </Card>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-start gap-2">
      <span className="flex items-center gap-1.5 pt-0.5 text-fg-3">
        {icon}
        {label}
      </span>
      {children}
    </div>
  );
}
