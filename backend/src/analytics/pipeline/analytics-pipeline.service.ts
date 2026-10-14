import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../common/app-error';
import { GeminiService } from '../../ai/gemini.service';
import { MalformedModelResponseError } from '../../ai/model-json';
import { SchemaContextService } from '../context/schema-context.service';
import {
  CorrectableQueryError,
  ExecutionResult,
  QueryExecutorService,
} from '../execution/query-executor.service';
import { IntentRouterService } from '../intent/intent-router.service';
import { recommendChart } from '../results/chart-recommender';
import { ResultProcessorService } from '../results/result-processor.service';
import { PromptGuardService } from '../security/prompt-guard.service';
import {
  SqlValidationResult,
  SqlValidatorService,
} from '../security/sql-validator.service';
import { SQL_POLICY } from '../security/sql-policy';
import {
  GeneratedSql,
  PreviousAttempt,
  SqlGeneratorService,
} from '../sql/sql-generator.service';
import { SummaryService } from '../summary/summary.service';
import type {
  AnalyticsQueryResponse,
  AttemptRecord,
  PipelineStep,
  PipelineStepId,
} from './analytics.types';

/** Self-correction budget: 1 initial attempt + at most 2 retries. */
export const MAX_SQL_RETRIES = 2;

const STEP_LABELS: Record<PipelineStepId, string> = {
  guard: 'Prompt security',
  intent: 'Intent analysis',
  context: 'Schema context',
  generation: 'SQL generation',
  validation: 'Security validation',
  execution: 'Database execution',
  summary: 'Business summary',
};

/**
 * The SQL agent workflow:
 * Question → Guard → Intent → Schema context → SQL generation → AST validation
 * → Read-only execution → Result processing → Grounded summary (+ chart).
 */
@Injectable()
export class AnalyticsPipelineService {
  private readonly logger = new Logger(AnalyticsPipelineService.name);

  constructor(
    private readonly guard: PromptGuardService,
    private readonly router: IntentRouterService,
    private readonly schemaContext: SchemaContextService,
    private readonly generator: SqlGeneratorService,
    private readonly validator: SqlValidatorService,
    private readonly executor: QueryExecutorService,
    private readonly processor: ResultProcessorService,
    private readonly summarizer: SummaryService,
    private readonly gemini: GeminiService,
  ) {}

  async run(rawPrompt: string): Promise<AnalyticsQueryResponse> {
    const started = performance.now();
    const steps: PipelineStep[] = [];
    const attempts: AttemptRecord[] = [];
    const step = async <T>(
      id: PipelineStepId,
      fn: () => Promise<T> | T,
      detail?: (r: T) => string,
    ) => {
      const t0 = performance.now();
      try {
        const r = await fn();
        steps.push({
          id,
          label: STEP_LABELS[id],
          status: 'done',
          durationMs: ms(t0),
          detail: detail?.(r),
        });
        return r;
      } catch (err) {
        steps.push({
          id,
          label: STEP_LABELS[id],
          status: 'failed',
          durationMs: ms(t0),
        });
        throw err;
      }
    };

    // 1. Prompt guard ---------------------------------------------------------
    const inspection = await step(
      'guard',
      () => {
        const r = this.guard.inspect(rawPrompt);
        if (!r.allowed) {
          throw new AppError(
            'PROMPT_REJECTED',
            r.reason ?? 'This request is not allowed.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            {
              category: r.category,
            },
          );
        }
        return r;
      },
      () => 'No injection patterns detected',
    );
    const prompt = inspection.prompt;

    // 2. Intent + 3. schema context (vectorless retrieval) --------------------
    const intent = await step(
      'intent',
      () => this.router.analyze(prompt),
      (r) =>
        `${r.primary.replace('_', ' ')} · ${r.tables.join(', ') || 'all tables'}`,
    );
    const context = await step(
      'context',
      () => this.schemaContext.build(intent),
      (c) => `${c.tables.length} tables · ${c.rules.length} business rules`,
    );

