import { Injectable } from '@nestjs/common';

export type PromptRejectionCategory =
  | 'prompt_injection'
  | 'secret_request'
  | 'data_modification'
  | 'system_access'
  | 'restricted_data'
  | 'invalid_input';

export interface PromptInspection {
  allowed: boolean;
  /** Normalised prompt (control characters removed, whitespace collapsed). */
  prompt: string;
  category?: PromptRejectionCategory;
  reason?: string;
}

interface Rule {
  category: PromptRejectionCategory;
  reason: string;
  patterns: RegExp[];
}

/** Control, zero-width and bidi characters often used to hide instructions. */
const HIDDEN_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

export const PROMPT_MAX_LENGTH = 500;
export const PROMPT_MIN_LENGTH = 3;

/**
 * First, cheap line of defence: obvious jailbreaks, secret extraction and
 * write intents are refused before any model call.
 *
 * This is NOT the security boundary. Even if a malicious prompt slips through,
 * the SQL AST validator, read-only transaction and least-privilege database
 * role still prevent any harm. The guard exists to give clear feedback and to
 * avoid wasting model calls.
 */
@Injectable()
export class PromptGuardService {
  private readonly rules: Rule[] = [
    {
      category: 'prompt_injection',
      reason:
        'The request tries to override DataPulse instructions. Please ask a business question about customers, products or orders.',
      patterns: [
        /\b(ignore|disregard|forget|override|bypass)\b[^.]{0,40}\b(previous|prior|above|earlier|all|your|system|safety|security)\b[^.]{0,20}\b(instructions?|rules?|prompts?|polic(y|ies)|guidelines?|restrictions?)\b/i,
        /\b(you are now|from now on you|pretend (to be|you are)|act as (an? )?(dba|admin|administrator|superuser|root|developer))\b/i,
        /\b(jailbreak|developer mode|dan mode|god mode|sudo mode)\b/i,
        /<\/?\s*(system|instructions?|assistant|user_question)\s*>/i,
        /\bnew (system )?instructions?\s*:/i,
      ],
    },
    {
      category: 'secret_request',
      reason:
        'DataPulse never reveals credentials, keys, configuration or internal instructions.',
      patterns: [
        /\b(reveal|show|print|repeat|display|output|leak|tell me|give me|what (is|are))\b[^.]{0,40}\b(system prompt|hidden prompt|your (prompt|instructions|rules)|internal instructions)\b/i,
        /\b(api[\s_-]?keys?|secret keys?|passwords?|credentials?|access tokens?|connection strings?|database url|service[\s_-]?role|env(ironment)? variables?|\.env\b|gemini[\s_-]?key)\b/i,
      ],
    },
    {
      category: 'data_modification',
      reason:
        'DataPulse is read-only. It cannot insert, update, delete or change data or schema.',
      patterns: [
        /\b(drop|truncate|alter)\s+(table|database|schema|column|role|index|view|function|policy)\b/i,
        /\bdelete\s+(from|all|every|any)\b/i,
        /\bdelete\s+(the\s+)?(users?|orders?|products?|customers?|records?|rows?|data|tables?)\b/i,
        /\b(grant|revoke)\s+(all|select|insert|update|delete|usage|privileges?|access)\b/i,
        /\binsert\s+into\b/i,
        /\bupdate\s+\w+\s+set\b/i,
        /\b(erase|wipe|overwrite)\b[^.]{0,30}\b(records?|rows?|orders?|customers?|users?|products?|prices?|data|table|database)\b/i,
        /\b(set|change|update|modify)\s+(the\s+)?(price|amount|status|name)\s+(of|for|to)\b/i,
        /;\s*(drop|delete|insert|update|alter|create|grant|truncate|copy)\b/i,
      ],
    },
    {
      category: 'system_access',
      reason:
        'System catalogs, server functions and other schemas are not available. Ask about customers, products or orders.',
      patterns: [
        /\b(pg_catalog|information_schema|pg_shadow|pg_authid|pg_roles|pg_user|pg_stat\w*|pg_sleep|pg_read\w*|lo_import|lo_export|dblink|copy\s+\w+\s+(to|from)|auth\.users|storage\.objects|_prisma_migrations)\b/i,
        /\b(current_user|session_user|version\(\)|set_config|current_setting)\b/i,
      ],
    },
    {
      category: 'restricted_data',
      reason:
        'Customer email addresses are restricted personal data and are not available for analytics.',
      patterns: [/\be-?mails?\b/i, /\bemail addresses?\b/i],
    },
  ];

  inspect(raw: unknown): PromptInspection {
    if (typeof raw !== 'string') {
      return this.reject('', 'invalid_input', 'Prompt must be text.');
    }
    // Strip control / zero-width / bidi characters often used to hide instructions.
    const prompt = raw
      .normalize('NFKC')
      .replace(HIDDEN_CHARS, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (prompt.length < PROMPT_MIN_LENGTH) {
      return this.reject(
        prompt,
        'invalid_input',
        'Please enter a longer question.',
      );
    }
    if (prompt.length > PROMPT_MAX_LENGTH) {
      return this.reject(
        prompt,
        'invalid_input',
        `Questions are limited to ${PROMPT_MAX_LENGTH} characters.`,
      );
    }

    for (const rule of this.rules) {
      if (rule.patterns.some((p) => p.test(prompt))) {
        return this.reject(prompt, rule.category, rule.reason);
      }
    }
    return { allowed: true, prompt };
  }

  private reject(
    prompt: string,
    category: PromptRejectionCategory,
    reason: string,
  ): PromptInspection {
    return { allowed: false, prompt, category, reason };
  }
}
