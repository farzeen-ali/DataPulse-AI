/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- supertest response bodies are untyped JSON */
/**
 * Opt-in integration tests against a REAL PostgreSQL database that has been
 * migrated, configured with `npm run db:setup-role`, and seeded.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://datapulse_analytics:<pw>@host:port/db   (analytics role)
 *   INTEGRATION_OWNER_URL=postgresql://postgres:<pw>@host:port/db                (optional, owner)
 *   DATABASE_SSL=disable|require
 *   npm run test:integration
 *
 * Gemini is replaced by scripted SQL so the run is deterministic; everything
 * else (validator, executor, role checks, Prisma, result processing) is real.
 */
import { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { GeminiService } from '../src/ai/gemini.service';
import { buildPoolConfig, SslMode } from '../src/database/pg-connection';
import { setupApp } from '../src/setup-app';

const URL = process.env.INTEGRATION_DATABASE_URL;
const OWNER_URL = process.env.INTEGRATION_OWNER_URL;
const SSL = (process.env.DATABASE_SSL as SslMode) ?? 'require';
const d = URL ? describe : describe.skip;
jest.setTimeout(15_000);

/** The SQL a well-behaved model would write for the five reference questions. */
const SCRIPTED: Record<string, string> = {
  'Show the top five customers by spending': `SELECT u.name AS customer_name, u.country, ROUND(SUM(o.amount), 2) AS total_spent
    FROM orders o JOIN users u ON u.id = o.user_id WHERE o.status = 'completed'
    GROUP BY u.id, u.name, u.country ORDER BY total_spent DESC LIMIT 5`,
  'Compare monthly revenue': `SELECT date_trunc('month', o.created_at) AS month, ROUND(SUM(o.amount), 2) AS revenue
    FROM orders o WHERE o.status = 'completed' GROUP BY 1 ORDER BY month LIMIT 24`,
  'Which product categories generate the most revenue?': `SELECT p.category, ROUND(SUM(o.amount), 2) AS total_revenue
    FROM orders o JOIN products p ON p.id = o.product_id WHERE o.status = 'completed'
    GROUP BY p.category ORDER BY total_revenue DESC LIMIT 10`,
  'Find completed orders from this month': `SELECT o.id AS order_id, u.name AS customer_name, p.title AS product, o.amount, o.created_at
    FROM orders o JOIN users u ON u.id = o.user_id JOIN products p ON p.id = o.product_id
    WHERE o.status = 'completed' AND o.created_at >= date_trunc('month', now()) ORDER BY o.created_at DESC LIMIT 50`,
  'Which products have the highest number of orders?': `SELECT p.title AS product, COUNT(o.id) AS order_count
    FROM products p JOIN orders o ON o.product_id = p.id WHERE o.status IN ('completed', 'pending')
    GROUP BY p.title ORDER BY order_count DESC LIMIT 10`,
  'Count every combination of five orders': `SELECT COUNT(DISTINCT a.amount + b.amount + c.amount + e.amount + f.amount) AS combinations
    FROM orders a CROSS JOIN orders b CROSS JOIN orders c CROSS JOIN orders e CROSS JOIN orders f`,
};

function scriptedGemini(): Partial<GeminiService> {
  return {
    configured: true,
    model: 'scripted-test-model',
    generateJson: (req) => {
      if ((req.responseJsonSchema.required as string[]).includes('headline')) {
        return Promise.resolve('not json'); // force the deterministic, always-grounded summary
      }
      const question = JSON.parse(req.userContent.split('\n')[1]) as string;
      const sql = SCRIPTED[question];
      return Promise.resolve(
        JSON.stringify(
          sql
            ? { status: 'ok', sql, explanation: 'scripted', clarification: '' }
            : {
                status: 'unsupported',
                sql: '',
                explanation: 'not scripted',
                clarification: '',
              },
        ),
      );
    },
  };
}

d(
  'Integration: least-privilege role (database-level, bypassing the app)',
  () => {
    let pool: Pool;
    beforeAll(() => {
      pool = new Pool({ ...buildPoolConfig(URL!, SSL), max: 2 });
    });
    afterAll(() => pool.end());

    const code = (sql: string) =>
      pool.query(sql).then(
        () => 'ok',
        (e: { code?: string }) => e.code,
      );

    it('can read approved columns through RLS', async () => {
      const r = await pool.query<{ n: number }>(
        'SELECT COUNT(id)::int AS n FROM users',
      );
      expect(r.rows[0].n).toBeGreaterThanOrEqual(10);
    });

    it('cannot read the restricted email column', async () => {
      expect(await code('SELECT email FROM users')).toBe('42501');
      expect(await code('SELECT * FROM users')).toBe('42501');
    });

    it('sessions default to read-only with a statement timeout', async () => {
      const r = await pool.query<{ ro: string; to: string }>(
        "SELECT current_setting('default_transaction_read_only') AS ro, current_setting('statement_timeout') AS to",
      );
      expect(r.rows[0]).toEqual({ ro: 'on', to: '5s' });
    });

    it('cannot write even when it explicitly asks for a read-write transaction', async () => {
      expect(
        await code(
          "INSERT INTO users (name, email, country) VALUES ('x', 'x@y.z', 'X')",
        ),
      ).toMatch(/^(25006|42501)$/);
      const c = await pool.connect();
      try {
        await c.query('BEGIN READ WRITE');
        const res = await c
          .query("UPDATE orders SET status = 'cancelled'")
          .then(
            () => 'ok',
            (e: { code?: string }) => e.code,
          );
        expect(res).toBe('42501');
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    });

    it('cannot create objects or read other tables', async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN READ WRITE');
        const res = await c.query('CREATE TABLE stolen (id int)').then(
          () => 'ok',
          (e: { code?: string }) => e.code,
        );
        expect(res).toBe('42501');
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
      expect(await code('SELECT id FROM _prisma_migrations')).toBe('42501');
    });

    it('long-running statements are cancelled by the timeout', async () => {
      const c = await pool.connect();
      try {
        await c.query('BEGIN READ ONLY');
        await c.query('SET LOCAL statement_timeout = 300');
        const res = await c.query('SELECT pg_sleep(3)').then(
          () => 'ok',
          (e: { code?: string }) => e.code,
        );
        expect(res).toBe('57014');
      } finally {
        await c.query('ROLLBACK');
        c.release();
      }
    });
  },
);

d('Integration: full API workflow on real data', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    process.env.SUPABASE_DATABASE_URL = URL;
    process.env.DATABASE_SSL = SSL;
    process.env.QUERY_RATE_LIMIT_PER_MINUTE = '100';
    delete process.env.SUPABASE_DIRECT_URL;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(GeminiService)
      .useValue(scriptedGemini())
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      bodyParser: false,
      logger: false,
    });
    setupApp(app as NestExpressApplication);
    await app.init();
  });
  afterAll(() => app?.close());

  const ask = (prompt: string) =>
    request(app.getHttpServer()).post('/api/analytics/query').send({ prompt });

  it('health confirms a verified least-privilege connection', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.body.services.database).toBe('up');
    expect(res.body.security.leastPrivilegeRole).toBe(true);
  });

  it('overview KPIs work through Prisma with column-level grants', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/analytics/overview')
      .expect(200);
    expect(res.body.customers).toBeGreaterThanOrEqual(10);
    expect(res.body.products).toBeGreaterThanOrEqual(5);
    expect(res.body.orders.total).toBeGreaterThanOrEqual(20);
    expect(res.body.revenue.total).toBeGreaterThan(0);
    expect(res.body.monthly.length).toBeGreaterThanOrEqual(3);
  });

  it('top five customers by spending', async () => {
    const res = await ask('Show the top five customers by spending').expect(
      200,
    );
    expect(res.body.status).toBe('success');
    expect(res.body.rowCount).toBe(5);
    const spent = res.body.rows.map(
      (r: { total_spent: number }) => r.total_spent,
    );
    expect([...spent].sort((a: number, b: number) => b - a)).toEqual(spent);
    expect(
      res.body.columns.find((c: { name: string }) => c.name === 'total_spent')
        .format,
    ).toBe('currency');
    expect(res.body.chart.xKey).toBe('customer_name');
    expect(res.body.summary.grounded).toBe(true);
  });

  it('monthly revenue trend', async () => {
    const res = await ask('Compare monthly revenue').expect(200);
    expect(res.body.rowCount).toBeGreaterThanOrEqual(3);
    expect(res.body.columns[0].format).toBe('month');
    expect(['area', 'line']).toContain(res.body.chart.type);
    expect(res.body.trend).toBeDefined();
  });

  it('revenue by category', async () => {
    const res = await ask(
      'Which product categories generate the most revenue?',
    ).expect(200);
    expect(res.body.rowCount).toBeGreaterThanOrEqual(3);
    expect(
      res.body.shares.reduce((s: number, x: { pct: number }) => s + x.pct, 0),
    ).toBeCloseTo(100, 0);
  });

  it('completed orders from this month', async () => {
    const res = await ask('Find completed orders from this month').expect(200);
    expect(res.body.rowCount).toBeGreaterThanOrEqual(1);
    expect(
      res.body.security.checks.every((c: { passed: boolean }) => c.passed),
    ).toBe(true);
  });

  it('products with the most orders', async () => {
    const res = await ask(
      'Which products have the highest number of orders?',
    ).expect(200);
    expect(
      res.body.columns.find((c: { name: string }) => c.name === 'order_count')
        .format,
    ).toBe('integer');
  });

  // Uses the default 5 s statement timeout (config defaults are fixed at import time).
  it('expensive queries are cancelled by the statement timeout and not retried', async () => {
    const res = await ask('Count every combination of five orders').expect(504);
    expect(res.body.code).toBe('QUERY_TIMEOUT');
    expect(res.body.details.attempts).toHaveLength(1);
  }, 20_000);

  it('unsupported questions are explained, not guessed', async () => {
    const res = await ask('What is our profit margin by region?').expect(200);
    expect(res.body.status).toBe('unsupported');
    expect(res.body.sql).toBeNull();
  });
});

(OWNER_URL ? describe : describe.skip)(
  'Integration: owner credentials are refused for AI SQL',
  () => {
    let app: INestApplication<App>;
    beforeAll(async () => {
      process.env.SUPABASE_DATABASE_URL = OWNER_URL;
      process.env.DATABASE_SSL = SSL;
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(GeminiService)
        .useValue(scriptedGemini())
        .compile();
      app = moduleRef.createNestApplication<NestExpressApplication>({
        bodyParser: false,
        logger: false,
      });
      setupApp(app as NestExpressApplication);
      await app.init();
    });
    afterAll(() => app?.close());

    it('refuses to execute AI SQL with a superuser / table-owner connection', async () => {
      const health = await request(app.getHttpServer())
        .get('/api/health')
        .expect(200);
      expect(health.body.security.leastPrivilegeRole).toBe(false);
      const res = await request(app.getHttpServer())
        .post('/api/analytics/query')
        .send({ prompt: 'Show the top five customers by spending' })
        .expect(503);
      expect(res.body.code).toBe('UNSAFE_DATABASE_ROLE');
    });
  },
);
