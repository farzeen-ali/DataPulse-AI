import { Injectable } from '@nestjs/common';
import type { ExecutionResult } from '../execution/query-executor.service';
import { SQL_POLICY } from '../security/sql-policy';

export type ColumnKind = 'number' | 'string' | 'date' | 'boolean';
export type ColumnFormat =
  | 'currency'
  | 'integer'
  | 'decimal'
  | 'percent'
  | 'month'
  | 'date'
  | 'datetime'
  | 'text'
  | 'boolean';

export interface ColumnMeta {
  /** Unique key used in row objects. */
  key: string;
  /** Column name as returned by PostgreSQL. */
  name: string;
  label: string;
  kind: ColumnKind;
  format: ColumnFormat;
  pgType: string;
  /** Identifier columns are hidden from charts and summaries. */
  isIdentifier: boolean;
}

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface NumericAggregate {
  column: string;
  label: string;
  format: ColumnFormat;
  sum: number;
  avg: number;
  min: number;
  max: number;
  count: number;
  /** Label of the row holding the max value (when a label column exists). */
  maxLabel?: string;
  minLabel?: string;
}

export interface Trend {
  column: string;
  firstPeriod: string;
  lastPeriod: string;
  firstValue: number;
  lastValue: number;
  change: number;
  changePct: number | null;
}

export interface Share {
  label: string;
  value: number;
  pct: number;
}

export interface ProcessedResult {
  columns: ColumnMeta[];
  rows: Row[];
  rowCount: number;
  /** True when the row limit was reached — more rows may exist. */
  truncated: boolean;
  aggregates: NumericAggregate[];
  labelColumn?: string;
  timeColumn?: string;
  trend?: Trend;
  shares?: Share[];
}

/** The compact JSON given to the summary model — only what it needs. */
export interface CompactContext {
  rowCount: number;
  truncated: boolean;
  columns: Array<{ name: string; format: ColumnFormat }>;
  rows: Array<Record<string, Cell>>;
  omittedRows: number;
  aggregates: Array<
    Omit<NumericAggregate, 'column' | 'label'> & { column: string }
  >;
  trend?: Trend;
  shares?: Share[];
}

const PG_TYPES: Record<number, { name: string; kind: ColumnKind }> = {
  16: { name: 'bool', kind: 'boolean' },
  20: { name: 'int8', kind: 'number' },
  21: { name: 'int2', kind: 'number' },
  23: { name: 'int4', kind: 'number' },
  700: { name: 'float4', kind: 'number' },
  701: { name: 'float8', kind: 'number' },
  1700: { name: 'numeric', kind: 'number' },
  25: { name: 'text', kind: 'string' },
  1042: { name: 'bpchar', kind: 'string' },
  1043: { name: 'varchar', kind: 'string' },
  19: { name: 'name', kind: 'string' },
  1082: { name: 'date', kind: 'date' },
  1114: { name: 'timestamp', kind: 'date' },
  1184: { name: 'timestamptz', kind: 'date' },
  1186: { name: 'interval', kind: 'string' },
};

const INTEGER_TYPES = new Set(['int2', 'int4', 'int8']);
const CURRENCY_NAME =
  /(revenue|amount|spend|spent|sales|price|value|aov|income|gmv|total)/i;
const COUNT_NAME =
  /(count|number|num_|qty|quantity|orders|customers|users|products|items)/i;
const PERCENT_NAME = /(pct|percent|percentage|share)/i;
const ID_NAME = /^(id|.*_id)$/i;

// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT_CHARS = /[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E]/g;
const MAX_CONTEXT_ROWS = 25;
const MAX_STRING = 80;

