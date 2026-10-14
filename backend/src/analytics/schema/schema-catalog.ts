/**
 * Approved analytics schema — the single source of truth for:
 *  - the SQL security validator (table / column allowlists)
 *  - the schema context sent to Gemini (vectorless retrieval)
 *  - the least-privilege role grants (prisma/scripts/setup-analytics-role.ts)
 *  - the GET /api/analytics/schema endpoint
 *
 * Anything not listed here is invisible to the AI layer and rejected by the validator.
 */

export type ColumnType = 'integer' | 'decimal' | 'text' | 'timestamptz';

export interface ColumnDefinition {
  name: string;
  type: ColumnType;
  description: string;
  primaryKey?: boolean;
  references?: { table: string; column: string };
  /** Example values help the model write correct filters. */
  examples?: string[];
}

export interface TableDefinition {
  name: string;
  label: string;
  description: string;
  columns: ColumnDefinition[];
  /**
   * Columns that physically exist but are never exposed to AI-generated SQL
   * (PII). The validator treats references to them as security violations and
   * the database role has no SELECT grant on them.
   */
  restrictedColumns: string[];
  /** Words that route a question to this table without embeddings. */
  synonyms: string[];
}

export interface Relationship {
  from: { table: string; column: string };
  to: { table: string; column: string };
  cardinality: 'many-to-one';
  description: string;
}

export interface BusinessRule {
  id: string;
  title: string;
  rule: string;
  /** Rules are attached to the prompt only when one of these topics is detected. */
  topics: Array<'revenue' | 'orders' | 'customers' | 'products' | 'time'>;
}

