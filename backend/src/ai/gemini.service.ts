import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { AppError } from '../common/app-error';
import type { AppEnv } from '../config/configuration';

export interface JsonGenerationRequest {
  systemInstruction: string;
  /** Untrusted content (question, results) — always passed as data, never as instructions. */
  userContent: string;
  responseJsonSchema: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  timeoutMs?: number;
}

/**
 * Thin wrapper around @google/genai. The API key lives only on the server.
 * Returns raw text; callers must validate it (model output is untrusted).
 */
@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly client: GoogleGenAI | null;
  readonly model: string;

  constructor(config: ConfigService<AppEnv, true>) {
    const key = config.get('GEMINI_API_KEY', { infer: true });
    this.model =
      config.get('GEMINI_MODEL', { infer: true }) || 'gemini-2.5-flash';
    this.client = key ? new GoogleGenAI({ apiKey: key }) : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async generateJson(req: JsonGenerationRequest): Promise<string> {
    if (!this.client) {
      throw new AppError(
        'AI_UNAVAILABLE',
        'The AI service is not configured on the server.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const timeoutMs = req.timeoutMs ?? 25_000;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [{ role: 'user', parts: [{ text: req.userContent }] }],
        config: {
          systemInstruction: req.systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: req.responseJsonSchema,
          temperature: req.temperature ?? 0,
          maxOutputTokens: req.maxOutputTokens ?? 2048,
          thinkingConfig: { thinkingBudget: req.thinkingBudget ?? 0 },
          abortSignal: abort.signal,
          httpOptions: { timeout: timeoutMs },
        },
      });
      return response.text ?? '';
    } catch (err) {
      const status = (err as { status?: number })?.status;
      // Log without request content; never forward provider error text to clients.
      this.logger.warn(
        `Gemini request failed${status ? ` (HTTP ${status})` : ''}: ${err instanceof Error ? err.name : 'error'}`,
      );
      throw new AppError(
        'AI_UNAVAILABLE',
        status === 429
          ? 'The AI service is rate limited right now. Please try again shortly.'
          : abort.signal.aborted
            ? 'The AI service took too long to respond. Please try again.'
            : 'The AI service is temporarily unavailable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
