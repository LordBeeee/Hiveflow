import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetsModule } from '../assets/assets.module';
import { SpacesModule } from '../spaces/spaces.module';
import { TextExecutor } from '../executors/text.executor';
import { InputResolver } from '../executors/input-resolver';
import { ImageUploadExecutor } from '../executors/image-upload.executor';
import { ImageGeneratorExecutor } from '../executors/image-generator.executor';
import { IMAGE_PROVIDER } from '../providers/image-provider';
import { MockImageProvider } from '../providers/mock-image.provider';
import { NodeRunQueue } from '../queue/node-run.queue';
import { NodeRunProcessor } from '../queue/node-run.processor';
import { NodeRunEntity } from './node-run.entity';
import { RunEvents } from './run-events';
import { RunsService } from './runs.service';
import { RunsController } from './runs.controller';
import { BatchEntity } from './batch.entity';
import { BatchesService } from './batches.service';
import { ExecutionController } from './execution.controller';
import { RunCache } from './run-cache';
import { ThrottlerModule } from '@nestjs/throttler';
import { runRateLimit } from './run-rate-limit';
@Module({
  imports: [
    SpacesModule,
    AssetsModule,
    TypeOrmModule.forFeature([NodeRunEntity, BatchEntity]),
    ThrottlerModule.forRoot(runRateLimit),
  ],
  controllers: [RunsController, ExecutionController],
  providers: [
    RunsService,
    BatchesService,
    RunCache,
    InputResolver,
    RunEvents,
    NodeRunQueue,
    NodeRunProcessor,
    TextExecutor,
    ImageUploadExecutor,
    ImageGeneratorExecutor,
    {
      provide: IMAGE_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        if (config.get<string>('IMAGE_PROVIDER') !== 'mock')
          throw new Error(
            'Unknown IMAGE_PROVIDER. Implement and register an adapter in RunsModule.',
          );
        return new MockImageProvider(config);
      },
    },
  ],
})
export class RunsModule {}
