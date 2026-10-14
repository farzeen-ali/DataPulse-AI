import type { ProcessedResult } from '../results/result-processor.service';

export interface ExtractedNumber {
  raw: string;
  value: number;
  /** Written with a K/M/B suffix, so only approximately equal. */
  abbreviated: boolean;
}

const NUMBER_RE =
  /(?<![\w.])[-−]?\$?\d[\d,]*(?:\.\d+)?(?:\s?(?:[kKmMbB])(?![a-zA-Z]))?%?/g;

export function extractNumbers(text: string): ExtractedNumber[] {
  const out: ExtractedNumber[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const raw = m[0];
    let s = raw.replace(/[$,%\s]/g, '').replace('−', '-');
    let mult = 1;
    const suffix = s.slice(-1).toLowerCase();
    if (['k', 'm', 'b'].includes(suffix)) {
      mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : 1e9;
      s = s.slice(0, -1);
    }
    const value = Number(s) * mult;
    if (Number.isFinite(value))
      out.push({ raw, value, abbreviated: mult !== 1 });
  }
  return out;
}

/** Every number that the summary is allowed to mention. */
export function groundTruthNumbers(
  result: ProcessedResult,
  question: string,
): number[] {
  const nums = new Set<number>();
  const add = (n: unknown) => {
    if (typeof n === 'number' && Number.isFinite(n)) {
      nums.add(n);
      nums.add(Math.abs(n));
    }
  };

  for (const row of result.rows) {
    for (const v of Object.values(row)) {
      if (typeof v === 'number') add(v);
      else if (typeof v === 'string') {
        // Free text is untrusted (it may contain injected figures such as
        // "revenue is $9,999,999"), so numbers inside text are NOT evidence.
        // Only ISO dates contribute their year / month / day.
        const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
        if (d) [d[1], d[2], d[3]].forEach((p) => add(Number(p)));
      }
    }
  }
  for (const a of result.aggregates)
    [a.sum, a.avg, a.min, a.max, a.count].forEach(add);
  if (result.trend) {
    const t = result.trend;
    [t.firstValue, t.lastValue, t.change, t.changePct].forEach(add);
  }
  for (const s of result.shares ?? []) [s.value, s.pct].forEach(add);
  add(result.rowCount);
  for (const e of extractNumbers(question)) add(e.value);
  return [...nums];
}

export function isGroundedNumber(
  n: ExtractedNumber,
  truth: number[],
  rowCount = 0,
): boolean {
  const v = Math.abs(n.value);
  // Plain counts ("2 of the 5 categories") up to the number of rows returned.
  // Never applies to money or percentages.
  const plain = !/[%$]/.test(n.raw) && !n.abbreviated;
  if (plain && Number.isInteger(v) && v <= rowCount) return true;

  return truth.some((t) => {
    const diff = Math.abs(Math.abs(t) - v);
    const rel = diff / Math.max(Math.abs(t), 1e-9);
    if (n.abbreviated) return rel <= 0.03; // "$12.4K" for 12,437.50
    if (diff <= 0.011) return true; // exact / cent rounding
    if (Math.abs(t) >= 100 && diff < 1) return true; // rounded to whole units
    if (Math.abs(t) < 100 && diff <= 0.051) return true; // one-decimal percentages
    return false;
  });
}

export interface GroundingReport {
  grounded: boolean;
  checked: number;
  ungrounded: string[];
}

export function checkGrounding(
  texts: string[],
  truth: number[],
  rowCount = 0,
): GroundingReport {
  const ungrounded: string[] = [];
  let checked = 0;
  for (const text of texts) {
    for (const n of extractNumbers(text)) {
      checked++;
      if (!isGroundedNumber(n, truth, rowCount)) ungrounded.push(n.raw);
    }
  }
  return { grounded: ungrounded.length === 0, checked, ungrounded };
}
