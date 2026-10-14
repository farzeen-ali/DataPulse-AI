import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { types, type PoolClient } from 'pg';
import { AppError } from '../../common/app-error';
import type { AppEnv } from '../../config/configuration';
import { DatabaseService } from '../../database/database.service';
import { SqlValidatorService } from '../security/sql-validator.service';
import { SQL_POLICY } from '../security/sql-policy';

export interface RawField {
  name: string;
  dataTypeID: number;
}

export interface ExecutionResult {
  fields: RawField[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
}

/**
 * A database error the model is allowed to fix (syntax / type / grouping
 * mistakes). Only the short PostgreSQL message is kept — never DETAIL, HINT,
 * or WHERE, which can contain data or internals.
 */
export class CorrectableQueryError extends Error {
  constructor(
    public readonly pgCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'CorrectableQueryError';
  }
}

/**
 * Keep dates, timestamps, numerics and int8 as their exact text form; the
 * result processor normalises them (avoids timezone shifts and float rounding).
 */
const RAW_TEXT_OIDS = new Set([20, 1700, 1082, 1114, 1184, 1186]);
const queryTypes = {
  getTypeParser: ((oid: number, format?: 'text' | 'binary') =>
    RAW_TEXT_OIDS.has(oid)
      ? (value: string) => value
      : (types.getTypeParser(oid, format ?? 'text') as (
          value: string,
        ) => unknown)) as typeof types.getTypeParser,
};

/** SQLSTATE classes the model may correct: data exceptions, cardinality, syntax/semantic. */
const CORRECTABLE_CLASSES = ['22', '21', '42'];
/** Never retried: authorization, read-only violations, missing objects. */
const NEVER_RETRY = new Set(['42501', '25006', '42P01', '3F000']);

@Injectable()
export class QueryExecutorService {
  private readonly logger = new Logger(QueryExecutorService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly validator: SqlValidatorService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  get timeoutMs(): number {
    return this.config.get('QUERY_TIMEOUT_MS', { infer: true });
  }

  async execute(sql: string): Promise<ExecutionResult> {
    // Defence in depth: never trust the caller — revalidate the exact text.
    const check = this.validator.validate(sql);
    if (!check.ok || check.sql !== sql) {
      throw new AppError(
        'SQL_SECURITY_VIOLATION',
        'Query failed revalidation immediately before execution.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const pool = await this.db.assertSafeForAiSql();
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch {
      throw new AppError(
        'DATABASE_UNAVAILABLE',
        'The analytics database is currently unreachable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const timeout = Math.trunc(this.timeoutMs);
    let broken = false;
    try {
      await client.query(
        'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
      );
      await client.query(`SET LOCAL statement_timeout = ${timeout}`);
      await client.query('SET LOCAL lock_timeout = 1000');
      await client.query(
        `SET LOCAL idle_in_transaction_session_timeout = ${timeout * 2}`,
      );
      await client.query('SET LOCAL search_path = pg_catalog, public');
      await client.query("SET LOCAL TIME ZONE 'UTC'");

      const started = performance.now();
      const res = await client.query<unknown[]>({
        text: sql,
        rowMode: 'array',
        types: queryTypes,
      });
      const durationMs = Math.round((performance.now() - started) * 10) / 10;

      const rows = (res.rows ?? []).slice(0, SQL_POLICY.maxRowLimit);
      return {
        fields: (res.fields ?? []).map((f) => ({
          name: f.name,
          dataTypeID: f.dataTypeID,
        })),
        rows,
        rowCount: rows.length,
        durationMs,
      };
    } catch (err) {
      const mapped = this.classify(err);
      broken =
        mapped instanceof AppError && mapped.code === 'DATABASE_UNAVAILABLE';
      throw mapped;
    } finally {
      // Read-only: there is never anything to commit.
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      client.release(broken);
    }
  }

  classify(err: unknown): Error {
    const e = err as { code?: string; message?: string };
    const code = typeof e?.code === 'string' ? e.code : '';
    const message = (e?.message ?? 'query failed').split('\n')[0].slice(0, 200);

    if (code === '57014') {
      return new AppError(
        'QUERY_TIMEOUT',
        `The query exceeded the ${this.timeoutMs} ms time limit and was cancelled. Try a narrower question.`,
        HttpStatus.GATEWAY_TIMEOUT,
      );
    }
    if (code === '42501' || code === '25006') {
      this.logger.warn(`Blocked by database permissions (${code}).`);
      return new AppError(
        'QUERY_NOT_AUTHORIZED',
        'The database refused this query: the analytics role is not permitted to access that data.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (code.startsWith('08') || code.startsWith('57P') || code === '53300') {
      return new AppError(
        'DATABASE_UNAVAILABLE',
        'The analytics database is currently unreachable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (
      !NEVER_RETRY.has(code) &&
      CORRECTABLE_CLASSES.includes(code.slice(0, 2))
    ) {
      return new CorrectableQueryError(code, message);
    }

    this.logger.error(`Query failed (${code || 'no code'}): ${message}`);
    return new AppError(
      'QUERY_FAILED',
      'The database could not run this query.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
