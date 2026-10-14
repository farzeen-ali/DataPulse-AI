import { plainToInstance, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

/**
 * Environment variables, validated at boot. Secrets stay on the server: none
 * of these are ever sent to the frontend.
 */
class EnvironmentVariables {
  @IsOptional()
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: string = 'development';

  @Transform(({ value }) => (value === undefined ? 4000 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 4000;

  /** Gemini API key. Optional at boot so /api/health works without it. */
  @IsOptional()
  @IsString()
  GEMINI_API_KEY?: string;

  @IsOptional()
  @IsString()
  GEMINI_MODEL: string = 'gemini-2.5-flash';

  /** Runtime connection — MUST use the least-privilege `datapulse_analytics` role. */
  @IsOptional()
  @IsString()
  SUPABASE_DATABASE_URL?: string;

  /** Owner connection used by Prisma migrations and seeding only. Never used to run AI SQL. */
  @IsOptional()
  @IsString()
  SUPABASE_DIRECT_URL?: string;

  /** require = TLS without CA verification (Supabase default), verify = TLS + CA, disable = local only. */
  @IsOptional()
  @IsIn(['require', 'verify', 'disable'])
  DATABASE_SSL: 'require' | 'verify' | 'disable' = 'require';

  @IsOptional()
  @IsString()
  DATABASE_CA_CERT?: string;

  /** Comma-separated list of allowed browser origins. */
  @IsOptional()
  @IsString()
  FRONTEND_ORIGIN: string = 'http://localhost:3000,http://127.0.0.1:3000';

  @Transform(({ value }) => (value === undefined ? 5000 : Number(value)))
  @IsInt()
  @Min(500)
  @Max(15000)
  QUERY_TIMEOUT_MS: number = 5000;

  @Transform(({ value }) => (value === undefined ? 10 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(120)
  QUERY_RATE_LIMIT_PER_MINUTE: number = 10;

  /** Express "trust proxy" setting, e.g. "loopback" or "1" behind one proxy. */
  @IsOptional()
  @IsString()
  TRUST_PROXY?: string;
}

export function validateEnv(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length) {
    const details = errors
      .map(
        (e) =>
          `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
      )
      .join('; ');
    throw new Error(`Invalid environment configuration — ${details}`);
  }
  return validated;
}

export type AppEnv = EnvironmentVariables;
