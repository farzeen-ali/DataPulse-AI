import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { AppEnv } from './config/configuration';

/** Shared HTTP hardening — used by main.ts and the e2e tests. */
export function setupApp(app: NestExpressApplication) {
  const config = app.get(ConfigService<AppEnv, true>);

  app.setGlobalPrefix('api');
  app.disable('x-powered-by');
  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy)
    app.set(
      'trust proxy',
      /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy,
    );

  app.use(helmet());
  // Small request bodies only: a question is at most 500 characters.
  app.useBodyParser('json', { limit: '8kb' });

  const origins = config
    .get('FRONTEND_ORIGIN', { infer: true })
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
    }),
  );
}
