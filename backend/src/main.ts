import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import type { AppEnv } from './config/configuration';
import { setupApp } from './setup-app';

async function bootstrap() {
  // bodyParser is registered in setupApp with a strict size limit.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  setupApp(app);
  app.enableShutdownHooks();

  const port = app
    .get(ConfigService<AppEnv, true>)
    .get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(
    `DataPulse API listening on http://localhost:${port}/api`,
    'Bootstrap',
  );
}
void bootstrap();
