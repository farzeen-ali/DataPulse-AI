import { SqlValidatorService } from './sql-validator.service';
import { SQL_POLICY } from './sql-policy';

describe('SqlValidatorService (AST validation)', () => {
  const validator = new SqlValidatorService();

  beforeAll(async () => {
    await SqlValidatorService.init();
  });

  const codes = (sql: string) =>
    validator.validate(sql).violations.map((v) => v.code);
  const expectBlocked = (sql: string, code: string, category = 'security') => {
    const r = validator.validate(sql);
    expect(r.ok).toBe(false);
    expect(r.sql).toBeUndefined();
    const v = r.violations.find((x) => x.code === code);
    expect(v).toBeDefined();
    expect(v!.category).toBe(category);
    return r;
  };

  describe('approved read-only queries', () => {
    const valid = [
      `SELECT u.name AS customer_name, ROUND(SUM(o.amount), 2) AS total_spent
         FROM orders o JOIN users u ON u.id = o.user_id
        WHERE o.status = 'completed'
        GROUP BY u.id, u.name ORDER BY total_spent DESC LIMIT 5`,
      `SELECT date_trunc('month', o.created_at) AS month, ROUND(SUM(o.amount), 2) AS revenue
         FROM orders o WHERE o.status = 'completed' GROUP BY 1 ORDER BY month LIMIT 24`,
      `SELECT p.category, SUM(o.amount) AS revenue FROM orders o
         JOIN products p ON p.id = o.product_id WHERE o.status = 'completed'
        GROUP BY p.category ORDER BY revenue DESC`,
      `SELECT o.id, o.amount, o.created_at FROM orders o
        WHERE o.status = 'completed' AND o.created_at >= date_trunc('month', now()) LIMIT 50`,
      `SELECT p.title, COUNT(o.id) AS order_count FROM products p
         LEFT JOIN orders o ON o.product_id = p.id AND o.status IN ('completed', 'pending')
        GROUP BY p.title ORDER BY order_count DESC LIMIT 10`,
      `WITH m AS (
          SELECT date_trunc('month', created_at) AS month, SUM(amount) AS revenue
            FROM orders WHERE status = 'completed' GROUP BY 1)
        SELECT month, revenue, LAG(revenue) OVER (ORDER BY month) AS previous_revenue,
               ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY month)) / NULLIF(LAG(revenue) OVER (ORDER BY month), 0), 1) AS growth_pct
          FROM m ORDER BY month LIMIT 12`,
      `SELECT u.country, COUNT(DISTINCT u.id) AS customers,
              SUM(o.amount) FILTER (WHERE o.status = 'completed') AS revenue,
              CASE WHEN SUM(o.amount) > 1000 THEN 'high' ELSE 'low' END AS tier,
              COALESCE(AVG(o.amount), 0)::numeric(12,2) AS avg_amount,
              EXTRACT(YEAR FROM MIN(o.created_at)) AS first_year
         FROM users u LEFT JOIN orders o ON o.user_id = u.id
        WHERE o.created_at >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY u.country HAVING COUNT(o.id) > 0 ORDER BY revenue DESC NULLS LAST LIMIT 20`,
      `SELECT u.name FROM users u WHERE EXISTS (
          SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.amount > (SELECT AVG(amount) FROM orders))
        LIMIT 10`,
      `SELECT title FROM products UNION SELECT name FROM users LIMIT 5`,
      `SELECT x.category, x.revenue FROM (
          SELECT p.category, SUM(o.amount) AS revenue FROM orders o JOIN products p ON p.id = o.product_id GROUP BY p.category
        ) AS x ORDER BY x.revenue DESC LIMIT 4`,
      `SELECT name FROM users WHERE country ILIKE 'united%' AND name LIKE '%a%' LIMIT 3`,
      `SELECT COUNT(*) AS order_count FROM orders;`,
    ];

    it.each(valid)('accepts: %s', (sql) => {
      const r = validator.validate(sql);
      expect(r.violations).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.sql).toBeDefined();
    });

    it('reports the tables used', () => {
      const r = validator.validate(valid[0]);
      expect(r.tables.sort()).toEqual(['orders', 'users']);
      expect(r.checks.every((c) => c.passed)).toBe(true);
    });
  });

  describe('row limits', () => {
    it('injects LIMIT when missing and revalidates the final SQL', () => {
      const r = validator.validate('SELECT id FROM orders');
      expect(r.ok).toBe(true);
      expect(r.limitInjected).toBe(true);
      expect(r.sql).toBe(
        `SELECT id FROM orders\nLIMIT ${SQL_POLICY.maxRowLimit}`,
      );
    });

    it('keeps an existing safe LIMIT unchanged', () => {
      const r = validator.validate('SELECT id FROM orders LIMIT 5');
      expect(r.sql).toBe('SELECT id FROM orders LIMIT 5');
      expect(r.limitInjected).toBe(false);
    });

    it('clamps an oversized LIMIT to the maximum', () => {
      const r = validator.validate('SELECT id FROM orders LIMIT 100000');
      expect(r.ok).toBe(true);
      expect(r.sql).toBe(
        `SELECT id FROM orders LIMIT ${SQL_POLICY.maxRowLimit}`,
      );
    });

    it('clamps correctly after multi-byte characters (byte offsets)', () => {
      const r = validator.validate(
        "SELECT name FROM users WHERE country = 'Müller–São' LIMIT 9999",
      );
      expect(r.sql).toBe(
        `SELECT name FROM users WHERE country = 'Müller–São' LIMIT ${SQL_POLICY.maxRowLimit}`,
      );
    });

    it('a trailing line comment cannot swallow the injected LIMIT', () => {
      const r = validator.validate('SELECT id FROM orders -- no limit please');
      expect(r.ok).toBe(true);
      expect(r.sql!.endsWith(`\nLIMIT ${SQL_POLICY.maxRowLimit}`)).toBe(true);
    });

    it('applies the limit to a whole UNION', () => {
      const r = validator.validate(
        'SELECT title FROM products UNION ALL SELECT name FROM users',
      );
      expect(r.sql).toContain(`LIMIT ${SQL_POLICY.maxRowLimit}`);
    });

    it('rejects LIMIT ALL and non-constant limits', () => {
      expect(codes('SELECT id FROM orders LIMIT ALL')).toContain(
        'limit_not_constant',
      );
      expect(codes('SELECT id FROM orders LIMIT (SELECT 5)')).toContain(
        'limit_not_constant',
      );
    });

    it('rejects huge OFFSET values', () => {
      expectBlocked(
        'SELECT id FROM orders LIMIT 5 OFFSET 99999999',
        'limit_offset_too_large',
        'complexity',
      );
    });
  });

  describe('statement types (write operations / DDL)', () => {
    it.each([
      [
        "INSERT INTO orders (user_id, product_id, amount, status) VALUES (1, 1, 1, 'completed')",
        'INSERT',
      ],
      ["UPDATE orders SET status = 'cancelled'", 'UPDATE'],
      ['DELETE FROM orders', 'DELETE'],
      ['DROP TABLE orders', 'DROP'],
      ['TRUNCATE orders', 'TRUNCATE'],
      ['ALTER TABLE users ADD COLUMN x int', 'ALTER TABLE'],
      ['CREATE TABLE x (id int)', 'CREATE TABLE'],
      ['GRANT ALL ON orders TO public', 'GRANT'],
      ["COPY users TO '/tmp/users.csv'", 'COPY'],
      ['SET statement_timeout = 0', 'SET'],
      ['BEGIN', 'Transaction'],
      ['DO $$ BEGIN PERFORM pg_sleep(10); END $$', 'DO'],
      ['EXPLAIN ANALYZE SELECT * FROM orders', 'EXPLAIN'],
      [
        "CREATE FUNCTION f() RETURNS int AS 'select 1' LANGUAGE sql",
        'CREATE FUNCTION',
      ],
    ])('blocks %s', (sql, label) => {
      const r = expectBlocked(sql, 'statement_not_allowed');
      expect(r.violations[0].message).toContain(label);
    });

    it('blocks SELECT INTO (creates a table)', () => {
      expectBlocked('SELECT id INTO stolen FROM users', 'into_not_allowed');
    });

    it('blocks row locking clauses', () => {
      expectBlocked('SELECT id FROM orders FOR UPDATE', 'locking_not_allowed');
      expectBlocked('SELECT id FROM orders FOR SHARE', 'locking_not_allowed');
    });

    it('blocks data-modifying CTEs', () => {
      expectBlocked(
        'WITH d AS (DELETE FROM orders RETURNING id) SELECT id FROM d',
        'statement_not_allowed',
      );
    });
  });

  describe('multiple statements & SQL injection payloads', () => {
    it.each([
      'SELECT id FROM users; DROP TABLE users',
      'SELECT id FROM users; SELECT id FROM orders',
      "SELECT name FROM users WHERE name = '' ; DELETE FROM orders; --'",
      'SELECT 1;; SELECT 2',
    ])('blocks stacked queries: %s', (sql) => {
      expectBlocked(sql, 'multiple_statements');
    });

    it('treats injected text inside a string literal as data, not SQL', () => {
      const r = validator.validate(
        "SELECT name FROM users WHERE name = 'x''; DROP TABLE users; --' LIMIT 1",
      );
      expect(r.ok).toBe(true); // a single SELECT with a harmless literal
    });

    it('blocks classic tautology + UNION exfiltration of other tables', () => {
      expectBlocked(
        "SELECT name FROM users WHERE name = '' OR 1=1 UNION SELECT usename FROM pg_user",
        'table_not_allowed',
      );
    });

    it('blocks bind parameters', () => {
      expectBlocked(
        'SELECT name FROM users WHERE id = $1',
        'construct_not_allowed',
      );
    });

    it('reports syntax errors as correctable', () => {
      const r = validator.validate('SELEC name FROM users');
      expect(r.ok).toBe(false);
      expect(r.violations[0]).toMatchObject({
        code: 'syntax_error',
        category: 'correctable',
      });
      expect(SqlValidatorService.isCorrectable(r)).toBe(true);
    });

    it('rejects empty and over-long input', () => {
      expect(codes('   ')).toContain('empty');
      expectBlocked(
        `SELECT name FROM users WHERE name = '${'a'.repeat(6000)}'`,
        'too_long',
        'complexity',
      );
    });
  });

  describe('unauthorized tables', () => {
    it.each([
      'SELECT usename, passwd FROM pg_shadow',
      'SELECT rolname FROM pg_catalog.pg_roles',
      'SELECT table_name FROM information_schema.tables',
      'SELECT email FROM auth.users',
      'SELECT id FROM public._prisma_migrations',
      'SELECT id FROM secrets',
      'SELECT id FROM other_db.public.users',
      'SELECT o.id FROM orders o JOIN pg_stat_activity a ON true',
    ])('blocks %s', (sql) => {
      expectBlocked(sql, 'table_not_allowed');
    });

    it('blocks unauthorized tables hidden in subqueries and CTEs', () => {
      expectBlocked(
        'SELECT id FROM orders WHERE user_id IN (SELECT usesysid FROM pg_user)',
        'table_not_allowed',
      );
      expectBlocked(
        'WITH x AS (SELECT rolname FROM pg_roles) SELECT rolname FROM x',
        'table_not_allowed',
      );
      expectBlocked(
        'SELECT n FROM (SELECT relname AS n FROM pg_class) t',
        'table_not_allowed',
      );
    });

    it('blocks functions in FROM', () => {
      expectBlocked(
        'SELECT g FROM generate_series(1, 100000000) g',
        'construct_not_allowed',
      );
      expectBlocked(
        "SELECT * FROM pg_read_file('/etc/passwd')",
        'construct_not_allowed',
      );
    });

    it('blocks LATERAL subqueries', () => {
      expectBlocked(
        'SELECT o.id FROM orders o, LATERAL (SELECT 1 AS one) l',
        'construct_not_allowed',
      );
    });
  });

  describe('unauthorized columns (PII)', () => {
    it.each([
      'SELECT email FROM users',
      'SELECT u.email FROM users u',
      "SELECT name FROM users WHERE email LIKE '%@gmail.com'",
      'SELECT u.name FROM users u ORDER BY u.email',
      'SELECT COUNT(DISTINCT email) FROM users',
      'SELECT x.e FROM (SELECT email AS e FROM users) x',
      "SELECT o.id FROM orders o WHERE EXISTS (SELECT 1 FROM users u WHERE u.email = 'a@b.c')",
    ])('blocks restricted column: %s', (sql) => {
      expectBlocked(sql, 'restricted_column');
    });

    it('blocks SELECT * and table.*', () => {
      expectBlocked('SELECT * FROM users', 'select_star', 'correctable');
      expectBlocked('SELECT u.* FROM users u', 'select_star', 'correctable');
    });

    it('blocks whole-row references that would expose every column', () => {
      expectBlocked('SELECT u FROM users u', 'whole_row_reference');
      expectBlocked(
        'SELECT row_to_json(u) FROM users u',
        'function_not_allowed',
      );
      expectBlocked('SELECT (u).email FROM users u', 'construct_not_allowed');
    });

    it('treats non-existent columns as correctable model mistakes', () => {
      const r = expectBlocked(
        'SELECT o.total FROM orders o',
        'unknown_column',
        'correctable',
      );
      expect(r.violations[0].message).toContain('Available columns');
      expect(SqlValidatorService.isCorrectable(r)).toBe(true);
    });

    it('rejects system columns', () => {
      expectBlocked(
        'SELECT ctid, xmin FROM orders',
        'unknown_column',
        'correctable',
      );
    });

    it('allows output aliases in ORDER BY but not in WHERE', () => {
      expect(
        validator.validate('SELECT amount AS a FROM orders ORDER BY a LIMIT 1')
          .ok,
      ).toBe(true);
      expect(
        codes('SELECT amount AS a FROM orders WHERE a > 1 LIMIT 1'),
      ).toContain('unknown_column');
    });
  });

  describe('dangerous functions, casts and operators', () => {
    it.each([
      ['SELECT pg_sleep(30)', 'pg_sleep'],
      ["SELECT pg_read_file('/etc/passwd')", 'pg_read_file'],
      ["SELECT current_setting('server_version')", 'current_setting'],
      ["SELECT set_config('statement_timeout', '0', false)", 'set_config'],
      ["SELECT dblink('host=evil', 'select 1')", 'dblink'],
      ["SELECT lo_import('/etc/passwd')", 'lo_import'],
      ['SELECT version()', 'version'],
      ['SELECT pg_catalog.pg_sleep(1)', 'pg_sleep'],
      ["SELECT repeat('x', 100000000)", 'repeat'],
      ['SELECT public.my_func()', 'public.my_func'],
      [
        "SELECT query_to_xml('select * from pg_shadow', true, true, '')",
        'query_to_xml',
      ],
    ])('blocks %s', (sql, fname) => {
      const r = expectBlocked(sql, 'function_not_allowed');
      expect(
        r.violations.find((v) => v.code === 'function_not_allowed')!.message,
      ).toContain(fname);
    });

    it('blocks session information functions', () => {
      expectBlocked('SELECT current_user', 'value_function_not_allowed');
      expectBlocked('SELECT session_user', 'value_function_not_allowed');
    });

    it('blocks catalog casts such as regclass', () => {
      expectBlocked("SELECT 'pg_authid'::regclass", 'cast_not_allowed');
      expectBlocked(
        'SELECT tableoid::regclass FROM orders',
        'cast_not_allowed',
      );
    });

    it('blocks regex operators (ReDoS) and qualified operators', () => {
      expectBlocked(
        "SELECT name FROM users WHERE name ~ '(a+)+$'",
        'operator_not_allowed',
      );
      expectBlocked(
        "SELECT name FROM users WHERE name SIMILAR TO '%a%'",
        'operator_not_allowed',
      );
      expectBlocked(
        'SELECT id FROM orders WHERE id OPERATOR(pg_catalog.=) 1',
        'operator_not_allowed',
      );
    });

    it('blocks dangerous functions nested deep inside expressions', () => {
      expectBlocked(
        "SELECT CASE WHEN (SELECT COUNT(*) FROM orders) > 0 THEN pg_sleep(5)::text ELSE 'x' END",
        'function_not_allowed',
      );
      expectBlocked(
        'SELECT SUM(amount) FILTER (WHERE pg_sleep(1) IS NULL) FROM orders',
        'function_not_allowed',
      );
    });
  });

  describe('complexity restrictions', () => {
    it('blocks recursive CTEs', () => {
      expectBlocked(
        'WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM r) SELECT n FROM r',
        'recursive_cte',
        'complexity',
      );
    });

    it('limits the number of joins', () => {
      const sql = `SELECT o1.id FROM orders o1
        JOIN orders o2 ON o2.id = o1.id JOIN orders o3 ON o3.id = o1.id
        JOIN orders o4 ON o4.id = o1.id JOIN orders o5 ON o5.id = o1.id
        JOIN orders o6 ON o6.id = o1.id`;
      expectBlocked(sql, 'too_many_joins', 'complexity');
    });

    it('counts comma-separated cross joins toward the join limit', () => {
      expectBlocked(
        'SELECT COUNT(*) FROM orders a, orders b, orders c, orders d, orders e, orders f',
        'too_many_joins',
        'complexity',
      );
    });

    it('limits subquery depth', () => {
      const sql = `SELECT id FROM orders WHERE id IN (SELECT id FROM orders WHERE id IN (
        SELECT id FROM orders WHERE id IN (SELECT id FROM orders WHERE id IN (SELECT id FROM orders))))`;
      expectBlocked(sql, 'too_deep', 'complexity');
    });

    it('blocks GROUPING SETS / CUBE', () => {
      expectBlocked(
        'SELECT status, COUNT(*) FROM orders GROUP BY CUBE (status)',
        'grouping_sets',
        'complexity',
      );
    });

    it('limits overall AST size', () => {
      const terms = Array.from({ length: 250 }, (_, i) => `amount + ${i}`).join(
        ' + ',
      );
      expectBlocked(
        `SELECT ${terms} AS x FROM orders`,
        'too_complex',
        'complexity',
      );
    });
  });

  it('security violations are never classified as correctable', () => {
    const r = validator.validate('SELECT email FROM users; DROP TABLE users');
    expect(SqlValidatorService.isCorrectable(r)).toBe(false);
    const r2 = validator.validate('SELECT o.total, pg_sleep(1) FROM orders o');
    expect(SqlValidatorService.isCorrectable(r2)).toBe(false); // mixed → not correctable
  });
});
