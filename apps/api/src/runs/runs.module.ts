import { registerSeedance } from '../providers/seedance.provider';
import { registerKling } from '../providers/kling.provider';
import { registerVeo } from '../providers/veo.provider';
import { registerOpenRouter } from '../providers/openrouter.provider';
import { DataSource } from 'typeorm';
import { CostsService } from './costs.service';
import { CostsController, UsageController } from './costs.controller';
import { MockVideoProvider } from '../providers/mock-video.provider';
import { VideoGeneratorExecutor } from '../executors/video-generator.executor';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetsModule } from '../assets/assets.module';
import { SpacesModule } from '../spaces/spaces.module';
import { TextExecutor } from '../executors/text.executor';
import { InputResolver } from '../executors/input-resolver';
import { ImageUploadExecutor } from '../executors/image-upload.executor';
import { ImageGeneratorExecutor } from '../executors/image-generator.executor';
import { AssistantExecutor } from '../executors/assistant.executor';
import { VoiceoverExecutor } from '../executors/voiceover.executor';
import { MockTtsProvider } from '../providers/mock-tts.provider';
import { MockLlmProvider } from '../providers/mock-llm.provider';
import { ProviderRegistry } from '../providers/provider-registry';
import { ModelsService, ModelsController } from '../providers/models.service';
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
import { DiscoveryModule } from '@nestjs/core';
import { ExecutorRegistry } from '../executors/executor-registry';
import { CreationsController } from './creations.controller';
@Module({
  imports: [
    DiscoveryModule,
    SpacesModule,
    AssetsModule,
    TypeOrmModule.forFeature([NodeRunEntity, BatchEntity]),
    ThrottlerModule.forRoot(runRateLimit),
  ],
  controllers: [
    CreationsController,
    RunsController,
    ExecutionController,
    ModelsController,
    CostsController,
    UsageController,
  ],
  providers: [
    RunsService,
    CostsService,
    BatchesService,
    RunCache,
    ModelsService,
    InputResolver,
    ExecutorRegistry,
    RunEvents,
    NodeRunQueue,
    NodeRunProcessor,
    TextExecutor,
    ImageUploadExecutor,
    ImageGeneratorExecutor,
    AssistantExecutor,
    VoiceoverExecutor,
    VideoGeneratorExecutor,
    {
      provide: ProviderRegistry,
      inject: [ConfigService, DataSource],
      useFactory: (config: ConfigService, db: DataSource) => {
        if (config.get<string>('IMAGE_PROVIDER') !== 'mock')
          throw new Error(
            'Unknown IMAGE_PROVIDER. Implement and register an adapter in RunsModule.',
          );
        const registry = new ProviderRegistry();
        registry.register('image', 'mock', new MockImageProvider(config));
        registry.register('llm', 'mock', new MockLlmProvider(config));
        registry.register('tts', 'mock', new MockTtsProvider(config));
        registry.register(
          'video',
          'mock-video',
          new MockVideoProvider(config, db),
        );
        registerOpenRouter(registry, config);
        registerSeedance(registry, config);
        registerKling(registry, config);
        registerVeo(registry, config);
        return registry;
      },
    },
  ],
})
export class RunsModule {}
