import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppError, AppErrorCode } from './app-error';

export interface ErrorBody {
  statusCode: number;
  code: AppErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Converts every error into a small, predictable JSON body. Unknown errors are
 * logged server-side and returned as a generic 500 so stack traces, SQL driver
 * messages and secrets never reach the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    res.status(body.statusCode).json(body);
  }

  toBody(exception: unknown): ErrorBody {
    if (exception instanceof AppError) {
      return {
        statusCode: exception.status,
        code: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      };
    }

    if (exception instanceof ThrottlerException) {
      return {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a moment and try again.',
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const raw =
        typeof response === 'object' && response !== null
          ? (response as { message?: unknown }).message
          : response;
      const message = Array.isArray(raw)
        ? raw.join('; ')
        : typeof raw === 'string'
          ? raw
          : exception.message;

      return {
        statusCode: status,
        code: this.codeFor(status),
        message: status >= 500 ? 'Unexpected server error.' : message,
      };
    }

    // body-parser errors (e.g. payload too large / invalid JSON) are plain errors with a status.
    const maybe = exception as { status?: number; type?: string };
    if (maybe?.type === 'entity.too.large') {
      return {
        statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large.',
      };
    }
    if (maybe?.type === 'entity.parse.failed') {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Request body must be valid JSON.',
      };
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Unexpected server error.',
    };
  }

  private codeFor(status: number): AppErrorCode {
    switch (status) {
      case 400:
      case 422:
        return 'VALIDATION_ERROR';
      case 404:
        return 'NOT_FOUND';
      case 413:
        return 'PAYLOAD_TOO_LARGE';
      case 429:
        return 'RATE_LIMITED';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
    }
  }
}
