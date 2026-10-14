"use client";

import { Check, Copy, FileCode2, Maximize2, Minimize2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/format";
import { Badge, Card, CardHeader, IconButton } from "./ui";

const KEYWORDS = new Set(
  (
    "select from where group by order having limit offset join left right full inner outer cross on as and or not in is null " +
    "between like ilike case when then else end with distinct asc desc nulls first last union all intersect except exists any " +
    "filter over partition rows range preceding following current row interval true false cast using lateral fetch only"
  ).split(" "),
);
const FUNCTIONS = new Set(
  (
    "count sum avg min max round coalesce nullif date_trunc extract date_part to_char now lag lead rank dense_rank row_number " +
    "lower upper abs ceil floor greatest least string_agg percentile_cont ntile first_value last_value age trim concat length"
  ).split(" "),
);

type TokenKind = "kw" | "fn" | "str" | "num" | "cmt" | "op" | "id" | "ws";
const TOKEN_RE =
  /(--[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|("(?:[^"]|"")*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)|(\s+)|([^\sA-Za-z0-9_'"]+)/g;

function tokenize(sql: string): Array<{ text: string; kind: TokenKind }> {
  const out: Array<{ text: string; kind: TokenKind }> = [];
  for (const m of sql.matchAll(TOKEN_RE)) {
    const [text, cmt, str, quoted, num, word, ws] = m;
    let kind: TokenKind = "op";
    if (cmt) kind = "cmt";
    else if (str) kind = "str";
    else if (quoted) kind = "id";
    else if (num) kind = "num";
    else if (ws) kind = "ws";
    else if (word) {
      const lower = word.toLowerCase();
      kind = KEYWORDS.has(lower) ? "kw" : FUNCTIONS.has(lower) ? "fn" : "id";
    }
    out.push({ text, kind });
  }
  return out;
}

/** Light formatting: break before major clauses so long one-line SQL is readable. */
function prettify(sql: string): string {
  if (sql.includes("\n")) return sql.trim();
  return sql
    .replace(/\s+(FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|LEFT JOIN|RIGHT JOIN|FULL JOIN|INNER JOIN|JOIN|UNION ALL|UNION)\b/gi, "\n$1")
    .trim();
}

const kindClass: Record<TokenKind, string> = {
  kw: "text-[#7fb0ff] font-medium",
  fn: "text-[#c5a3ff]",
  str: "text-[#8fe3b0]",
  num: "text-[#f7c27b]",
  cmt: "text-fg-3 italic",
  op: "text-fg-3",
  id: "text-fg",
  ws: "",
};

export function SqlCode({ sql, className }: { sql: string; className?: string }) {
  const lines = useMemo(() => {
    const tokens = tokenize(prettify(sql));
    const result: Array<Array<{ text: string; kind: TokenKind }>> = [[]];
    for (const t of tokens) {
      const parts = t.text.split("\n");
      parts.forEach((p, i) => {
        if (i > 0) result.push([]);
        if (p) result[result.length - 1].push({ text: p, kind: t.kind });
      });
    }
    return result;
  }, [sql]);

  return (
    <pre className={cn("overflow-x-auto font-mono text-[12.5px] leading-6", className)}>
      <code>
        {lines.map((line, i) => (
          <span key={i} className="flex">
            <span aria-hidden className="mr-4 w-6 shrink-0 select-none text-right text-fg-3/50">
              {i + 1}
            </span>
            <span className="whitespace-pre">
              {line.map((t, j) => (
                <span key={j} className={kindClass[t.kind]}>
                  {t.text}
                </span>
              ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}

export function SqlViewer({
  sql,
  blocked,
  limitInjected,
  attempts,
}: {
  sql: string;
  blocked?: boolean;
  limitInjected?: boolean;
  attempts?: number;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — ignore */
    }
  }

  return (
    <Card>
      <CardHeader
        icon={<FileCode2 className="size-4" />}
        title="Generated SQL"
        subtitle={blocked ? "Blocked — never sent to the database" : "Validated PostgreSQL · read-only"}
        actions={
          <>
            <IconButton label={expanded ? "Collapse SQL" : "Expand SQL"} onClick={() => setExpanded((e) => !e)}>
              {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </IconButton>
            <IconButton label={copied ? "Copied" : "Copy SQL"} onClick={copy}>
              {copied ? <Check className="size-4 text-good" /> : <Copy className="size-4" />}
            </IconButton>
          </>
        }
      />
      <div className="flex flex-wrap gap-1.5 px-5 pb-3">
        {blocked ? <Badge tone="bad">Not executed</Badge> : <Badge tone="good">AST validated</Badge>}
        {limitInjected && <Badge tone="accent">Row limit injected</Badge>}
        {attempts && attempts > 1 && <Badge tone="warn">Self-corrected · {attempts} attempts</Badge>}
      </div>
      <div
        className={cn(
          "relative mx-3 mb-3 overflow-hidden rounded-xl border border-line bg-surface",
          !expanded && "max-h-72",
        )}
      >
        <SqlCode sql={sql} className={cn("p-4", expanded ? "max-h-[70vh] overflow-y-auto" : "")} />
        {!expanded && (
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent" />
        )}
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? "SQL copied to clipboard" : ""}
      </span>
    </Card>
  );
}
