import { Injectable, OnModuleInit } from '@nestjs/common';
import { loadModule, parseSync } from 'libpg-query';
import {
  ALLOWED_TABLES,
  approvedColumns,
  getTable,
  restrictedColumns,
} from '../schema/schema-catalog';
import {
  ALLOWED_A_EXPR_KINDS,
  ALLOWED_CAST_TYPES,
  ALLOWED_FUNCTIONS,
  ALLOWED_JOIN_TYPES,
  ALLOWED_OPERATORS,
  ALLOWED_SQL_VALUE_FUNCTIONS,
  ALLOWED_SUBLINK_TYPES,
  SQL_POLICY,
  STAR_AGGREGATES,
  STATEMENT_LABELS,
} from './sql-policy';

/**
 * - security:    unsafe / unauthorized. Never retried, never executed.
 * - complexity:  too expensive. Never retried.
 * - correctable: honest model mistakes (syntax, hallucinated column). The
 *                pipeline may ask the model to fix these (max 2 retries).
 */
export type ViolationCategory = 'security' | 'complexity' | 'correctable';

export interface SqlViolation {
  code: string;
  category: ViolationCategory;
  message: string;
}

export interface SecurityCheck {
  id: string;
  label: string;
  passed: boolean;
}

export interface SqlValidationResult {
  ok: boolean;
  /** Final SQL to execute (row limit enforced). Only set when ok. */
  sql?: string;
  violations: SqlViolation[];
  checks: SecurityCheck[];
  tables: string[];
  rowLimit: number;
  limitInjected: boolean;
}

type Ast = Record<string, unknown>;

interface Relation {
  alias: string;
  kind: 'table' | 'derived';
  table?: string;
  columns: Set<string>;
}

interface Scope {
  relations: Relation[];
  outputAliases: Set<string>;
  parent?: Scope;
}

interface WalkState {
  violations: SqlViolation[];
  tables: Set<string>;
  nodes: number;
  joins: number;
  selects: number;
  ctes: number;
}

const isObj = (v: unknown): v is Ast =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Unwrap a `{ NodeType: {...} }` wrapper. */
function unwrap(node: unknown): [string, Ast] | null {
  if (!isObj(node)) return null;
  const keys = Object.keys(node);
  if (keys.length !== 1) return null;
  const inner = node[keys[0]];
  return isObj(inner) ? [keys[0], inner] : null;
}

/** Read a list of `{ String: { sval } }` nodes. */
function names(list: unknown): string[] {
  return asArr(list).map((n) => {
    const u = unwrap(n);
    if (u && u[0] === 'String') return str(u[1].sval);
    if (u && u[0] === 'A_Star') return '*';
    return '';
  });
}

/** Keys we understand on a SelectStmt. Anything else is rejected (fail closed). */
const SELECT_KEYS = new Set([
  'targetList',
  'fromClause',
  'whereClause',
  'groupClause',
  'groupDistinct',
  'havingClause',
  'sortClause',
  'limitCount',
  'limitOffset',
  'limitOption',
  'withClause',
  'distinctClause',
  'windowClause',
  'op',
  'all',
  'larg',
  'rarg',
]);

@Injectable()
export class SqlValidatorService implements OnModuleInit {
  private static ready: Promise<void> | null = null;

  async onModuleInit() {
    await SqlValidatorService.init();
  }

  /** The PostgreSQL parser is WebAssembly; it must be loaded once before use. */
  static init(): Promise<void> {
    SqlValidatorService.ready ??= loadModule();
    return SqlValidatorService.ready;
  }

  /**
   * Validate untrusted SQL. Returns the exact SQL that may be executed, with
   * a safe row limit enforced, or the list of violations.
   */
  validate(rawSql: string): SqlValidationResult {
    const first = this.validateOnce(rawSql);
    if (!first.ok || first.sql === undefined) return first;
    if (!first.limitInjected) return first;

    // The limit was rewritten: re-parse and re-validate the exact final text.
    const second = this.validateOnce(first.sql);
    if (!second.ok || second.limitInjected) {
      return this.fail(
        [
          {
            code: 'limit_enforcement_failed',
            category: 'security',
            message: 'Unable to enforce a safe row limit on this query.',
          },
        ],
        [],
      );
    }
    return { ...second, limitInjected: true };
  }

