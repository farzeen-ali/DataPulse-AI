/**
 * Deterministic SQL policy. Everything here is an ALLOWLIST: a construct that
 * is not listed is rejected. Keep this file small and reviewable.
 */

export const SQL_POLICY = {
  maxSqlLength: 5000,
  maxRowLimit: 200,
  maxOffset: 10_000,
  maxAstNodes: 600,
  maxJoins: 4,
  maxSubqueryDepth: 3,
  maxCtes: 4,
  maxSelects: 10,
} as const;

/** Functions the model may call (lower-case, optionally `pg_catalog.` qualified). */
export const ALLOWED_FUNCTIONS = new Set<string>([
  // aggregates
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'stddev',
  'stddev_samp',
  'stddev_pop',
  'variance',
  'bool_and',
  'bool_or',
  'string_agg',
  'percentile_cont',
  'percentile_disc',
  // window functions
  'row_number',
  'rank',
  'dense_rank',
  'percent_rank',
  'cume_dist',
  'ntile',
  'lag',
  'lead',
  'first_value',
  'last_value',
  // math
  'round',
  'abs',
  'ceil',
  'ceiling',
  'floor',
  'trunc',
  'sign',
  'mod',
  // date / time
  'date_trunc',
  'date_part',
  'extract',
  'now',
  'age',
  'to_char',
  'make_date',
  'timezone',
  'justify_days',
  'justify_interval',
  // text
  'lower',
  'upper',
  'initcap',
  'concat',
  'concat_ws',
  'length',
  'char_length',
  'btrim',
  'ltrim',
  'rtrim',
  'substring',
  'substr',
  'left',
  'right',
  'split_part',
  'position',
  'strpos',
]);

/** Aggregates whose `count(*)` style star argument is acceptable. */
export const STAR_AGGREGATES = new Set(['count']);

/** Types allowed in casts (`x::numeric`, `CAST(x AS date)`). */
export const ALLOWED_CAST_TYPES = new Set<string>([
  'int2',
  'int4',
  'int8',
  'integer',
  'int',
  'bigint',
  'smallint',
  'numeric',
  'decimal',
  'float4',
  'float8',
  'real',
  'double precision',
  'text',
  'varchar',
  'bpchar',
  'date',
  'timestamp',
  'timestamptz',
  'interval',
  'bool',
  'boolean',
]);

/** Binary / unary operators (as the parser normalises them). */
export const ALLOWED_OPERATORS = new Set<string>([
  '=',
  '<>',
  '<',
  '>',
  '<=',
  '>=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '||',
  '~~', // LIKE
  '!~~', // NOT LIKE
  '~~*', // ILIKE
  '!~~*', // NOT ILIKE
]);

export const ALLOWED_A_EXPR_KINDS = new Set<string>([
  'AEXPR_OP',
  'AEXPR_IN',
  'AEXPR_LIKE',
  'AEXPR_ILIKE',
  'AEXPR_BETWEEN',
  'AEXPR_NOT_BETWEEN',
  'AEXPR_NULLIF',
  'AEXPR_DISTINCT',
  'AEXPR_NOT_DISTINCT',
]);

export const ALLOWED_SQL_VALUE_FUNCTIONS = new Set<string>([
  'SVFOP_CURRENT_DATE',
  'SVFOP_CURRENT_TIME',
  'SVFOP_CURRENT_TIME_N',
  'SVFOP_CURRENT_TIMESTAMP',
  'SVFOP_CURRENT_TIMESTAMP_N',
  'SVFOP_LOCALTIME',
  'SVFOP_LOCALTIME_N',
  'SVFOP_LOCALTIMESTAMP',
  'SVFOP_LOCALTIMESTAMP_N',
]);

export const ALLOWED_SUBLINK_TYPES = new Set<string>([
  'EXISTS_SUBLINK',
  'ANY_SUBLINK',
  'ALL_SUBLINK',
  'EXPR_SUBLINK',
]);

export const ALLOWED_JOIN_TYPES = new Set<string>([
  'JOIN_INNER',
  'JOIN_LEFT',
  'JOIN_RIGHT',
  'JOIN_FULL',
]);

/** Human readable names for rejected top-level statement types. */
export const STATEMENT_LABELS: Record<string, string> = {
  InsertStmt: 'INSERT (write operation)',
  UpdateStmt: 'UPDATE (write operation)',
  DeleteStmt: 'DELETE (write operation)',
  MergeStmt: 'MERGE (write operation)',
  TruncateStmt: 'TRUNCATE (write operation)',
  CopyStmt: 'COPY (file / data transfer)',
  CreateStmt: 'CREATE TABLE (DDL)',
  CreateTableAsStmt: 'CREATE TABLE AS (DDL)',
  DropStmt: 'DROP (DDL)',
  AlterTableStmt: 'ALTER TABLE (DDL)',
  GrantStmt: 'GRANT / REVOKE (privileges)',
  GrantRoleStmt: 'GRANT ROLE (privileges)',
  CreateRoleStmt: 'CREATE ROLE (privileges)',
  AlterRoleStmt: 'ALTER ROLE (privileges)',
  VariableSetStmt: 'SET (session configuration)',
  TransactionStmt: 'Transaction control',
  DoStmt: 'DO block (procedural code)',
  CreateFunctionStmt: 'CREATE FUNCTION (DDL)',
  CallStmt: 'CALL (procedure)',
  ExplainStmt: 'EXPLAIN',
  VacuumStmt: 'VACUUM',
  LockStmt: 'LOCK',
  ListenStmt: 'LISTEN',
  NotifyStmt: 'NOTIFY',
  PrepareStmt: 'PREPARE',
  ExecuteStmt: 'EXECUTE',
};
