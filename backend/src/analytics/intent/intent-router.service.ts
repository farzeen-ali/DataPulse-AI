import { Injectable } from '@nestjs/common';
import { ANALYTICS_TABLES } from '../schema/schema-catalog';

export type IntentType =
  | 'aggregation'
  | 'ranking'
  | 'comparison'
  | 'time_series'
  | 'filtering'
  | 'lookup';

export type Topic = 'revenue' | 'orders' | 'customers' | 'products' | 'time';

export interface IntentAnalysis {
  /** Most specific intent, used for prompt hints and chart selection. */
  primary: IntentType;
  intents: IntentType[];
  topics: Topic[];
  /** Tables the question is about, before join-path expansion. */
  tables: string[];
  timeGrain?: 'day' | 'week' | 'month' | 'quarter' | 'year';
  /** e.g. "top 5" → 5 */
  requestedLimit?: number;
  statusFilter?: 'completed' | 'pending' | 'cancelled';
  /** False when the question mentions nothing from our domain. */
  inDomain: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twenty: 20,
};

const INTENT_PATTERNS: Array<[IntentType, RegExp]> = [
  [
    'ranking',
    /\b(top|bottom|best|worst|highest|lowest|most|least|largest|smallest|biggest|leading|rank(ing|ed)?|leaderboard)\b/,
  ],
  [
    'comparison',
    /\b(compare|comparison|versus|vs\.?|by category|per category|by country|per country|breakdown|broken down|split by|each|per|across|share|distribution)\b/,
  ],
  [
    'time_series',
    /\b(monthly|weekly|daily|quarterly|yearly|annual|over time|trend|trends|growth|month over month|mom|yoy|per month|by month|each month|timeline|history)\b/,
  ],
  [
    'aggregation',
    /\b(total|sum|average|avg|mean|count|how many|number of|revenue|spend(ing)?|aov|overall|median)\b/,
  ],
  [
    'filtering',
    /\b(where|only|completed|pending|cancell?ed|this month|last month|this year|last year|today|yesterday|since|before|after|between|from|in (the )?(united|germany|japan|france|canada|india|brazil|australia|spain))\b/,
  ],
];

const TOPIC_PATTERNS: Array<[Topic, RegExp]> = [
  [
    'revenue',
    /\b(revenue|sales|income|earn(ed|ings)?|spend(ing)?|spent|money|aov|order value|gmv|value)\b/,
  ],
  [
    'orders',
    /\b(orders?|purchases?|transactions?|bought|sold|status|completed|pending|cancell?ed)\b/,
  ],
  [
    'customers',
    /\b(customers?|users?|clients?|buyers?|shoppers?|accounts?|countr(y|ies)|who)\b/,
  ],
  [
    'products',
    /\b(products?|items?|categor(y|ies)|catalog|prices?|skus?|plans?)\b/,
  ],
  [
    'time',
    /\b(month|monthly|week|weekly|day|daily|year|yearly|quarter|today|yesterday|recent|latest|trend|over time|since|ago|this month|last month|date)\b/,
  ],
];

/**
 * Lightweight, deterministic intent router (no embeddings, no vector search).
 * Its output selects which tables, relationships and business rules are sent
 * to the model — a form of vectorless retrieval / structured context slicing.
 */
@Injectable()
export class IntentRouterService {
  analyze(prompt: string): IntentAnalysis {
    const text = prompt.toLowerCase();
    const words = new Set(text.match(/[a-z_]+/g) ?? []);

    const intents = INTENT_PATTERNS.filter(([, re]) => re.test(text)).map(
      ([i]) => i,
    );
    const topics = TOPIC_PATTERNS.filter(([, re]) => re.test(text)).map(
      ([t]) => t,
    );

    const tables = ANALYTICS_TABLES.filter((t) =>
      t.synonyms.some((s) => words.has(s)),
    ).map((t) => t.name);

    // Revenue and spending live on orders even when "orders" is not mentioned.
    if (topics.includes('revenue') && !tables.includes('orders')) {
      tables.push('orders');
    }

    const priority: IntentType[] = [
      'time_series',
      'ranking',
      'comparison',
      'aggregation',
      'filtering',
    ];
    const primary = priority.find((p) => intents.includes(p)) ?? 'lookup';

    return {
      primary,
      intents: intents.length ? intents : ['lookup'],
      topics,
      tables,
      timeGrain: this.timeGrain(text),
      requestedLimit: this.requestedLimit(text),
      statusFilter: this.statusFilter(text),
      inDomain: tables.length > 0 || topics.length > 0,
    };
  }

  private timeGrain(text: string): IntentAnalysis['timeGrain'] {
    if (/\b(daily|per day|by day|each day)\b/.test(text)) return 'day';
    if (/\b(weekly|per week|by week|each week)\b/.test(text)) return 'week';
    if (/\b(quarterly|per quarter|by quarter)\b/.test(text)) return 'quarter';
    if (/\b(yearly|annual|per year|by year|yoy)\b/.test(text)) return 'year';
    if (
      /\b(monthly|per month|by month|each month|month over month|mom)\b/.test(
        text,
      )
    )
      return 'month';
    return undefined;
  }

  private requestedLimit(text: string): number | undefined {
    const m = text.match(
      /\b(top|bottom|best|worst|first|last)\s+(\d{1,3}|[a-z]+)\b/,
    );
    if (!m) return undefined;
    const raw = m[2];
    const n = /^\d+$/.test(raw) ? Number(raw) : NUMBER_WORDS[raw];
    return n && n > 0 && n <= 100 ? n : undefined;
  }

  private statusFilter(text: string): IntentAnalysis['statusFilter'] {
    if (/\bcancell?ed\b/.test(text)) return 'cancelled';
    if (/\b(pending|incomplete|unpaid|open orders)\b/.test(text))
      return 'pending';
    if (/\b(completed?|fulfilled|paid)\b/.test(text)) return 'completed';
    return undefined;
  }
}
