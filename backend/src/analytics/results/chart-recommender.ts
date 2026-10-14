import type { IntentAnalysis } from '../intent/intent-router.service';
import type { ColumnFormat, ProcessedResult } from './result-processor.service';

export type ChartType = 'bar' | 'horizontal-bar' | 'line' | 'area' | 'pie';

export interface ChartConfig {
  type: ChartType;
  /** Other chart types that suit this data (for the type switcher). */
  alternatives: ChartType[];
  xKey: string;
  xLabel: string;
  xFormat: ColumnFormat;
  series: Array<{ key: string; label: string; format: ColumnFormat }>;
  title: string;
}

const MAX_CATEGORIES = 25;

/**
 * Deterministic chart selection from the *shape* of real results. Returns
 * null when a chart would not help (single value, no numeric measure, too
 * many categories, etc.).
 */
export function recommendChart(
  result: ProcessedResult,
  intent: IntentAnalysis,
): ChartConfig | null {
  if (result.rowCount < 2) return null;

  const measures = result.columns.filter(
    (c) => c.kind === 'number' && !c.isIdentifier,
  );
  if (!measures.length) return null;

  // Do not mix currency with counts on one axis: keep measures of the primary format.
  const primaryFormat = measures[0].format;
  const series = measures
    .filter((m) => m.format === primaryFormat)
    .slice(0, 3)
    .map((m) => ({ key: m.key, label: m.label, format: m.format }));

  const time = result.columns.find((c) => c.kind === 'date');
  if (time) {
    return {
      type: series.length === 1 ? 'area' : 'line',
      alternatives: ['area', 'line', 'bar'],
      xKey: time.key,
      xLabel: time.label,
      xFormat: time.format,
      series,
      title: `${series.map((s) => s.label).join(' & ')} over time`,
    };
  }

  const category = result.columns.find(
    (c) => c.kind === 'string' && !c.isIdentifier,
  );
  if (!category || result.rowCount > MAX_CATEGORIES) return null;

  const allPositive = result.rows.every((r) =>
    series.every(
      (s) => typeof r[s.key] !== 'number' || (r[s.key] as number) >= 0,
    ),
  );
  const pieOk = series.length === 1 && result.rowCount <= 6 && allPositive;
  const longLabels = result.rows.some(
    (r) => String(r[category.key] ?? '').length > 14,
  );

  let type: ChartType =
    longLabels || result.rowCount > 8 ? 'horizontal-bar' : 'bar';
  if (
    pieOk &&
    intent.intents.includes('comparison') &&
    /categor|countr|status/i.test(category.name)
  ) {
    type = 'pie';
  }

  const alternatives: ChartType[] = ['bar', 'horizontal-bar'];
  if (pieOk) alternatives.push('pie');

  return {
    type,
    alternatives,
    xKey: category.key,
    xLabel: category.label,
    xFormat: category.format,
    series,
    title: `${series.map((s) => s.label).join(' & ')} by ${category.label}`,
  };
}
