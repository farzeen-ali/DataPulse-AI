/* eslint-disable @typescript-eslint/unbound-method -- jest mock assertions */
import { HttpStatus } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AppError } from '../../common/app-error';
import type { AppEnv } from '../../config/configuration';
import type { DatabaseService } from '../../database/database.service';
import { SqlValidatorService } from '../security/sql-validator.service';
import {
  CorrectableQueryError,
  QueryExecutorService,
} from './query-executor.service';

function setup(
  opts: { fail?: { code: string; message: string }; unsafe?: boolean } = {},
) {
  const calls: string[] = [];
  const client = {
    query: jest.fn((q: string | { text: string }) => {
      const text = typeof q === 'string' ? q : q.text;
      calls.push(text);
      if (typeof q !== 'string' && opts.fail) {
        return Promise.reject(
          Object.assign(new Error(opts.fail.message), { code: opts.fail.code }),
        );
      }
      if (typeof q !== 'string') {
        return Promise.resolve({
          fields: [{ name: 'n', dataTypeID: 20 }],
          rows: [['3']],
        });
      }
      return Promise.resolve({ rows: [] });
    }),
    release: jest.fn(),
  };
  const pool = { connect: jest.fn(() => Promise.resolve(client)) };
  const db = {
    assertSafeForAiSql: jest.fn(() =>
      opts.unsafe
        ? Promise.reject(
            new AppError(
              'UNSAFE_DATABASE_ROLE',
              'unsafe',
              HttpStatus.SERVICE_UNAVAILABLE,
            ),
          )
        : Promise.resolve(pool),
    ),
  } as unknown as DatabaseService;
  const config = { get: () => 5000 } as unknown as ConfigService<AppEnv, true>;
  const validator = new SqlValidatorService();
  return {
    executor: new QueryExecutorService(db, validator, config),
    client,
    calls,
    db,
    validator,
  };
}

describe('QueryExecutorService (safe execution)', () => {
  beforeAll(() => SqlValidatorService.init());
  const SQL = 'SELECT COUNT(*) AS n FROM orders LIMIT 1';

  it('runs inside a READ ONLY transaction with a statement timeout, then rolls back', async () => {
    const { executor, calls, client } = setup();
    const res = await executor.execute(SQL);
    expect(calls[0]).toBe(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY',
    );
    expect(calls).toContain('SET LOCAL statement_timeout = 5000');
    expect(calls).toContain('SET LOCAL search_path = pg_catalog, public');
    expect(calls).toContain(SQL);
    expect(calls[calls.length - 1]).toBe('ROLLBACK');
    expect(client.release).toHaveBeenCalledWith(false);
    expect(res).toMatchObject({
      rowCount: 1,
      rows: [['3']],
      fields: [{ name: 'n', dataTypeID: 20 }],
    });
  });

  it('revalidates SQL itself and refuses anything unsafe — even if the caller skipped validation', async () => {
    const { executor, db } = setup();
    for (const sql of [
      'DELETE FROM orders',
      'SELECT email FROM users LIMIT 1',
      'SELECT id FROM orders',
    ]) {
      await expect(executor.execute(sql)).rejects.toMatchObject({
        code: 'SQL_SECURITY_VIOLATION',
      });
    }
    // Never even asked for a connection.
    expect(db.assertSafeForAiSql).not.toHaveBeenCalled();
  });

  it('refuses to execute when the database role is not least-privilege', async () => {
    const { executor, client } = setup({ unsafe: true });
    await expect(executor.execute(SQL)).rejects.toMatchObject({
      code: 'UNSAFE_DATABASE_ROLE',
    });
    expect(client.query).not.toHaveBeenCalled();
  });

  it('maps statement timeouts to QUERY_TIMEOUT (never retried)', async () => {
    const { executor, calls } = setup({
      fail: {
        code: '57014',
        message: 'canceling statement due to statement timeout',
      },
    });
    await expect(executor.execute(SQL)).rejects.toMatchObject({
      code: 'QUERY_TIMEOUT',
      status: 504,
    });
    expect(calls[calls.length - 1]).toBe('ROLLBACK');
  });

  it.each([
    ['42501', 'permission denied for table users'],
    ['25006', 'cannot execute INSERT in a read-only transaction'],
  ])(
    'maps authorization failure %s to QUERY_NOT_AUTHORIZED',
    async (code, message) => {
      const { executor } = setup({ fail: { code, message } });
      await expect(executor.execute(SQL)).rejects.toMatchObject({
        code: 'QUERY_NOT_AUTHORIZED',
        status: 403,
      });
    },
  );

  it.each([
    ['42703', 'column "total" does not exist'],
    ['42803', 'column "u.name" must appear in the GROUP BY clause'],
    ['22P02', 'invalid input syntax for type integer: "abc"'],
    ['42883', 'function date_trunc(unknown, integer) does not exist'],
  ])(
    'marks %s as correctable with only the first line of the message',
    async (code, message) => {
      const { executor } = setup({
        fail: { code, message: `${message}\nDETAIL: secret row data` },
      });
      const err = await executor.execute(SQL).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CorrectableQueryError);
      expect((err as CorrectableQueryError).message).toBe(message);
      expect((err as CorrectableQueryError).message).not.toContain('DETAIL');
    },
  );

  it('hides unexpected driver errors behind a generic message', async () => {
    const { executor } = setup({
      fail: { code: 'XX000', message: 'internal error at /var/lib/postgresql' },
    });
    const err = (await executor
      .execute(SQL)
      .catch((e: unknown) => e)) as AppError;
    expect(err.code).toBe('QUERY_FAILED');
    expect(err.message).not.toContain('/var/lib');
  });

  it('maps connection loss to DATABASE_UNAVAILABLE and discards the client', async () => {
    const { executor, client } = setup({
      fail: { code: '08006', message: 'connection failure' },
    });
    await expect(executor.execute(SQL)).rejects.toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
    });
    expect(client.release).toHaveBeenCalledWith(true);
  });
});
