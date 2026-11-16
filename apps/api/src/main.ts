import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.enableCors({ origin: config.get<string>('WEB_ORIGIN') });
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('API_PORT'));
}

void bootstrap();