  private validateOnce(rawSql: string): SqlValidationResult {
    const sql = (rawSql ?? '').trim().replace(/[;\s]+$/u, '');

    if (!sql) {
      return this.fail(
        [
          {
            code: 'empty',
            category: 'correctable',
            message: 'Query is empty.',
          },
        ],
        [],
      );
    }
    if (sql.length > SQL_POLICY.maxSqlLength) {
      return this.fail(
        [
          {
            code: 'too_long',
            category: 'complexity',
            message: `Query exceeds ${SQL_POLICY.maxSqlLength} characters.`,
          },
        ],
        [],
      );
    }

    let parsed: { stmts?: unknown[] };
    try {
      parsed = parseSync(sql);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'syntax error';
      return this.fail(
        [
          {
            code: 'syntax_error',
            category: 'correctable',
            message: `PostgreSQL syntax error: ${msg.slice(0, 160)}`,
          },
        ],
        [],
      );
    }

    const stmts = asArr(parsed.stmts);
    if (stmts.length !== 1) {
      return this.fail(
        [
          {
            code: 'multiple_statements',
            category: 'security',
            message:
              stmts.length === 0
                ? 'No SQL statement found.'
                : `Exactly one statement is allowed (found ${stmts.length}).`,
          },
        ],
        ['parsed'],
      );
    }

    const top = unwrap((stmts[0] as Ast).stmt);
    if (!top || top[0] !== 'SelectStmt') {
      const kind = top?.[0] ?? 'unknown';
      return this.fail(
        [
          {
            code: 'statement_not_allowed',
            category: 'security',
            message: `Only read-only SELECT queries are allowed (got ${STATEMENT_LABELS[kind] ?? kind}).`,
          },
        ],
        ['parsed', 'single'],
      );
    }

    const state: WalkState = {
      violations: [],
      tables: new Set(),
      nodes: 0,
      joins: 0,
      selects: 0,
      ctes: 0,
    };
    const select = top[1];
    this.validateSelect(select, undefined, new Map(), 0, state);

    if (state.nodes > SQL_POLICY.maxAstNodes) {
      this.add(state, 'complexity', 'too_complex', 'Query is too complex.');
    }
    if (state.joins > SQL_POLICY.maxJoins) {
      this.add(
        state,
        'complexity',
        'too_many_joins',
        `At most ${SQL_POLICY.maxJoins} joins are allowed.`,
      );
    }
    if (state.selects > SQL_POLICY.maxSelects) {
      this.add(
        state,
        'complexity',
        'too_many_subqueries',
        'Too many subqueries.',
      );
    }

    // ---- top-level row limit ------------------------------------------------
    let finalSql = sql;
    let limitInjected = false;
    const limitCount = select.limitCount;
    if (limitCount === undefined) {
      // A newline guards against a trailing `-- comment` swallowing the limit.
      finalSql = `${sql}\nLIMIT ${SQL_POLICY.maxRowLimit}`;
      limitInjected = true;
    } else {
      const c = this.constInt(limitCount);
      if (c === null) {
        this.add(
          state,
          'correctable',
          'limit_not_constant',
          'LIMIT must be a constant integer.',
        );
      } else if (c.value > SQL_POLICY.maxRowLimit) {
        finalSql = this.replaceAtByte(
          sql,
          c.location,
          String(c.value).length,
          String(SQL_POLICY.maxRowLimit),
        );
        limitInjected = true;
      } else if (c.value < 0) {
        this.add(
          state,
          'correctable',
          'limit_negative',
          'LIMIT cannot be negative.',
        );
      }
    }

    const violations = state.violations;
    const has = (pred: (v: SqlViolation) => boolean) => violations.some(pred);
    const checks: SecurityCheck[] = [
      {
        id: 'parsed',
        label: 'Parsed by PostgreSQL parser (AST)',
        passed: true,
      },
      { id: 'single', label: 'Single statement', passed: true },
      {
        id: 'readonly',
        label: 'Read-only SELECT only',
        passed: !has((v) =>
          ['into_not_allowed', 'locking_not_allowed'].includes(v.code),
        ),
      },
      {
        id: 'tables',
        label: 'Approved tables only',
        passed: !has((v) => v.code === 'table_not_allowed'),
      },
      {
        id: 'columns',
        label: 'Approved columns only (PII blocked)',
        passed: !has((v) =>
          [
            'restricted_column',
            'whole_row_reference',
            'select_star',
            'unknown_column',
          ].includes(v.code),
        ),
      },
      {
        id: 'functions',
        label: 'Approved functions & operators only',
        passed: !has((v) =>
          [
            'function_not_allowed',
            'operator_not_allowed',
            'cast_not_allowed',
            'value_function_not_allowed',
          ].includes(v.code),
        ),
      },
      {
        id: 'constructs',
        label: 'No unsupported SQL constructs',
        passed: !has((v) => v.code === 'construct_not_allowed'),
      },
      {
        id: 'complexity',
        label: 'Complexity within limits',
        passed: !has((v) => v.category === 'complexity'),
      },
      {
        id: 'limit',
        label: `Row limit ≤ ${SQL_POLICY.maxRowLimit} enforced`,
        passed: !has((v) => v.code.startsWith('limit')),
      },
    ];

    return {
      ok: violations.length === 0,
      sql: violations.length === 0 ? finalSql : undefined,
      violations,
      checks,
      tables: [...state.tables],
      rowLimit: SQL_POLICY.maxRowLimit,
      limitInjected,
    };
  }

