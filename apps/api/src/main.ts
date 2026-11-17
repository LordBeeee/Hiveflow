import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import type { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '2mb' });
  const config = app.get(ConfigService);
  app.enableCors({ origin: config.get<string>('WEB_ORIGIN') });
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('API_PORT'));
}

void bootstrap();
