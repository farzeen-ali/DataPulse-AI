import { Injectable } from '@nestjs/common';
import { ALLOWED_FUNCTIONS, SQL_POLICY } from '../security/sql-policy';
import {
  ANALYTICS_TABLES,
  BUSINESS_RULES,
  RELATIONSHIPS,
} from './schema-catalog';

export const EXAMPLE_QUESTIONS = [
  'Show the top five customers by spending',
  'Compare monthly revenue',
  'Which product categories generate the most revenue?',
  'Find completed orders from this month',
  'Which products have the highest number of orders?',
  'What is the revenue by customer country?',
];

/** Approved schema metadata for the frontend. Restricted columns are named but never described. */
@Injectable()
export class SchemaService {
  describe() {
    return {
      tables: ANALYTICS_TABLES.map((t) => ({
        name: t.name,
        label: t.label,
        description: t.description,
        columns: t.columns.map((c) => ({
          name: c.name,
          type: c.type,
          description: c.description,
          primaryKey: c.primaryKey ?? false,
          references: c.references ?? null,
          examples: c.examples ?? [],
        })),
        restrictedColumns: t.restrictedColumns,
      })),
      relationships: RELATIONSHIPS,
      businessRules: BUSINESS_RULES.map(({ id, title, rule }) => ({
        id,
        title,
        rule,
      })),
      policy: {
        maxRowLimit: SQL_POLICY.maxRowLimit,
        maxJoins: SQL_POLICY.maxJoins,
        maxSubqueryDepth: SQL_POLICY.maxSubqueryDepth,
        allowedFunctions: [...ALLOWED_FUNCTIONS].sort(),
        statementTypes: ['SELECT'],
      },
      examples: EXAMPLE_QUESTIONS,
    };
  }
}
