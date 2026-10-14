import { Injectable } from '@nestjs/common';
import type { IntentAnalysis, Topic } from '../intent/intent-router.service';
import {
  ANALYTICS_TABLES,
  BUSINESS_RULES,
  BusinessRule,
  RELATIONSHIPS,
  Relationship,
  TableDefinition,
} from '../schema/schema-catalog';

export interface SchemaContext {
  tables: TableDefinition[];
  relationships: Relationship[];
  rules: BusinessRule[];
  /** Compact text block given to the model. */
  text: string;
}

/**
 * Vectorless retrieval: picks only the tables, join paths and business rules
 * that the intent router says are relevant, and renders them as compact text.
 * Restricted (PII) columns are never included.
 */
@Injectable()
export class SchemaContextService {
  build(intent: IntentAnalysis): SchemaContext {
    const selected = new Set(
      intent.tables.length
        ? intent.tables
        : ANALYTICS_TABLES.map((t) => t.name),
    );

    // Join-path expansion: customers ↔ products only connect through orders.
    if (selected.has('users') && selected.has('products'))
      selected.add('orders');
    // Rankings / comparisons of customers or products are almost always order based.
    if (
      (selected.has('users') || selected.has('products')) &&
      intent.intents.some((i) =>
        ['ranking', 'aggregation', 'comparison', 'time_series'].includes(i),
      )
    ) {
      selected.add('orders');
    }

    const tables = ANALYTICS_TABLES.filter((t) => selected.has(t.name));
    const relationships = RELATIONSHIPS.filter(
      (r) => selected.has(r.from.table) && selected.has(r.to.table),
    );

    const topics = new Set<Topic>(intent.topics);
    if (selected.has('orders')) topics.add('orders');
    if (intent.timeGrain || intent.intents.includes('time_series'))
      topics.add('time');
    const rules = BUSINESS_RULES.filter((r) =>
      r.topics.some((t) => topics.has(t)),
    );

    return {
      tables,
      relationships,
      rules,
      text: this.render(tables, relationships, rules),
    };
  }

  private render(
    tables: TableDefinition[],
    relationships: Relationship[],
    rules: BusinessRule[],
  ): string {
    const lines: string[] = [
      'APPROVED TABLES (schema "public"; no other tables exist for you):',
    ];
    for (const t of tables) {
      lines.push(`TABLE ${t.name} — ${t.description}`);
      for (const c of t.columns) {
        const tags = [
          c.primaryKey ? 'PK' : '',
          c.references
            ? `FK → ${c.references.table}.${c.references.column}`
            : '',
        ]
          .filter(Boolean)
          .join(', ');
        const examples = c.examples?.length
          ? ` Values: ${c.examples.map((e) => `'${e}'`).join(', ')}.`
          : '';
        lines.push(
          `  - ${c.name} ${c.type}${tags ? ` [${tags}]` : ''}: ${c.description}.${examples}`,
        );
      }
    }
    if (relationships.length) {
      lines.push('', 'RELATIONSHIPS:');
      for (const r of relationships) {
        lines.push(
          `  - ${r.from.table}.${r.from.column} → ${r.to.table}.${r.to.column} (${r.cardinality}): ${r.description}`,
        );
      }
    }
    if (rules.length) {
      lines.push('', 'BUSINESS RULES (always apply):');
      for (const r of rules) lines.push(`  - ${r.title}: ${r.rule}`);
    }
    return lines.join('\n');
  }
}
