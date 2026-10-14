/**
 * Strict parsing of model JSON output. Model output is untrusted: anything
 * that does not match the expected shape is rejected instead of guessed.
 */
export class MalformedModelResponseError extends Error {
  constructor(reason: string) {
    super(`Malformed model response: ${reason}`);
    this.name = 'MalformedModelResponseError';
  }
}

export function parseModelJson(text: string): Record<string, unknown> {
  if (typeof text !== 'string' || !text.trim()) {
    throw new MalformedModelResponseError('empty response');
  }
  if (text.length > 20_000) {
    throw new MalformedModelResponseError('response too large');
  }
  // Tolerate a markdown fence around the JSON, nothing else.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  let value: unknown;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw new MalformedModelResponseError('invalid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedModelResponseError('expected a JSON object');
  }
  return value as Record<string, unknown>;
}

export function requireString(
  obj: Record<string, unknown>,
  key: string,
  { max, optional }: { max: number; optional?: boolean },
): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null || v === '') {
    if (optional) return undefined;
    throw new MalformedModelResponseError(`missing "${key}"`);
  }
  if (typeof v !== 'string') {
    throw new MalformedModelResponseError(`"${key}" must be a string`);
  }
  if (v.length > max) {
    throw new MalformedModelResponseError(`"${key}" is too long`);
  }
  return v;
}

/** A random marker placed in system prompts; if it ever appears in output, the prompt leaked. */
export const PROMPT_CANARY = 'DPX-CANARY-7F3A91';

export function containsLeak(text: string): boolean {
  return (
    text.includes(PROMPT_CANARY) ||
    /AIza[0-9A-Za-z_-]{20,}/.test(text) || // Google API key shape
    /postgres(ql)?:\/\/[^\s]+@/i.test(text) || // connection string with credentials
    /\b(SYSTEM INSTRUCTIONS|BEGIN SYSTEM PROMPT)\b/i.test(text)
  );
}
