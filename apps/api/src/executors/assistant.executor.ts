import type { MediaInput } from '../providers/media-input';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  assistantParamsSchema,
  assistantPresets,
  validateModelParams,
} from '@hiveflow/shared';
import { AssetsService } from '../assets/assets.service';
import { ProviderRegistry } from '../providers/provider-registry';
import {
  ProviderError,
  withProviderRetries,
} from '../providers/provider-error';
import type { LlmProvider } from '../providers/llm-provider';
import type { ExecutionContext, NodeExecutor } from './node-executor';
@Injectable()
export class AssistantExecutor implements NodeExecutor {
  readonly type = 'assistant';
  private readonly logger = new Logger(AssistantExecutor.name);
  constructor(
    private readonly assets: AssetsService,
    private readonly registry: ProviderRegistry,
    private readonly config: ConfigService,
  ) {}
  async execute(context: ExecutionContext) {
    const params = assistantParamsSchema.parse(context.params);
    const text = [
      ...(context.inputs?.ports.context ?? []).flatMap((value) =>
        value.kind === 'text' ? [value.value] : [],
      ),
      params.message,
    ]
      .filter((value) => value.length)
      .join('\n\n');
    if (text.length > 20000)
      throw new Error(
        'Assistant context exceeds 20,000 characters. Shorten the connected context or message.',
      );
    const images = (context.inputs?.ports.images ?? []).flatMap((value) =>
      value.kind === 'asset' && value.mediaKind === 'image' ? [value] : [],
    );
    if (!text.trim() && !images.length)
      throw new Error(
        'Enter a message or connect context or images before running Assistant.',
      );
    const { model, provider } = this.registry.forModel(params.model);
    if (
      model.kind !== 'llm' ||
      !('complete' in provider) ||
      typeof provider.complete !== 'function'
    )
      throw new Error(
        'Assistant provider is not configured. Please choose another model.',
      );
    if (images.length && !model.capabilities.supportsImageInput)
      throw new Error(
        `${model.label} does not support image input. Choose a vision model or disconnect images.`,
      );
    validateModelParams(params, model, images.length);
    const references: MediaInput[] = [];
    for (const image of images) {
      context.signal.throwIfAborted();
      references.push(
        await this.assets.providerReference(context.spaceId, image.assetId),
      );
    }
    const result = await withProviderRetries(
      () =>
        (provider as LlmProvider).complete(
          {
            system: assistantPresets[params.preset].system,
            messages: [
              {
                role: 'user',
                text,
                ...(references.length ? { images: references } : {}),
              },
            ],
            model: model.providerModelId,
            maxTokens: 6000,
          },
          context.signal,
        ),
      {
        signal: context.signal,
        maxRetries: this.config.getOrThrow<number>('PROVIDER_MAX_RETRIES'),
      },
    ).catch((error: unknown) => {
      if (context.signal.aborted) throw context.signal.reason;
      this.logger.warn(
        `Provider ${model.provider} failed (${error instanceof ProviderError ? error.code : 'unknown'}); raw payload omitted`,
      );
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        'unavailable',
        false,
        'The assistant provider is unavailable. Please retry.',
      );
    });
    context.signal.throwIfAborted();
    if (typeof result.text !== 'string' || !result.text.trim())
      throw new Error('The assistant returned no text. Please retry.');
    return {
      output: { text: result.text.slice(0, 20000) },
      provider: model.provider,
    };
  }
}
