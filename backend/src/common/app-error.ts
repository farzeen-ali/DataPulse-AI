import { HttpStatus } from '@nestjs/common';

/**
 * Stable, client-safe error codes. The message attached to an AppError is
 * always written by us (never raw driver / model output) so it is safe to
 * return to the frontend.
 */
export type AppErrorCode =
  | 'PROMPT_REJECTED'
  | 'SQL_SECURITY_VIOLATION'
  | 'SQL_GENERATION_FAILED'
  | 'RETRY_LIMIT_EXCEEDED'
  | 'QUERY_TIMEOUT'
  | 'QUERY_NOT_AUTHORIZED'
  | 'QUERY_FAILED'
  | 'AI_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE'
  | 'UNSAFE_DATABASE_ROLE'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly status: HttpStatus,
    /** Extra client-safe details (e.g. failed security checks). */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