  // ---------------------------------------------------------------------------
  // SELECT
  // ---------------------------------------------------------------------------

  /** Returns the output column names of the SELECT. */
  private validateSelect(
    s: Ast,
    parent: Scope | undefined,
    ctesIn: Map<string, Set<string>>,
    depth: number,
    state: WalkState,
  ): string[] {
    state.selects++;
    state.nodes++;
    if (depth > SQL_POLICY.maxSubqueryDepth) {
      this.add(
        state,
        'complexity',
        'too_deep',
        `Subqueries may be nested at most ${SQL_POLICY.maxSubqueryDepth} levels.`,
      );
      return [];
    }

    if ('intoClause' in s) {
      this.add(
        state,
        'security',
        'into_not_allowed',
        'SELECT INTO creates tables and is not allowed.',
      );
    }
    if ('lockingClause' in s) {
      this.add(
        state,
        'security',
        'locking_not_allowed',
        'Row locking clauses (FOR UPDATE / SHARE) are not allowed.',
      );
    }
    if ('valuesLists' in s) {
      this.add(
        state,
        'security',
        'construct_not_allowed',
        'VALUES lists are not allowed.',
      );
    }
    for (const key of Object.keys(s)) {
      if (
        !SELECT_KEYS.has(key) &&
        !['intoClause', 'lockingClause', 'valuesLists'].includes(key)
      ) {
        this.add(
          state,
          'security',
          'construct_not_allowed',
          `Unsupported SELECT clause: ${key}.`,
        );
      }
    }
    if (
      s.limitOption !== undefined &&
      !['LIMIT_OPTION_DEFAULT', 'LIMIT_OPTION_COUNT'].includes(
        str(s.limitOption),
      )
    ) {
      this.add(
        state,
        'security',
        'construct_not_allowed',
        'FETCH ... WITH TIES is not allowed.',
      );
    }

    // CTEs ------------------------------------------------------------------
    const ctes = new Map(ctesIn);
    if (isObj(s.withClause)) {
      if (s.withClause.recursive) {
        this.add(
          state,
          'complexity',
          'recursive_cte',
          'Recursive CTEs are not allowed.',
        );
      }
      for (const c of asArr(s.withClause.ctes)) {
        const u = unwrap(c);
        if (!u || u[0] !== 'CommonTableExpr') {
          this.add(
            state,
            'security',
            'construct_not_allowed',
            'Unsupported WITH item.',
          );
          continue;
        }
        state.ctes++;
        if (state.ctes > SQL_POLICY.maxCtes) {
          this.add(
            state,
            'complexity',
            'too_many_ctes',
            `At most ${SQL_POLICY.maxCtes} CTEs are allowed.`,
          );
        }
        const cte = u[1];
        const q = unwrap(cte.ctequery);
        if (!q || q[0] !== 'SelectStmt') {
          this.add(
            state,
            'security',
            'statement_not_allowed',
            'Only SELECT is allowed inside WITH (data-modifying CTEs are blocked).',
          );
          continue;
        }
        let outputs = this.validateSelect(q[1], parent, ctes, depth + 1, state);
        const aliasCols = names(cte.aliascolnames);
        if (aliasCols.length) outputs = aliasCols;
        ctes.set(String(cte.ctename), new Set(outputs));
      }
    }

    // Set operations (UNION / INTERSECT / EXCEPT) ----------------------------
    if (s.op && s.op !== 'SETOP_NONE') {
      const left = isObj(s.larg)
        ? this.validateSelect(s.larg, parent, ctes, depth, state)
        : [];
      if (isObj(s.rarg))
        this.validateSelect(s.rarg, parent, ctes, depth, state);
      const scope: Scope = {
        relations: [{ alias: '', kind: 'derived', columns: new Set(left) }],
        outputAliases: new Set(left),
        parent,
      };
      for (const item of asArr(s.sortClause))
        this.validateSortBy(item, scope, depth, state, ctes);
      this.validateLimitConst(s.limitCount, state);
      this.validateLimitConst(s.limitOffset, state, true);
      return left;
    }

    // FROM ----------------------------------------------------------------
    const relations: Relation[] = [];
    const deferredQuals: unknown[] = [];
    // `FROM a, b, c` is an implicit cross join: count it like explicit joins.
    state.joins += Math.max(0, asArr(s.fromClause).length - 1);
    for (const item of asArr(s.fromClause)) {
      this.collectFromItem(
        item,
        parent,
        ctes,
        depth,
        state,
        relations,
        deferredQuals,
      );
    }
    const scope: Scope = { relations, outputAliases: new Set(), parent };

    for (const q of deferredQuals)
      this.validateExpr(q, scope, depth, state, ctes);

    // Target list ------------------------------------------------------------
    const outputs: string[] = [];
    for (const t of asArr(s.targetList)) {
      const u = unwrap(t);
      if (!u || u[0] !== 'ResTarget') {
        this.add(
          state,
          'security',
          'construct_not_allowed',
          'Unsupported select-list item.',
        );
        continue;
      }
      state.nodes++;
      const val = u[1].val;
      this.validateExpr(val, scope, depth, state, ctes);
      const name =
        typeof u[1].name === 'string' ? u[1].name : this.implicitName(val);
      outputs.push(name);
    }
    if (outputs.length === 0) {
      this.add(
        state,
        'correctable',
        'empty_select',
        'SELECT must list at least one column.',
      );
    }
    scope.outputAliases = new Set(outputs);

    // Remaining clauses ------------------------------------------------------
    this.validateExpr(
      s.whereClause,
      { ...scope, outputAliases: new Set() },
      depth,
      state,
      ctes,
    );
    for (const g of asArr(s.groupClause)) {
      this.validateGroupItem(g, scope, depth, state, ctes);
    }
    this.validateExpr(s.havingClause, scope, depth, state, ctes);
    for (const d of asArr(s.distinctClause)) {
      // Plain DISTINCT is represented as a list with one empty object.
      if (isObj(d) && Object.keys(d).length === 0) continue;
      this.validateExpr(d, scope, depth, state, ctes);
    }
    for (const w of asArr(s.windowClause)) {
      const u = unwrap(w);
      if (!u || u[0] !== 'WindowDef') {
        this.add(
          state,
          'security',
          'construct_not_allowed',
          'Unsupported WINDOW clause.',
        );
        continue;
      }
      this.validateWindowDef(u[1], scope, depth, state, ctes);
    }
    for (const item of asArr(s.sortClause))
      this.validateSortBy(item, scope, depth, state, ctes);

    this.validateLimitConst(s.limitCount, state);
    this.validateLimitConst(s.limitOffset, state, true);
    return outputs;
  }

