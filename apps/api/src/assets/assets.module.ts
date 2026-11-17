import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpacesModule } from '../spaces/spaces.module';
import { AssetEntity } from './asset.entity';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { S3StorageService, StorageService } from './storage.service';
@Module({
  imports: [
    SpacesModule,
    TypeOrmModule.forFeature([AssetEntity]),
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: config.getOrThrow<number>('MAX_UPLOAD_MB') * 1024 * 1024,
          files: 1,
          fields: 1,
        },
      }),
    }),
  ],
  controllers: [AssetsController],
  providers: [
    AssetsService,
    { provide: StorageService, useClass: S3StorageService },
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