@Injectable()
export class ResultProcessorService {
  process(exec: ExecutionResult): ProcessedResult {
    const used = new Map<string, number>();
    const columns: ColumnMeta[] = exec.fields.map((f) => {
      const n = (used.get(f.name) ?? 0) + 1;
      used.set(f.name, n);
      const key = n === 1 ? f.name : `${f.name}_${n}`;
      const t = PG_TYPES[f.dataTypeID] ?? {
        name: `oid:${f.dataTypeID}`,
        kind: 'string',
      };
      return {
        key,
        name: f.name,
        label: this.label(f.name),
        kind: t.kind,
        format: 'text',
        pgType: t.name,
        isIdentifier: ID_NAME.test(f.name),
      };
    });

    const rows: Row[] = exec.rows.map((raw) => {
      const row: Row = {};
      columns.forEach((c, i) => (row[c.key] = this.normalize(raw[i], c)));
      return row;
    });

    for (const c of columns) c.format = this.formatFor(c, rows);

    const numeric = columns.filter(
      (c) => c.kind === 'number' && !c.isIdentifier,
    );
    const labelCol =
      columns.find((c) => c.kind === 'string' && !c.isIdentifier) ??
      columns.find((c) => c.kind === 'date');
    const timeCol = columns.find((c) => c.kind === 'date');

    const aggregates = numeric.map((c) => this.aggregate(c, rows, labelCol));
    const processed: ProcessedResult = {
      columns,
      rows,
      rowCount: rows.length,
      truncated: rows.length >= SQL_POLICY.maxRowLimit,
      aggregates,
      labelColumn: labelCol?.key,
      timeColumn: timeCol?.key,
    };

    if (timeCol && numeric.length && rows.length >= 2) {
      processed.trend = this.trend(timeCol, numeric[0], rows);
    }
    if (
      !timeCol &&
      labelCol &&
      numeric.length &&
      rows.length >= 2 &&
      rows.length <= 25
    ) {
      processed.shares = this.shares(labelCol, numeric[0], rows);
    }
    return processed;
  }

  /**
   * Structured context slicing: only descriptive columns, at most 25 rows,
   * rounded numbers, short sanitized strings, plus precomputed aggregates.
   */
  toCompactContext(result: ProcessedResult): CompactContext {
    const descriptive = result.columns.filter(
      (c) => !c.isIdentifier || result.columns.every((x) => x.isIdentifier),
    );
    const rows = result.rows.slice(0, MAX_CONTEXT_ROWS).map((r) => {
      const out: Record<string, Cell> = {};
      for (const c of descriptive) out[c.name] = this.compactCell(r[c.key]);
      return out;
    });
    return {
      rowCount: result.rowCount,
      truncated: result.truncated,
      columns: descriptive.map((c) => ({ name: c.name, format: c.format })),
      rows,
      omittedRows: Math.max(0, result.rowCount - rows.length),
      aggregates: result.aggregates.map((a) => ({
        column: a.column,
        format: a.format,
        sum: round(a.sum),
        avg: round(a.avg),
        min: round(a.min),
        max: round(a.max),
        count: a.count,
        maxLabel: a.maxLabel,
        minLabel: a.minLabel,
      })),
      ...(result.trend ? { trend: result.trend } : {}),
      ...(result.shares ? { shares: result.shares } : {}),
    };
  }

  // ---------------------------------------------------------------------------