export const ORDER_STATUSES = ['completed', 'pending', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ANALYTICS_TABLES: TableDefinition[] = [
  {
    name: 'users',
    label: 'Customers',
    description:
      'Registered customers. One row per customer. Customers place orders.',
    columns: [
      {
        name: 'id',
        type: 'integer',
        description: 'Customer identifier',
        primaryKey: true,
      },
      { name: 'name', type: 'text', description: 'Customer full name' },
      {
        name: 'country',
        type: 'text',
        description: 'Customer country (English name)',
        examples: ['United States', 'Germany', 'United Kingdom', 'Japan'],
      },
      {
        name: 'created_at',
        type: 'timestamptz',
        description: 'When the customer signed up (UTC)',
      },
    ],
    restrictedColumns: ['email'],
    synonyms: [
      'user',
      'users',
      'customer',
      'customers',
      'client',
      'clients',
      'buyer',
      'buyers',
      'shopper',
      'shoppers',
      'account',
      'accounts',
      'country',
      'countries',
      'signup',
      'signups',
      'people',
      'who',
    ],
  },
  {
    name: 'products',
    label: 'Products',
    description: 'Product catalog. One row per product with its list price.',
    columns: [
      {
        name: 'id',
        type: 'integer',
        description: 'Product identifier',
        primaryKey: true,
      },
      { name: 'title', type: 'text', description: 'Product name' },
      {
        name: 'category',
        type: 'text',
        description: 'Product category',
        examples: ['Software', 'Hardware', 'Services', 'Training'],
      },
      {
        name: 'price',
        type: 'decimal',
        description: 'Current list price in USD (not the amount paid)',
      },
    ],
    restrictedColumns: [],
    synonyms: [
      'product',
      'products',
      'item',
      'items',
      'sku',
      'skus',
      'category',
      'categories',
      'catalog',
      'price',
      'prices',
      'plan',
      'plans',
      'offering',
      'offerings',
    ],
  },
  {
    name: 'orders',
    label: 'Orders',
    description:
      'Customer orders. One row per order of one product by one customer.',
    columns: [
      {
        name: 'id',
        type: 'integer',
        description: 'Order identifier',
        primaryKey: true,
      },
      {
        name: 'user_id',
        type: 'integer',
        description: 'Customer who placed the order',
        references: { table: 'users', column: 'id' },
      },
      {
        name: 'product_id',
        type: 'integer',
        description: 'Product that was ordered',
        references: { table: 'products', column: 'id' },
      },
      {
        name: 'amount',
        type: 'decimal',
        description:
          'Total amount charged for the order in USD (quantity and discounts already applied)',
      },
      {
        name: 'status',
        type: 'text',
        description: 'Order lifecycle status',
        examples: [...ORDER_STATUSES],
      },
      {
        name: 'created_at',
        type: 'timestamptz',
        description: 'When the order was placed (UTC)',
      },
    ],
    restrictedColumns: [],
    synonyms: [
      'order',
      'orders',
      'purchase',
      'purchases',
      'sale',
      'sales',
      'transaction',
      'transactions',
      'revenue',
      'income',
      'spend',
      'spending',
      'spent',
      'earn',
      'earned',
      'amount',
      'aov',
      'status',
      'completed',
      'pending',
      'cancelled',
      'canceled',
      'monthly',
      'month',
      'trend',
    ],
  },
];

export const RELATIONSHIPS: Relationship[] = [
  {
    from: { table: 'orders', column: 'user_id' },
    to: { table: 'users', column: 'id' },
    cardinality: 'many-to-one',
    description: 'Each order belongs to exactly one customer.',
  },
  {
    from: { table: 'orders', column: 'product_id' },
    to: { table: 'products', column: 'id' },
    cardinality: 'many-to-one',
    description: 'Each order is for exactly one product.',
  },
];

export const BUSINESS_RULES: BusinessRule[] = [
  {
    id: 'revenue-definition',
    title: 'Revenue',
    rule: "Revenue = SUM(orders.amount) over orders WHERE orders.status = 'completed'. Never use products.price to compute revenue.",
    topics: ['revenue', 'customers', 'products'],
  },
  {
    id: 'cancelled-orders',
    title: 'Cancelled orders',
    rule: "Orders with status 'cancelled' never count toward revenue, spending, or order volume unless the user explicitly asks about cancelled orders.",
    topics: ['revenue', 'orders', 'customers', 'products'],
  },
  {
    id: 'pending-orders',
    title: 'Pending (incomplete) orders',
    rule: "Orders with status 'pending' are not yet paid: exclude them from revenue and customer spending. Include them in order volume (number of orders) together with completed orders. Report them separately only when asked.",
    topics: ['revenue', 'orders', 'customers', 'products'],
  },
  {
    id: 'customer-spending',
    title: 'Customer spending',
    rule: "A customer's spending = SUM(orders.amount) of that customer's completed orders. Rank customers with ORDER BY total DESC.",
    topics: ['customers', 'revenue'],
  },
  {
    id: 'order-volume',
    title: 'Order volume',
    rule: "Number of orders = COUNT(orders.id) WHERE status IN ('completed', 'pending'), unless a specific status is requested.",
    topics: ['orders', 'products'],
  },
  {
    id: 'time-periods',
    title: 'Time periods',
    rule: "Timestamps are UTC. 'This month' = created_at >= date_trunc('month', now()). 'Last month' = the previous calendar month. Group monthly trends with date_trunc('month', created_at) and order chronologically.",
    topics: ['time'],
  },
  {
    id: 'aov',
    title: 'Average order value',
    rule: 'Average order value (AOV) = AVG(orders.amount) over completed orders.',
    topics: ['revenue', 'orders'],
  },
];

export const ALLOWED_TABLES = new Set(ANALYTICS_TABLES.map((t) => t.name));

export function getTable(name: string): TableDefinition | undefined {
  return ANALYTICS_TABLES.find((t) => t.name === name);
}

/** Approved (selectable) column names per table. */
export function approvedColumns(table: string): Set<string> {
  return new Set(getTable(table)?.columns.map((c) => c.name) ?? []);
}

/** Columns that exist physically but are forbidden (PII). */
export function restrictedColumns(table: string): Set<string> {
  return new Set(getTable(table)?.restrictedColumns ?? []);
}
