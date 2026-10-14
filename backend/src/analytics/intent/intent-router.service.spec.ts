import { SchemaContextService } from '../context/schema-context.service';
import { IntentRouterService } from './intent-router.service';

describe('IntentRouterService + SchemaContextService (vectorless retrieval)', () => {
  const router = new IntentRouterService();
  const contexts = new SchemaContextService();

  it('detects ranking with a top-N limit (number word)', () => {
    const i = router.analyze('Show the top five customers by spending');
    expect(i.primary).toBe('ranking');
    expect(i.requestedLimit).toBe(5);
    expect(i.tables).toEqual(expect.arrayContaining(['users', 'orders']));
    expect(i.topics).toEqual(expect.arrayContaining(['customers', 'revenue']));
  });

  it('detects time-series questions and the time grain', () => {
    const i = router.analyze('Compare monthly revenue');
    expect(i.primary).toBe('time_series');
    expect(i.intents).toEqual(
      expect.arrayContaining(['comparison', 'time_series', 'aggregation']),
    );
    expect(i.timeGrain).toBe('month');
    expect(i.tables).toEqual(['orders']);
  });

  it('detects filtering by status and period', () => {
    const i = router.analyze('Find completed orders from this month');
    expect(i.intents).toContain('filtering');
    expect(i.statusFilter).toBe('completed');
    expect(i.topics).toContain('time');
  });

  it('routes category questions to products + orders', () => {
    const i = router.analyze(
      'Which product categories generate the most revenue?',
    );
    expect(i.tables).toEqual(expect.arrayContaining(['products', 'orders']));
    expect(i.primary).toBe('ranking');
  });

  it('flags out-of-domain questions', () => {
    expect(router.analyze('Write me a poem about the ocean').inDomain).toBe(
      false,
    );
  });

  it('slices only the relevant schema and rules into the context', () => {
    const ctx = contexts.build(router.analyze('Compare monthly revenue'));
    expect(ctx.tables.map((t) => t.name)).toEqual(['orders']);
    expect(ctx.relationships).toHaveLength(0);
    expect(ctx.rules.map((r) => r.id)).toEqual(
      expect.arrayContaining([
        'revenue-definition',
        'cancelled-orders',
        'time-periods',
      ]),
    );
    expect(ctx.text).toContain("status = 'completed'");
    expect(ctx.text).not.toContain('TABLE users');
  });

  it('adds the orders bridge table when customers and products are both involved', () => {
    const ctx = contexts.build(
      router.analyze('Which customers bought which products?'),
    );
    expect(ctx.tables.map((t) => t.name).sort()).toEqual([
      'orders',
      'products',
      'users',
    ]);
    expect(ctx.relationships).toHaveLength(2);
  });

  it('never exposes restricted columns in the model context', () => {
    const ctx = contexts.build(router.analyze('Tell me about customers'));
    expect(ctx.text).not.toMatch(/email/i);
  });
});