  private normalize(value: unknown, c: ColumnMeta): Cell {
    if (value === null || value === undefined) return null;
    if (c.kind === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) return toText(value);
      return Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : toText(value);
    }
    if (c.kind === 'date') {
      if (c.pgType === 'date') return toText(value).slice(0, 10);
      let iso = toText(value)
        .replace(' ', 'T')
        .replace(/([+-]\d\d)$/, '$1:00');
      // timestamp without time zone: the session runs in UTC, so read it as UTC.
      if (c.pgType === 'timestamp' && !/[zZ]|[+-]\d\d:\d\d$/.test(iso))
        iso += 'Z';
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? toText(value) : d.toISOString();
    }
    if (c.kind === 'boolean') return Boolean(value);
    if (value instanceof Date) return value.toISOString();
    return typeof value === 'object' ? JSON.stringify(value) : toText(value);
  }

  private formatFor(c: ColumnMeta, rows: Row[]): ColumnFormat {
    if (c.kind === 'boolean') return 'boolean';
    if (c.kind === 'string') return 'text';
    if (c.kind === 'date') {
      const values = rows
        .map((r) => r[c.key])
        .filter((v): v is string => typeof v === 'string');
      if (c.pgType === 'date') return 'date';
      if (
        values.length &&
        values.every((v) => /^\d{4}-\d{2}-01T00:00:00\.000Z$/.test(v))
      )
        return 'month';
      if (values.length && values.every((v) => /T00:00:00\.000Z$/.test(v)))
        return 'date';
      return 'datetime';
    }
    if (c.isIdentifier) return 'integer';
    if (PERCENT_NAME.test(c.name)) return 'percent';
    if (
      COUNT_NAME.test(c.name) &&
      !/(revenue|amount|spend|spent|sales|value)/i.test(c.name)
    ) {
      return 'integer';
    }
    if (CURRENCY_NAME.test(c.name)) return 'currency';
    const allInts = rows.every(
      (r) => r[c.key] === null || Number.isInteger(r[c.key]),
    );
    return INTEGER_TYPES.has(c.pgType) || allInts ? 'integer' : 'decimal';
  }

  private aggregate(
    c: ColumnMeta,
    rows: Row[],
    labelCol?: ColumnMeta,
  ): NumericAggregate {
    const vals = rows
      .map((r) => ({
        v: r[c.key],
        label: labelCol ? r[labelCol.key] : undefined,
      }))
      .filter(
        (x): x is { v: number; label: Cell | undefined } =>
          typeof x.v === 'number',
      );
    const sum = vals.reduce((s, x) => s + x.v, 0);
    const maxItem = vals.reduce<(typeof vals)[number] | undefined>(
      (m, x) => (!m || x.v > m.v ? x : m),
      undefined,
    );
    const minItem = vals.reduce<(typeof vals)[number] | undefined>(
      (m, x) => (!m || x.v < m.v ? x : m),
      undefined,
    );
    return {
      column: c.key,
      label: c.label,
      format: c.format,
      sum: round(sum),
      avg: vals.length ? round(sum / vals.length) : 0,
      min: minItem ? minItem.v : 0,
      max: maxItem ? maxItem.v : 0,
      count: vals.length,
      ...(maxItem?.label != null
        ? { maxLabel: displayLabel(maxItem.label, labelCol) }
        : {}),
      ...(minItem?.label != null
        ? { minLabel: displayLabel(minItem.label, labelCol) }
        : {}),
    };
  }

  private trend(
    timeCol: ColumnMeta,
    valueCol: ColumnMeta,
    rows: Row[],
  ): Trend | undefined {
    const points = rows
      .filter(
        (r) =>
          typeof r[timeCol.key] === 'string' &&
          typeof r[valueCol.key] === 'number',
      )
      .map((r) => ({
        t: r[timeCol.key] as string,
        v: r[valueCol.key] as number,
      }))
      .sort((a, b) => a.t.localeCompare(b.t));
    if (points.length < 2) return undefined;
    const first = points[0];
    const last = points[points.length - 1];
    return {
      column: valueCol.name,
      firstPeriod: first.t,
      lastPeriod: last.t,
      firstValue: first.v,
      lastValue: last.v,
      change: round(last.v - first.v),
      changePct:
        first.v !== 0
          ? round(((last.v - first.v) / Math.abs(first.v)) * 100, 1)
          : null,
    };
  }

  private shares(
    labelCol: ColumnMeta,
    valueCol: ColumnMeta,
    rows: Row[],
  ): Share[] | undefined {
    const items = rows
      .filter((r) => typeof r[valueCol.key] === 'number')
      .map((r) => ({
        label: String(r[labelCol.key] ?? '—'),
        value: r[valueCol.key] as number,
      }));
    if (items.some((i) => i.value < 0)) return undefined;
    const total = items.reduce((s, i) => s + i.value, 0);
    if (total <= 0) return undefined;
    return items.map((i) => ({ ...i, pct: round((i.value / total) * 100, 1) }));
  }

  /** Database text is untrusted: shorten it and strip control characters. */
  private compactCell(v: Cell | undefined): Cell {
    if (v === undefined) return null;
    if (typeof v === 'number') return round(v);
    if (typeof v === 'string') {
      const clean = v.replace(UNSAFE_TEXT_CHARS, ' ');
      return clean.length > MAX_STRING
        ? `${clean.slice(0, MAX_STRING)}…`
        : clean;
    }
    return v;
  }

  private label(name: string): string {
    return name
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }
}

/** Human-readable label for a row (dates become "Sep 2026" / "Sep 14, 2026"). */
export function displayLabel(
  value: Cell | undefined,
  col?: ColumnMeta,
): string {
  if (value === null || value === undefined) return '—';
  if (col?.kind === 'date' && typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return col.format === 'month'
        ? d.toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          })
        : d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          });
    }
  }
  return String(value);
}

/** Text form of a driver value without "[object Object]" surprises. */
function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value) ?? '';
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round((n + Number.EPSILON) * f) / f;
}
