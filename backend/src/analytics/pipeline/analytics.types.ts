import type { IntentAnalysis } from '../intent/intent-router.service';
import type { ChartConfig } from '../results/chart-recommender';
import type {
  ColumnMeta,
  NumericAggregate,
  Row,
  Share,
  Trend,
} from '../results/result-processor.service';
import type { SecurityCheck } from '../security/sql-validator.service';
import type { BusinessSummary } from '../summary/summary.service';

export type PipelineStepId =
  | 'guard'
  | 'intent'
  | 'context'
  | 'generation'
  | 'validation'
  | 'execution'
  | 'summary';

export interface PipelineStep {
  id: PipelineStepId;
  label: string;
  status: 'done' | 'failed' | 'skipped';
  durationMs: number;
  detail?: string;
}

export interface AttemptRecord {
  attempt: number;
  sql?: string;
  outcome:
    | 'executed'
    | 'validation_failed'
    | 'execution_failed'
    | 'malformed_response';
  error?: string;
}

export type QueryStatus =
  'success' | 'empty' | 'needs_clarification' | 'unsupported';

export interface AnalyticsQueryResponse {
  id: string;
  prompt: string;
  status: QueryStatus;
  /** Explanation for clarification / unsupported answers. */
  message?: string;
  intent: Pick<
    IntentAnalysis,
    'primary' | 'intents' | 'topics' | 'tables' | 'timeGrain' | 'requestedLimit'
  >;
  context: { tables: string[]; relationships: string[]; rules: string[] };
  sql: string | null;
  explanation: string;
  columns: ColumnMeta[];
  rows: Row[];
  rowCount: number;
  truncated: boolean;
  aggregates: NumericAggregate[];
  trend?: Trend;
  shares?: Share[];
  chart: ChartConfig | null;
  summary: BusinessSummary | null;
  security: {
    validated: boolean;
    checks: SecurityCheck[];
    rowLimit: number;
    limitInjected: boolean;
    timeoutMs: number;
  };
  attempts: AttemptRecord[];
  steps: PipelineStep[];
  timings: {
    totalMs: number;
    executionMs: number | null;
  };
  model: string;
  executedAt: string;
}
