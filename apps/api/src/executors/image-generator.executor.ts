import type { MediaInput } from '../providers/media-input';
import { Injectable, Logger } from '@nestjs/common';
import { imageGeneratorParamsSchema } from '@hiveflow/shared';
import { AssetsService } from '../assets/assets.service';
import type { ImageProvider } from '../providers/image-provider';
import { ProviderRegistry } from '../providers/provider-registry';
import {
  withProviderRetries,
  ProviderError,
} from '../providers/provider-error';
import { ConfigService } from '@nestjs/config';
import type { ExecutionContext, NodeExecutor } from './node-executor';
@Injectable()
export class ImageGeneratorExecutor implements NodeExecutor {
  private readonly logger = new Logger(ImageGeneratorExecutor.name);
  readonly type = 'image_generator';
  constructor(
    private readonly assets: AssetsService,
    private readonly registry: ProviderRegistry,
    private readonly config: ConfigService = new ConfigService(),
  ) {}
  async execute(context: ExecutionContext) {
    const params = imageGeneratorParamsSchema.parse(context.params);
    const promptInput = context.inputs?.ports.prompt?.[0];
    const prompt =
      promptInput?.kind === 'text' ? promptInput.value : params.prompt;
    if (!prompt.trim())
      throw new Error(
        'No prompt is available. Connect a non-empty Text node or enter a local prompt in this Image Generator.',
      );
    const references: MediaInput[] = [];
    for (const reference of context.inputs?.ports.references ?? []) {
      if (reference.kind !== 'asset') continue;
      context.signal.throwIfAborted();
      references.push(
        await this.assets.providerReference(context.spaceId, reference.assetId),
      );
    }
    const { model, provider } = this.registry.forModel(params.model);
    if (!('generate' in provider) || typeof provider.generate !== 'function')
      throw new Error('Image provider is not configured');
    const imageProvider = provider as ImageProvider;
    const result = await withProviderRetries(
      () =>
        imageProvider.generate(
          { ...params, model: model.providerModelId, prompt, references },
          context.signal,
        ),
      {
        signal: context.signal,
        maxRetries: this.config.get<number>('PROVIDER_MAX_RETRIES') ?? 2,
      },
    ).catch((error: unknown) => {
      if (context.signal.aborted) throw context.signal.reason;
      this.logger.warn(
        `Provider ${model.provider} failed (${error instanceof ProviderError ? error.code : error instanceof Error ? error.name : 'unknown'}); raw payload omitted`,
      );
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        'unavailable',
        false,
        'The image provider is unavailable. Please retry.',
      );
    });
    const image = [];
    for (const generated of result.images) {
      context.signal.throwIfAborted();
      const asset = await this.assets.store(context.spaceId, {
        kind: 'image',
        bytes: generated.bytes,
        mime: generated.mime,
        meta: { width: generated.width, height: generated.height },
      });
      image.push({
        assetId: asset.id,
        url: asset.url,
        width: asset.width,
        height: asset.height,
        sha256: asset.sha256,
      });
    }
    context.signal.throwIfAborted();
    return { output: { image }, provider: model.provider };
  }
}
