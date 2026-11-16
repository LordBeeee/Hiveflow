import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'node:path';
import { HealthController } from './health.controller';
import { validateEnvironment } from './config';
import { databaseOptions } from './database/options';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(__dirname, '../../../.env'), '.env'],
      validate: validateEnvironment,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        databaseOptions(config.getOrThrow<string>('DATABASE_URL')),
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
