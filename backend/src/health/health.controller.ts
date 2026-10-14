import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { GeminiService } from '../ai/gemini.service';
import { DatabaseService } from '../database/database.service';

/**
 * Basic health information. Deliberately reports only booleans — no hosts,
 * role names, versions, error messages or other infrastructure details.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly db: DatabaseService,
    private readonly gemini: GeminiService,
  ) {}

  @Get()
  async check() {
    const dbConfigured = this.db.configured;
    const dbReachable = dbConfigured ? await this.db.ping() : false;
    const role = dbReachable ? await this.db.verifyRole() : null;
    const ready = dbReachable && !!role?.safe && this.gemini.configured;

    return {
      status: ready ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      services: {
        api: 'up',
        database: dbReachable ? 'up' : dbConfigured ? 'down' : 'not_configured',
        ai: this.gemini.configured ? 'configured' : 'not_configured',
      },
      security: {
        leastPrivilegeRole: !!role?.safe,
        readOnlyExecution: true,
        sqlAstValidation: true,
      },
    };
  }
}
