import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { voiceoverParamsSchema, validateModelParams } from '@hiveflow/shared';
import { AssetsService } from '../assets/assets.service';
import { ProviderRegistry } from '../providers/provider-registry';
import {
  ProviderError,
  withProviderRetries,
} from '../providers/provider-error';
import type { TtsProvider } from '../providers/tts-provider';
import type { ExecutionContext, NodeExecutor } from './node-executor';
@Injectable()
export class VoiceoverExecutor implements NodeExecutor {
  readonly type = 'voiceover';
  private readonly logger = new Logger(VoiceoverExecutor.name);
  constructor(
    private readonly assets: AssetsService,
    private readonly registry: ProviderRegistry,
    private readonly config: ConfigService,
  ) {}
  async execute(context: ExecutionContext) {
    const params = voiceoverParamsSchema.parse(context.params);
    const connected = context.inputs?.ports.script?.[0];
    const text = connected?.kind === 'text' ? connected.value : params.script;
    if (!text.trim())
      throw new Error(
        'No script is available. Connect non-empty Text or Assistant output, or enter a local script.',
      );
    if (text.length > 5000)
      throw new Error(
        'Voiceover script exceeds 5,000 characters. Shorten the connected script before running.',
      );
    const { model, provider } = this.registry.forModel(params.model);
    if (
      model.kind !== 'tts' ||
      !('synthesize' in provider) ||
      typeof provider.synthesize !== 'function'
    )
      throw new Error(
        'Voiceover provider is not configured. Please choose another model.',
      );
    validateModelParams({ ...params, script: text }, model);
    const result = await withProviderRetries(
      () =>
        (provider as TtsProvider).synthesize(
          {
            text,
            voice: params.voice,
            language: params.language,
            speed: params.speed,
            model: model.providerModelId,
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
        'The voiceover provider is unavailable. Please retry.',
      );
    });
    context.signal.throwIfAborted();
    const asset = await this.assets.store(context.spaceId, {
      kind: 'audio',
      bytes: result.bytes,
      mime: result.mime,
      meta: { durationMs: result.durationMs },
    });
    context.signal.throwIfAborted();
    return {
      provider: model.provider,
      output: {
        audio: [
          {
            assetId: asset.id,
            url: asset.url,
            sha256: asset.sha256,
            durationMs: asset.durationMs,
          },
        ],
      },
    };
  }
}
