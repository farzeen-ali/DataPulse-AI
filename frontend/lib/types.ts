/** Types mirroring the DataPulse API (backend/src/analytics/pipeline/analytics.types.ts). */

export type ColumnFormat =
  | "currency"
  | "integer"
  | "decimal"
  | "percent"
  | "month"
  | "date"
  | "datetime"
  | "text"
  | "boolean";

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface ColumnMeta {
  key: string;
  name: string;
  label: string;
  kind: "number" | "string" | "date" | "boolean";
  format: ColumnFormat;
  pgType: string;
  isIdentifier: boolean;
}

export interface NumericAggregate {
  column: string;
  label: string;
  format: ColumnFormat;
  sum: number;
  avg: number;
  min: number;
  max: number;
  count: number;
  maxLabel?: string;
  minLabel?: string;
}

export type ChartType = "bar" | "horizontal-bar" | "line" | "area" | "pie";

export interface ChartConfig {
  type: ChartType;
  alternatives: ChartType[];
  xKey: string;
  xLabel: string;
  xFormat: ColumnFormat;
  series: Array<{ key: string; label: string; format: ColumnFormat }>;
  title: string;
}

export interface SecurityCheck {
  id: string;
  label: string;
  passed: boolean;
}

export type PipelineStepId =
  | "guard"
  | "intent"
  | "context"
  | "generation"
  | "validation"
  | "execution"
  | "summary";

export interface PipelineStep {
  id: PipelineStepId;
  label: string;
  status: "done" | "failed" | "skipped";
  durationMs: number;
  detail?: string;
}

export interface AttemptRecord {
  attempt: number;
  sql?: string;
  outcome: "executed" | "validation_failed" | "execution_failed" | "malformed_response";
  error?: string;
}

export interface BusinessSummary {
  headline: string;
  text: string;
  highlights: string[];
  source: "ai" | "deterministic";
  grounded: boolean;
  numbersVerified: number;
  fallbackReason?: string;
}

export type QueryStatus = "success" | "empty" | "needs_clarification" | "unsupported";

export interface QueryResponse {
  id: string;
  prompt: string;
  status: QueryStatus;
  message?: string;
  intent: {
    primary: string;
    intents: string[];
    topics: string[];
    tables: string[];
    timeGrain?: string;
    requestedLimit?: number;
  };
  context: { tables: string[]; relationships: string[]; rules: string[] };
  sql: string | null;
  explanation: string;
  columns: ColumnMeta[];
  rows: Row[];
  rowCount: number;
  truncated: boolean;
  aggregates: NumericAggregate[];
  trend?: {
    column: string;
    firstPeriod: string;
    lastPeriod: string;
    firstValue: number;
    lastValue: number;
    change: number;
    changePct: number | null;
  };
  shares?: Array<{ label: string; value: number; pct: number }>;
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
  timings: { totalMs: number; executionMs: number | null };
  model: string;
  executedAt: string;
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: {
    category?: string;
    sql?: string;
    violations?: Array<{ code: string; category: string; message: string }>;
    checks?: SecurityCheck[];
    attempts?: AttemptRecord[];
  };
}

export interface OverviewResponse {
  revenue: { total: number; thisMonth: number; lastMonth: number; changePct: number | null };
  orders: { total: number; completed: number; pending: number; cancelled: number };
  customers: number;
  products: number;
  averageOrderValue: number;
  monthly: Array<{ month: string; revenue: number; orders: number }>;
  generatedAt: string;
}

export interface SchemaResponse {
  tables: Array<{
    name: string;
    label: string;
    description: string;
    columns: Array<{
      name: string;
      type: string;
      description: string;
      primaryKey: boolean;
      references: { table: string; column: string } | null;
      examples: string[];
    }>;
    restrictedColumns: string[];
  }>;
  relationships: Array<{
    from: { table: string; column: string };
    to: { table: string; column: string };
    cardinality: string;
    description: string;
  }>;
  businessRules: Array<{ id: string; title: string; rule: string }>;
  policy: {
    maxRowLimit: number;
    maxJoins: number;
    maxSubqueryDepth: number;
    allowedFunctions: string[];
    statementTypes: string[];
  };
  examples: string[];
}

export interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  uptimeSeconds: number;
  services: { api: string; database: string; ai: string };
  security: { leastPrivilegeRole: boolean; readOnlyExecution: boolean; sqlAstValidation: boolean };
}