    const base = {
      id: randomUUID(),
      prompt,
      intent: {
        primary: intent.primary,
        intents: intent.intents,
        topics: intent.topics,
        tables: intent.tables,
        timeGrain: intent.timeGrain,
        requestedLimit: intent.requestedLimit,
      },
      context: {
        tables: context.tables.map((t) => t.name),
        relationships: context.relationships.map(
          (r) =>
            `${r.from.table}.${r.from.column} → ${r.to.table}.${r.to.column}`,
        ),
        rules: context.rules.map((r) => r.title),
      },
      model: this.gemini.model,
      executedAt: new Date().toISOString(),
    };

    // 4–6. Generate → validate → execute, with bounded self-correction --------
    let previous: PreviousAttempt | undefined;
    let validation: SqlValidationResult | undefined;
    let exec: ExecutionResult | undefined;
    let explanation = '';
    const genStart = performance.now();
    let valMs = 0;
    let execMs = 0;

    for (let attempt = 1; attempt <= MAX_SQL_RETRIES + 1; attempt++) {
      let generated: GeneratedSql;
      try {
        generated = await this.generator.generate({
          question: prompt,
          intent,
          context,
          previous,
        });
      } catch (err) {
        if (err instanceof MalformedModelResponseError) {
          attempts.push({
            attempt,
            outcome: 'malformed_response',
            error: 'The model returned an invalid response.',
          });
          previous = undefined; // nothing useful to show the model
          continue;
        }
        steps.push({
          id: 'generation',
          label: STEP_LABELS.generation,
          status: 'failed',
          durationMs: ms(genStart),
        });
        throw err;
      }

      if (generated.status !== 'ok') {
        steps.push({
          id: 'generation',
          label: STEP_LABELS.generation,
          status: 'done',
          durationMs: ms(genStart),
          detail: 'Model declined to guess',
        });
        return {
          ...base,
          status: generated.status,
          message:
            generated.clarification ||
            generated.explanation ||
            'This question cannot be answered from the available customer, product and order data.',
          ...this.emptyResult(),
          explanation: generated.explanation,
          attempts,
          steps: this.withSkipped(steps),
          timings: { totalMs: ms(started), executionMs: null },
        };
      }

      explanation = generated.explanation;
      const tVal = performance.now();
      validation = this.validator.validate(generated.sql ?? '');
      valMs += ms(tVal);

      if (!validation.ok) {
        const correctable = SqlValidatorService.isCorrectable(validation);
        const error = validation.violations.map((v) => v.message).join(' ');
        attempts.push({
          attempt,
          sql: generated.sql,
          outcome: 'validation_failed',
          error,
        });
        if (!correctable) {
          // Security / complexity violations are never retried.
          this.pushGenerationAndValidation(steps, genStart, valMs, 'failed');
          throw new AppError(
            'SQL_SECURITY_VIOLATION',
            'The generated SQL was blocked by the security validator and was not executed.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            {
              sql: generated.sql,
              violations: validation.violations,
              checks: validation.checks,
              attempts,
            },
          );
        }
        previous = { sql: generated.sql!, error };
        continue;
      }

