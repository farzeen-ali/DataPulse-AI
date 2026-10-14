/**
 * Creates / updates the least-privilege PostgreSQL role used to execute
 * AI-generated SQL.
 *
 *   npm run db:setup-role
 *
 * Requires (in backend/.env):
 *   SUPABASE_DIRECT_URL     owner connection (postgres user) — used ONLY here and by Prisma migrate
 *   ANALYTICS_DB_PASSWORD   password for the analytics role (choose a long random value)
 *
 * What the role can do:
 *   - LOGIN, nothing else (no superuser, createdb, createrole, replication, bypassrls)
 *   - USAGE on schema public
 *   - SELECT on the approved columns only (users.email is NOT granted)
 *   - read through RLS policies limited to SELECT
 *   - every session defaults to read-only transactions with a statement timeout
 */
import 'dotenv/config';
import { Client, escapeIdentifier, escapeLiteral } from 'pg';
import { ANALYTICS_TABLES } from '../../src/analytics/schema/schema-catalog';
import { buildPoolConfig, SslMode } from '../../src/database/pg-connection';

export const ANALYTICS_ROLE = process.env.ANALYTICS_DB_ROLE ?? 'datapulse_analytics';

export function analyticsRoleSql(role: string, password: string): string[] {
  const r = escapeIdentifier(role);
  const statements: string[] = [
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${escapeLiteral(role)}) THEN
         CREATE ROLE ${r} LOGIN;
       END IF;
     END $$`,
    // New roles default to NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
    // NOBYPASSRLS. They are not restated: on Supabase (PostgreSQL 16+) the
    // non-superuser `postgres` role may not touch attributes it lacks itself.
    // The API re-verifies all of them at runtime (DatabaseService.verifyRole).
    `ALTER ROLE ${r} WITH LOGIN NOINHERIT CONNECTION LIMIT 20 PASSWORD ${escapeLiteral(password)}`,
    `ALTER ROLE ${r} SET default_transaction_read_only = on`,
    `ALTER ROLE ${r} SET statement_timeout = '5s'`,
    `ALTER ROLE ${r} SET lock_timeout = '1s'`,
    `ALTER ROLE ${r} SET idle_in_transaction_session_timeout = '10s'`,
    `ALTER ROLE ${r} SET search_path = pg_catalog, public`,
    // Start from zero, then grant exactly what is needed.
    `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${r}`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${r}`,
    `REVOKE CREATE ON SCHEMA public FROM ${r}`,
    `GRANT USAGE ON SCHEMA public TO ${r}`,
  ];

  for (const table of ANALYTICS_TABLES) {
    const t = escapeIdentifier(table.name);
    const cols = table.columns.map((c) => escapeIdentifier(c.name)).join(', ');
    const policy = escapeIdentifier(`${role}_read_${table.name}`);
    statements.push(
      `GRANT SELECT (${cols}) ON TABLE public.${t} TO ${r}`,
      `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`,
      `DROP POLICY IF EXISTS ${policy} ON public.${t}`,
      `CREATE POLICY ${policy} ON public.${t} AS PERMISSIVE FOR SELECT TO ${r} USING (true)`,
    );
  }
  return statements;
}

async function main() {
  const url = process.env.SUPABASE_DIRECT_URL;
  const password = process.env.ANALYTICS_DB_PASSWORD;
  if (!url) throw new Error('SUPABASE_DIRECT_URL is not set.');
  if (!password || password.length < 16) {
    throw new Error('ANALYTICS_DB_PASSWORD must be set (at least 16 characters).');
  }

  const client = new Client(
    buildPoolConfig(
      url,
      (process.env.DATABASE_SSL as SslMode) ?? 'require',
      process.env.DATABASE_CA_CERT,
    ),
  );
  await client.connect();
  try {
    await client.query('BEGIN');
    for (const sql of analyticsRoleSql(ANALYTICS_ROLE, password)) {
      await client.query(sql);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }

  console.log(`✔ Role "${ANALYTICS_ROLE}" is configured with read-only, column-level access.`);
  console.log('  Use it in SUPABASE_DATABASE_URL, e.g.');
  console.log(
    `  postgresql://${ANALYTICS_ROLE}.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('✖ Failed to configure analytics role:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
