import {
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { AppError } from '../common/app-error';
import type { AppEnv } from '../config/configuration';
import { PrismaClient } from '../generated/prisma/client';
import { ANALYTICS_TABLES } from '../analytics/schema/schema-catalog';
import { buildPoolConfig, connectionUser } from './pg-connection';

export interface RoleStatus {
  checked: boolean;
  safe: boolean;
  role?: string;
  reasons: string[];
  checkedAt?: number;
}

/** Roles that must never run AI-generated SQL. */
const PRIVILEGED_ROLES = new Set([
  'postgres',
  'supabase_admin',
  'service_role',
  'authenticator',
  'supabase_auth_admin',
  'supabase_storage_admin',
  'supabase_replication_admin',
  'supabase_read_only_user',
  'dashboard_user',
  'pgbouncer',
]);

/**
 * Owns the runtime database connection. The pool authenticates as the
 * least-privilege analytics role (SUPABASE_DATABASE_URL). Prisma shares the
 * same pool through the pg driver adapter, so the whole runtime has exactly
 * the privileges of that role.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  readonly pool: Pool | null;
  readonly prisma: PrismaClient | null;
  private status: RoleStatus = { checked: false, safe: false, reasons: [] };

  constructor(private readonly config: ConfigService<AppEnv, true>) {
    const url = this.config.get('SUPABASE_DATABASE_URL', { infer: true });
    if (!url) {
      this.pool = null;
      this.prisma = null;
      this.status = {
        checked: true,
        safe: false,
        reasons: ['SUPABASE_DATABASE_URL is not configured.'],
      };
      return;
    }

    this.pool = new Pool({
      ...buildPoolConfig(
        url,
        this.config.get('DATABASE_SSL', { infer: true }),
        this.config.get('DATABASE_CA_CERT', { infer: true }),
      ),
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8_000,
      application_name: 'datapulse-analytics',
    });
    // An idle client error must never crash the process.
    this.pool.on('error', (err) =>
      this.logger.warn(`Idle client error: ${err.message}`),
    );
    this.prisma = new PrismaClient({ adapter: new PrismaPg(this.pool) });
  }

  get configured(): boolean {
    return this.pool !== null;
  }

  async onModuleInit() {
    if (!this.pool) {
      this.logger.warn(
        'SUPABASE_DATABASE_URL not set — analytics queries are disabled.',
      );
      return;
    }
    const status = await this.verifyRole();
    if (status.safe) {
      this.logger.log(`Connected as least-privilege role "${status.role}".`);
    } else {
      this.logger.error(
        `AI SQL execution DISABLED: ${status.reasons.join(' ')}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.prisma?.$disconnect().catch(() => undefined);
    await this.pool?.end().catch(() => undefined);
  }

  async ping(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  getRoleStatus(): RoleStatus {
    return this.status;
  }

  /**
   * Deterministically verify that the runtime role is least-privilege before
   * any AI-generated SQL runs. Failures are cached briefly so a database that
   * comes online later is picked up.
   */
  async verifyRole(force = false): Promise<RoleStatus> {
    if (!this.pool) return this.status;
    const fresh =
      this.status.checkedAt &&
      Date.now() - this.status.checkedAt <
        (this.status.safe ? 300_000 : 15_000);
    if (!force && this.status.checked && fresh) return this.status;

    const reasons: string[] = [];
    let role: string | undefined;
    try {
      const tables = ANALYTICS_TABLES.map((t) => t.name);
      const restricted = ANALYTICS_TABLES.flatMap((t) =>
        t.restrictedColumns.map((c) => ({ table: t.name, column: c })),
      );

      const { rows } = await this.pool.query<{
        role: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        rolcreaterole: boolean;
        rolcreatedb: boolean;
        rolreplication: boolean;
        owns_or_member_of_owner: boolean;
        can_write: boolean;
        member_of: number;
        missing_tables: number;
      }>(
        `SELECT current_user AS role,
                r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb, r.rolreplication,
                EXISTS (
                  SELECT 1 FROM pg_tables pt
                  WHERE pt.schemaname = 'public' AND pt.tablename = ANY($1::text[])
                    AND pg_has_role(current_user, pt.tableowner, 'MEMBER')
                ) AS owns_or_member_of_owner,
                COALESCE((
                  SELECT bool_or(has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
                ), false) AS can_write,
                (SELECT count(*)::int FROM pg_auth_members m WHERE m.member = r.oid) AS member_of,
                (SELECT count(*)::int FROM unnest($1::text[]) t(name)
                  WHERE to_regclass('public.' || quote_ident(t.name)) IS NULL) AS missing_tables
         FROM pg_roles r WHERE r.rolname = current_user`,
        [tables],
      );
      const r = rows[0];
      role = r?.role;
      if (!r) reasons.push('Could not inspect the database role.');
      else {
        if (PRIVILEGED_ROLES.has(r.role))
          reasons.push(`Role "${r.role}" is a privileged/owner role.`);
        if (r.rolsuper) reasons.push('Role is a superuser.');
        if (r.rolbypassrls) reasons.push('Role bypasses row level security.');
        if (r.rolcreaterole || r.rolcreatedb || r.rolreplication)
          reasons.push('Role has administrative attributes.');
        if (r.owns_or_member_of_owner)
          reasons.push(
            'Role owns (or can become the owner of) analytics tables.',
          );
        if (r.can_write)
          reasons.push('Role has write privileges on analytics tables.');
        if (r.member_of > 0) reasons.push('Role is a member of other roles.');
        if (r.missing_tables > 0)
          reasons.push('Analytics tables are missing — run the migrations.');
      }

      if (r && r.missing_tables === 0) {
        for (const { table, column } of restricted) {
          const res = await this.pool.query<{ allowed: boolean }>(
            `SELECT has_column_privilege(current_user, $1::regclass, $2, 'SELECT') AS allowed`,
            [`public.${table}`, column],
          );
          if (res.rows[0]?.allowed)
            reasons.push(`Role can read restricted column ${table}.${column}.`);
        }
      }

      const directUser = connectionUser(
        this.config.get('SUPABASE_DIRECT_URL', { infer: true }),
      );
      if (directUser && role && directUser === role) {
        reasons.push('Runtime and migration connections use the same role.');
      }
    } catch (err) {
      reasons.push(
        `Database is unreachable or not migrated (${err instanceof Error ? err.message.slice(0, 120) : 'unknown error'}).`,
      );
    }

    this.status = {
      checked: true,
      safe: reasons.length === 0,
      role,
      reasons,
      checkedAt: Date.now(),
    };
    return this.status;
  }

  /** Throws unless AI-generated SQL may be executed on this connection. */
  async assertSafeForAiSql(): Promise<Pool> {
    if (!this.pool) {
      throw new AppError(
        'DATABASE_UNAVAILABLE',
        'The analytics database is not configured.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const status = await this.verifyRole();
    if (!status.safe) {
      const unreachable = status.reasons.some((r) =>
        r.startsWith('Database is unreachable'),
      );
      throw new AppError(
        unreachable ? 'DATABASE_UNAVAILABLE' : 'UNSAFE_DATABASE_ROLE',
        unreachable
          ? 'The analytics database is currently unreachable.'
          : 'Query execution is disabled because the database connection is not a least-privilege, read-only role.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.pool;
  }
}
