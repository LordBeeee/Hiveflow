import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'node:path';
import { HealthController } from './health.controller';
import { validateEnvironment } from './config';
import { databaseOptions } from './database/options';
import { SpacesModule } from './spaces/spaces.module';
import { AssetsModule } from './assets/assets.module';
import { RunsModule } from './runs/runs.module';

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
    SpacesModule,
    AssetsModule,
    RunsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