      try {
        const tExec = performance.now();
        exec = await this.executor.execute(validation.sql!);
        execMs += ms(tExec);
        attempts.push({ attempt, sql: validation.sql, outcome: 'executed' });
        break;
      } catch (err) {
        if (err instanceof CorrectableQueryError) {
          attempts.push({
            attempt,
            sql: validation.sql,
            outcome: 'execution_failed',
            error: err.message,
          });
          previous = {
            sql: validation.sql!,
            error: `PostgreSQL error ${err.pgCode}: ${err.message}`,
          };
          continue;
        }
        // Timeouts, authorization failures and outages are never retried.
        attempts.push({
          attempt,
          sql: validation.sql,
          outcome: 'execution_failed',
          error: err instanceof AppError ? err.message : 'Query failed.',
        });
        this.pushGenerationAndValidation(steps, genStart, valMs, 'done');
        steps.push({
          id: 'execution',
          label: STEP_LABELS.execution,
          status: 'failed',
          durationMs: 0,
        });
        if (err instanceof AppError) {
          throw new AppError(err.code, err.message, err.status, {
            ...(err.details ?? {}),
            sql: validation.sql,
            attempts,
          });
        }
        throw err;
      }
    }

    if (!exec || !validation?.ok) {
      this.pushGenerationAndValidation(steps, genStart, valMs, 'failed');
      throw new AppError(
        'RETRY_LIMIT_EXCEEDED',
        `A valid query could not be produced after ${MAX_SQL_RETRIES + 1} attempts. Try rephrasing the question more specifically.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        { attempts, checks: validation?.checks },
      );
    }

    steps.push({
      id: 'generation',
      label: STEP_LABELS.generation,
      status: 'done',
      durationMs: Math.max(0, ms(genStart) - valMs - execMs),
      detail:
        attempts.length > 1
          ? `Self-corrected after ${attempts.length - 1} ${attempts.length === 2 ? 'retry' : 'retries'}`
          : 'First attempt',
    });
    steps.push({
      id: 'validation',
      label: STEP_LABELS.validation,
      status: 'done',
      durationMs: round1(valMs),
      detail: `${validation.checks.filter((c) => c.passed).length}/${validation.checks.length} checks passed`,
    });
    steps.push({
      id: 'execution',
      label: STEP_LABELS.execution,
      status: 'done',
      durationMs: round1(execMs),
      detail: `${exec.rowCount} rows · read-only transaction`,
    });

    // 7. Results → structured context → grounded summary ----------------------
    const result = this.processor.process(exec);
    const summary = await step(
      'summary',
      () => this.summarizer.summarize({ question: prompt, result, context }),
      (s) =>
        s.source === 'ai'
          ? `AI summary · ${s.numbersVerified} numbers verified`
          : 'Computed from results',
    );

    return {
      ...base,
      status: result.rowCount === 0 ? 'empty' : 'success',
      sql: validation.sql!,
      explanation,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.rowCount,
      truncated: result.truncated,
      aggregates: result.aggregates,
      trend: result.trend,
      shares: result.shares,
      chart: recommendChart(result, intent),
      summary,
      security: {
        validated: true,
        checks: [
          ...validation.checks,
          {
            id: 'readonly-tx',
            label: 'Executed in READ ONLY transaction',
            passed: true,
          },
          {
            id: 'timeout',
            label: `Statement timeout ${this.executor.timeoutMs} ms`,
            passed: true,
          },
          {
            id: 'role',
            label: 'Least-privilege database role verified',
            passed: true,
          },
        ],
        rowLimit: SQL_POLICY.maxRowLimit,
        limitInjected: validation.limitInjected,
        timeoutMs: this.executor.timeoutMs,
      },
      attempts,
      steps,
      timings: { totalMs: ms(started), executionMs: exec.durationMs },
    };
  }

  private emptyResult() {
    return {
      sql: null,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      aggregates: [],
      chart: null,
      summary: null,
      security: {
        validated: false,
        checks: [],
        rowLimit: SQL_POLICY.maxRowLimit,
        limitInjected: false,
        timeoutMs: this.executor.timeoutMs,
      },
    };
  }

  private pushGenerationAndValidation(
    steps: PipelineStep[],
    genStart: number,
    valMs: number,
    validationStatus: 'done' | 'failed',
  ) {
    steps.push({
      id: 'generation',
      label: STEP_LABELS.generation,
      status: 'done',
      durationMs: Math.max(0, ms(genStart) - valMs),
    });
    steps.push({
      id: 'validation',
      label: STEP_LABELS.validation,
      status: validationStatus,
      durationMs: round1(valMs),
    });
  }

  private withSkipped(steps: PipelineStep[]): PipelineStep[] {
    const done = new Set(steps.map((s) => s.id));
    const order: PipelineStepId[] = [
      'guard',
      'intent',
      'context',
      'generation',
      'validation',
      'execution',
      'summary',
    ];
    return order
      .map(
        (id) =>
          steps.find((s) => s.id === id) ?? {
            id,
            label: STEP_LABELS[id],
            status: 'skipped' as const,
            durationMs: 0,
          },
      )
      .filter((s) => done.has(s.id) || s.status === 'skipped');
  }
}

function ms(t0: number): number {
  return round1(performance.now() - t0);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