  private collectFromItem(
    item: unknown,
    parent: Scope | undefined,
    ctes: Map<string, Set<string>>,
    depth: number,
    state: WalkState,
    relations: Relation[],
    deferredQuals: unknown[],
  ) {
    state.nodes++;
    const u = unwrap(item);
    if (!u) {
      this.add(
        state,
        'security',
        'construct_not_allowed',
        'Unsupported FROM item.',
      );
      return;
    }
    const [kind, n] = u;

    if (kind === 'RangeVar') {
      const relname = str(n.relname);
      const schema = n.schemaname as string | undefined;
      const alias = isObj(n.alias) ? String(n.alias.aliasname) : relname;
      if (isObj(n.alias) && 'colnames' in n.alias) {
        this.add(
          state,
          'correctable',
          'alias_columns',
          'Column aliases on tables are not supported; alias columns in the SELECT list instead.',
        );
      }

      if (!schema && ctes.has(relname)) {
        relations.push({ alias, kind: 'derived', columns: ctes.get(relname)! });
        return;
      }
      if (n.catalogname || (schema && schema !== 'public')) {
        this.add(
          state,
          'security',
          'table_not_allowed',
          `Access to "${schema ? `${schema}.` : ''}${relname}" is not allowed. Only the approved analytics tables can be queried.`,
        );
        return;
      }
      if (!ALLOWED_TABLES.has(relname)) {
        this.add(
          state,
          'security',
          'table_not_allowed',
          `Table "${relname}" is not an approved analytics table.`,
        );
        return;
      }
      state.tables.add(relname);
      relations.push({
        alias,
        kind: 'table',
        table: relname,
        columns: approvedColumns(relname),
      });
      return;
    }

    if (kind === 'RangeSubselect') {
      if (n.lateral) {
        this.add(
          state,
          'security',
          'construct_not_allowed',
          'LATERAL subqueries are not allowed.',
        );
        return;
      }
      const q = unwrap(n.subquery);
      if (!q || q[0] !== 'SelectStmt') {
        this.add(
          state,
          'security',
          'statement_not_allowed',
          'Only SELECT subqueries are allowed.',
        );
        return;
      }
      let outputs = this.validateSelect(q[1], parent, ctes, depth + 1, state);
      const alias = isObj(n.alias) ? String(n.alias.aliasname) : '';
      if (isObj(n.alias) && 'colnames' in n.alias)
        outputs = names(n.alias.colnames);
      relations.push({ alias, kind: 'derived', columns: new Set(outputs) });
      return;
    }

    if (kind === 'JoinExpr') {
      state.joins++;
      if (!ALLOWED_JOIN_TYPES.has(String(n.jointype))) {
        this.add(
          state,
          'security',
          'construct_not_allowed',
          `Join type ${String(n.jointype)} is not allowed.`,
        );
      }
      if (n.isNatural) {
        this.add(
          state,
          'correctable',
          'natural_join',
          'NATURAL JOIN is not allowed; use explicit ON conditions.',
        );
      }
      if (isObj(n.alias) || n.join_using_alias) {
        this.add(
          state,
          'correctable',
          'join_alias',
          'Aliasing a whole join is not supported.',
        );
      }
      this.collectFromItem(
        n.larg,
        parent,
        ctes,
        depth,
        state,
        relations,
        deferredQuals,
      );
      this.collectFromItem(
        n.rarg,
        parent,
        ctes,
        depth,
        state,
        relations,
        deferredQuals,
      );
      if (n.quals !== undefined) deferredQuals.push(n.quals);
      for (const col of names(n.usingClause)) {
        deferredQuals.push({
          ColumnRef: { fields: [{ String: { sval: col } }] },
        });
      }
      return;
    }

    this.add(
      state,
      'security',
      'construct_not_allowed',
      kind === 'RangeFunction'
        ? 'Functions in FROM (e.g. generate_series) are not allowed.'
        : `Unsupported FROM item: ${kind}.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Expressions
  // ---------------------------------------------------------------------------

  private validateExpr(
    node: unknown,
    scope: Scope,
    depth: number,
    state: WalkState,
    ctes: Map<string, Set<string>>,
  ): void {
    if (node === undefined || node === null) return;
    state.nodes++;
    if (state.nodes > SQL_POLICY.maxAstNodes * 2) return; // hard stop on huge trees

    const u = unwrap(node);
    if (!u) {
      this.add(
        state,
        'security',
        'construct_not_allowed',
        'Unrecognised expression.',
      );
      return;
    }
    const [kind, n] = u;
    const recurse = (child: unknown) =>
      this.validateExpr(child, scope, depth, state, ctes);

    switch (kind) {
      case 'A_Const':
        return;

      case 'ColumnRef':
        this.validateColumnRef(n, scope, state);
        return;

      case 'List':
        asArr(n.items).forEach(recurse);
        return;

      case 'BoolExpr':
        asArr(n.args).forEach(recurse);
        return;

      case 'NullTest':
      case 'BooleanTest':
        recurse(n.arg);
        return;

      case 'CaseExpr':
        recurse(n.arg);
        for (const w of asArr(n.args)) {
          const cw = unwrap(w);
          if (!cw || cw[0] !== 'CaseWhen') {
            this.add(
              state,
              'security',
              'construct_not_allowed',
              'Malformed CASE expression.',
            );
            continue;
          }
          state.nodes++;
          recurse(cw[1].expr);
          recurse(cw[1].result);
        }
        recurse(n.defresult);
        return;

      case 'CoalesceExpr':
      case 'MinMaxExpr':
        asArr(n.args).forEach(recurse);
        return;

      case 'A_Expr': {
        const k = String(n.kind);
        if (!ALLOWED_A_EXPR_KINDS.has(k)) {
          this.add(
            state,
            'security',
            'operator_not_allowed',
            k === 'AEXPR_SIMILAR'
              ? 'SIMILAR TO is not allowed.'
              : `Operator form ${k} is not allowed.`,
          );
          return;
        }
        const op = names(n.name);
        if (k === 'AEXPR_OP' || k === 'AEXPR_LIKE' || k === 'AEXPR_ILIKE') {
          if (op.length !== 1 || !ALLOWED_OPERATORS.has(op[0])) {
            this.add(
              state,
              'security',
              'operator_not_allowed',
              `Operator "${op.join('.')}" is not allowed.`,
            );
          }
        }
        recurse(n.lexpr);
        recurse(n.rexpr);
        return;
      }

      case 'TypeCast':
        this.validateTypeName(n.typeName, state);
        recurse(n.arg);
        return;

      case 'FuncCall':
        this.validateFuncCall(n, scope, depth, state, ctes);
        return;

      case 'SQLValueFunction':
        if (!ALLOWED_SQL_VALUE_FUNCTIONS.has(String(n.op))) {
          this.add(
            state,
            'security',
            'value_function_not_allowed',
            `${String(n.op).replace('SVFOP_', '')} is not allowed.`,
          );
        }
        return;

      case 'SubLink': {
        const t = String(n.subLinkType);
        if (!ALLOWED_SUBLINK_TYPES.has(t)) {
          this.add(
            state,
            'security',
            'construct_not_allowed',
            `Subquery form ${t} is not allowed.`,
          );
          return;
        }
        const op = names(n.operName);
        if (op.length && (op.length !== 1 || !ALLOWED_OPERATORS.has(op[0]))) {
          this.add(
            state,
            'security',
            'operator_not_allowed',
            `Operator "${op.join('.')}" is not allowed.`,
          );
        }
        recurse(n.testexpr);
        const q = unwrap(n.subselect);
        if (!q || q[0] !== 'SelectStmt') {
          this.add(
            state,
            'security',
            'statement_not_allowed',
            'Only SELECT subqueries are allowed.',
          );
          return;
        }
        this.validateSelect(q[1], scope, ctes, depth + 1, state);
        return;
      }

      case 'ParamRef':
        this.add(
          state,
          'security',
          'construct_not_allowed',
          'Bind parameters ($1) are not allowed.',
        );
        return;

      default:
        this.add(
          state,
          'security',
          'construct_not_allowed',
          `Unsupported SQL construct: ${kind}.`,
        );
    }
  }

  private validateFuncCall(
    n: Ast,
    scope: Scope,
    depth: number,
    state: WalkState,
    ctes: Map<string, Set<string>>,
  ) {
    const parts = names(n.funcname).map((p) => p.toLowerCase());
    const fname = parts[parts.length - 1] ?? '';
    const qualifiedOk =
      parts.length === 1 || (parts.length === 2 && parts[0] === 'pg_catalog');

    if (!qualifiedOk || !ALLOWED_FUNCTIONS.has(fname)) {
      this.add(
        state,
        'security',
        'function_not_allowed',
        `Function "${parts.join('.')}" is not allowed.`,
      );
      return;
    }
    if (n.agg_star && !STAR_AGGREGATES.has(fname)) {
      this.add(
        state,
        'correctable',
        'select_star',
        `${fname}(*) is not valid.`,
      );
    }
    if (n.func_variadic) {
      this.add(
        state,
        'security',
        'construct_not_allowed',
        'VARIADIC calls are not allowed.',
      );
    }

    const recurse = (child: unknown) =>
      this.validateExpr(child, scope, depth, state, ctes);
    asArr(n.args).forEach(recurse);
    recurse(n.agg_filter);
    for (const o of asArr(n.agg_order))
      this.validateSortBy(o, scope, depth, state, ctes);
    if (isObj(n.over))
      this.validateWindowDef(n.over, scope, depth, state, ctes);
  }

  private validateWindowDef(
    w: Ast,
    scope: Scope,
    depth: number,
    state: WalkState,
    ctes: Map<string, Set<string>>,
  ) {
    state.nodes++;
    for (const p of asArr(w.partitionClause))
      this.validateExpr(p, scope, depth, state, ctes);
    for (const o of asArr(w.orderClause))
      this.validateSortBy(o, scope, depth, state, ctes);
    for (const off of [w.startOffset, w.endOffset]) {
      if (off !== undefined && this.constInt(off) === null) {
        this.add(
          state,
          'correctable',
          'window_offset',
          'Window frame offsets must be constant integers.',
        );
      }
    }
  }

  private validateSortBy(
    item: unknown,
    scope: Scope,
    depth: number,
    state: WalkState,
    ctes: Map<string, Set<string>>,
  ) {
    state.nodes++;
    const u = unwrap(item);
    if (!u || u[0] !== 'SortBy') {
      this.add(
        state,
        'security',
        'construct_not_allowed',
        'Unsupported ORDER BY item.',
      );
      return;
    }
    if (u[1].useOp) {
      this.add(
        state,
        'security',
        'operator_not_allowed',
        'ORDER BY ... USING is not allowed.',
      );
    }
    this.validateGroupItem(u[1].node, scope, depth, state, ctes);
  }

  /** GROUP BY / ORDER BY items may be positions (1, 2) or output aliases. */
  private validateGroupItem(
    node: unknown,
    scope: Scope,
    depth: number,
    state: WalkState,
    ctes: Map<string, Set<string>>,
  ) {
    const u = unwrap(node);
    if (u && u[0] === 'A_Const') return;
    if (u && ['GroupingSet', 'RollupExpr', 'CubeExpr'].includes(u[0])) {
      this.add(
        state,
        'complexity',
        'grouping_sets',
        'GROUPING SETS / ROLLUP / CUBE are not allowed.',
      );
      return;
    }
    this.validateExpr(node, scope, depth, state, ctes);
  }

  private validateColumnRef(n: Ast, scope: Scope, state: WalkState) {
    const fields = names(n.fields);
    if (fields.includes('*')) {
      this.add(
        state,
        'correctable',
        'select_star',
        'SELECT * is not allowed; list the approved columns explicitly.',
      );
      return;
    }

    if (fields.length === 1) {
      const col = fields[0];
      for (let s: Scope | undefined = scope; s; s = s.parent) {
        if (s.relations.some((r) => r.columns.has(col))) return;
        if (s === scope && s.outputAliases.has(col)) return;
      }
      this.reportMissingColumn(col, undefined, scope, state);
      return;
    }

    if (fields.length === 2) {
      const [qualifier, col] = fields;
      for (let s: Scope | undefined = scope; s; s = s.parent) {
        const rel = s.relations.find((r) => r.alias === qualifier);
        if (!rel) continue;
        if (rel.columns.has(col)) return;
        this.reportMissingColumn(col, rel, scope, state);
        return;
      }
      this.add(
        state,
        'correctable',
        'unknown_column',
        `"${qualifier}" is not a table alias in scope (in "${qualifier}.${col}").`,
      );
      return;
    }

    this.add(
      state,
      'correctable',
      'unknown_column',
      `Use table aliases instead of fully-qualified names ("${fields.join('.')}").`,
    );
  }

  private reportMissingColumn(
    col: string,
    rel: Relation | undefined,
    scope: Scope,
    state: WalkState,
  ) {
    const candidates: Relation[] = [];
    if (rel) candidates.push(rel);
    else
      for (let s: Scope | undefined = scope; s; s = s.parent)
        candidates.push(...s.relations);

    // Restricted (PII) column: security violation, never retried.
    for (const r of candidates) {
      if (
        r.kind === 'table' &&
        r.table &&
        restrictedColumns(r.table).has(col)
      ) {
        this.add(
          state,
          'security',
          'restricted_column',
          `Column "${r.table}.${col}" contains restricted personal data and cannot be queried.`,
        );
        return;
      }
    }
    // Whole-row reference (`SELECT u FROM users u`) would expose every column.
    if (!rel && candidates.some((r) => r.alias === col)) {
      this.add(
        state,
        'security',
        'whole_row_reference',
        `Whole-row reference "${col}" is not allowed; select specific columns.`,
      );
      return;
    }

    const where = rel?.table ?? rel?.alias;
    const known =
      rel?.kind === 'table' && rel.table
        ? ` Available columns: ${getTable(rel.table)!
            .columns.map((c) => c.name)
            .join(', ')}.`
        : '';
    this.add(
      state,
      'correctable',
      'unknown_column',
      `Column "${col}" does not exist${where ? ` on "${where}"` : ''}.${known}`,
    );
  }

  private validateTypeName(t: unknown, state: WalkState) {
    if (!isObj(t)) {
      this.add(state, 'security', 'cast_not_allowed', 'Malformed type cast.');
      return;
    }
    const parts = names(t.names).map((p) => p.toLowerCase());
    const base = parts[parts.length - 1] ?? '';
    const qualifiedOk =
      parts.length === 1 || (parts.length === 2 && parts[0] === 'pg_catalog');
    if (!qualifiedOk || !ALLOWED_CAST_TYPES.has(base) || t.arrayBounds) {
      this.add(
        state,
        'security',
        'cast_not_allowed',
        `Cast to type "${parts.join('.')}" is not allowed.`,
      );
    }
    for (const m of asArr(t.typmods)) {
      if (this.constInt(m) === null) {
        this.add(
          state,
          'security',
          'cast_not_allowed',
          'Type modifiers must be constants.',
        );
      }
    }
  }

  private validateLimitConst(
    node: unknown,
    state: WalkState,
    isOffset = false,
  ) {
    if (node === undefined) return;
    const c = this.constInt(node);
    const label = isOffset ? 'OFFSET' : 'LIMIT';
    if (c === null) {
      this.add(
        state,
        'correctable',
        'limit_not_constant',
        `${label} must be a constant integer.`,
      );
      return;
    }
    if (isOffset && c.value > SQL_POLICY.maxOffset) {
      this.add(
        state,
        'complexity',
        'limit_offset_too_large',
        `OFFSET may not exceed ${SQL_POLICY.maxOffset}.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------

  /** Integer constant (`LIMIT 10`). Note: libpg-query omits `ival` for 0. */
  private constInt(node: unknown): { value: number; location: number } | null {
    const u = unwrap(node);
    if (!u || u[0] !== 'A_Const' || u[1].isnull) return null;
    if (!('ival' in u[1]) || !isObj(u[1].ival)) return null;
    const v = u[1].ival.ival;
    return {
      value: typeof v === 'number' ? v : 0,
      location: typeof u[1].location === 'number' ? u[1].location : -1,
    };
  }

  /** Parser locations are byte offsets into the UTF-8 encoded query. */
  private replaceAtByte(sql: string, at: number, len: number, value: string) {
    const buf = Buffer.from(sql, 'utf8');
    if (at < 0 || at + len > buf.length) return `${sql}`;
    return Buffer.concat([
      buf.subarray(0, at),
      Buffer.from(value, 'utf8'),
      buf.subarray(at + len),
    ]).toString('utf8');
  }

  private implicitName(val: unknown): string {
    const u = unwrap(val);
    if (!u) return '?column?';
    const [kind, n] = u;
    if (kind === 'ColumnRef') {
      const f = names(n.fields);
      return f[f.length - 1] ?? '?column?';
    }
    if (kind === 'FuncCall') {
      const f = names(n.funcname);
      return f[f.length - 1] ?? '?column?';
    }
    if (kind === 'TypeCast') return this.implicitName(n.arg);
    if (kind === 'CoalesceExpr') return 'coalesce';
    if (kind === 'CaseExpr') return 'case';
    return '?column?';
  }

  private add(
    state: WalkState,
    category: ViolationCategory,
    code: string,
    message: string,
  ) {
    if (
      !state.violations.some((v) => v.code === code && v.message === message)
    ) {
      state.violations.push({ code, category, message });
    }
  }

  private fail(
    violations: SqlViolation[],
    passedIds: string[],
  ): SqlValidationResult {
    const all: Array<[string, string]> = [
      ['parsed', 'Parsed by PostgreSQL parser (AST)'],
      ['single', 'Single statement'],
      ['readonly', 'Read-only SELECT only'],
    ];
    return {
      ok: false,
      violations,
      checks: all.map(([id, label]) => ({
        id,
        label,
        passed: passedIds.includes(id),
      })),
      tables: [],
      rowLimit: SQL_POLICY.maxRowLimit,
      limitInjected: false,
    };
  }

  /** Is every violation something the model is allowed to fix? */
  static isCorrectable(result: SqlValidationResult): boolean {
    return (
      result.violations.length > 0 &&
      result.violations.every((v) => v.category === 'correctable')
    );
  }
}
