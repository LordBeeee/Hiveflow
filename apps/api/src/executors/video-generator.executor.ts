import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  videoGeneratorParamsSchema,
  validateModelParams,
} from '@hiveflow/shared';
import { setTimeout as delay } from 'node:timers/promises';
import { AssetsService } from '../assets/assets.service';
import { ProviderRegistry } from '../providers/provider-registry';
import {
  ProviderError,
  withProviderRetries,
} from '../providers/provider-error';
import type { VideoProvider } from '../providers/video-provider';
import type { ExecutionContext, NodeExecutor } from './node-executor';
@Injectable()
export class VideoGeneratorExecutor implements NodeExecutor {
  readonly type = 'video_generator';
  private readonly logger = new Logger(VideoGeneratorExecutor.name);
  constructor(
    private readonly assets: AssetsService,
    private readonly registry: ProviderRegistry,
    private readonly config: ConfigService,
  ) {}
  private provider(modelId: string) {
    const result = this.registry.forModel(modelId);
    if (
      result.model.kind !== 'video' ||
      !('submit' in result.provider) ||
      !('poll' in result.provider)
    )
      throw new Error(
        'Video provider is not configured. Please choose another model.',
      );
    return { model: result.model, provider: result.provider as VideoProvider };
  }
  async cancelTask(taskId: string, params: Record<string, unknown>) {
    const { provider } = this.provider(String(params.model));
    await provider.cancel?.(taskId);
  }
  async execute(context: ExecutionContext) {
    const params = videoGeneratorParamsSchema.parse(context.params);
    const input = context.inputs?.ports.prompt?.[0];
    const prompt = input?.kind === 'text' ? input.value : params.prompt;
    if (!prompt.trim())
      throw new Error(
        'Enter a prompt or connect non-empty Text or Assistant output before generating video.',
      );
    const { model, provider } = this.provider(params.model);
    validateModelParams(params, model);
    if (
      context.inputs?.ports.end_image?.length &&
      !model.capabilities.supportsEndImage
    )
      throw new Error(
        `${model.label} does not support an end image. Disconnect it or choose another model.`,
      );
    if (!context.runId || !context.checkpointTask)
      throw new Error('Video task checkpoint is unavailable');
    let taskId = context.providerTaskId;
    try {
      if (!taskId) {
        const image = async (port: string) => {
          const value = context.inputs?.ports[port]?.[0];
          return value?.kind === 'asset'
            ? this.assets.providerReference(context.spaceId, value.assetId)
            : undefined;
        };
        const startImage = await image('start_image'),
          endImage = await image('end_image');
        const task = await withProviderRetries(
          () =>
            provider.submit(
              {
                ...params,
                prompt,
                model: model.providerModelId,
                requestId: context.runId!,
                startImage,
                endImage,
              },
              context.signal,
            ),
          {
            signal: context.signal,
            maxRetries: this.config.getOrThrow<number>('PROVIDER_MAX_RETRIES'),
          },
        );
        taskId = task.taskId;
        await context.checkpointTask(taskId);
      }
      let interval = 2000;
      for (;;) {
        context.signal.throwIfAborted();
        let status;
        try {
          status = await provider.poll(taskId, context.signal);
        } catch (error) {
          if (
            !context.signal.aborted &&
            ((error instanceof ProviderError &&
              error.retryable &&
              ['rate_limited', 'unavailable'].includes(error.code)) ||
              (error instanceof TypeError &&
                /fetch|network/i.test(error.message)))
          ) {
            await delay(
              Math.max(
                interval,
                error instanceof ProviderError ? (error.retryAfterMs ?? 0) : 0,
              ),
              undefined,
              { signal: context.signal },
            );
            interval = Math.min(10000, Math.round(interval * 1.5));
            continue;
          }
          throw error;
        }
        if (status.progress !== undefined)
          context.reportProgress?.(status.progress);
        if (status.status === 'failed')
          throw new ProviderError(
            'invalid_request',
            false,
            status.error ?? 'Video generation failed. Please retry.',
          );
        if (status.status === 'succeeded') {
          if (!status.result)
            throw new Error('Video provider returned no result');
          const asset = await this.assets.store(context.spaceId, {
            kind: 'video',
            stream: status.result.stream,
            mime: status.result.mime,
            meta: {
              width: status.result.width,
              height: status.result.height,
              durationMs: status.result.durationMs,
            },
            signal: context.signal,
          });
          context.signal.throwIfAborted();
          return {
            provider: model.provider,
            output: {
              video: [
                {
                  assetId: asset.id,
                  url: asset.url,
                  sha256: asset.sha256,
                  width: asset.width,
                  height: asset.height,
                  durationMs: asset.durationMs,
                },
              ],
            },
          };
        }
        await delay(interval, undefined, { signal: context.signal });
        interval = Math.min(10000, Math.round(interval * 1.5));
      }
    } catch (error) {
      if (context.signal.aborted && taskId)
        await provider.cancel?.(taskId).catch(() => {});
      if (context.signal.aborted) throw context.signal.reason;
      if (error instanceof ProviderError) throw error;
      this.logger.warn('Video task failed; raw provider payload omitted');
      throw new ProviderError(
        'unavailable',
        false,
        'The video task could not complete. Please retry.',
      );
    }
  }
}
