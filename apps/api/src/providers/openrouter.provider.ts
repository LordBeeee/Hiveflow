import { ConfigService } from '@nestjs/config';
import {
  modelCatalog,
  validateModelParams,
  type ModelDefinition,
  type ModelKind,
} from '@hiveflow/shared';
import sharp from 'sharp';
import type { LlmProvider, LlmRequest } from './llm-provider';
import type { ImageProvider, ImageRequest } from './image-provider';
import type { TtsProvider, TtsRequest } from './tts-provider';
import { ProviderRegistry } from './provider-registry';
import { ProviderHttp } from './provider-http';
import { ProviderError } from './provider-error';
import { openrouterError, record } from './openrouter-error';
import { imageDataUri, invalid, validateRequestSize } from './validate-media';
import { mp3Duration, pcmToWav } from './openrouter-audio';
type Catalog = readonly ModelDefinition[];
function modelFor(catalog: Catalog, id: string, kind: ModelKind) {
  const model = catalog.find(
    (entry) =>
      entry.provider === 'openrouter' &&
      entry.providerModelId === id &&
      entry.kind === kind &&
      entry.status !== 'removed',
  );
  if (!model)
    return invalid('Choose a configured OpenRouter model from the catalog.');
  return model;
}
function validate(
  params: Record<string, unknown>,
  model: ModelDefinition,
  count = 0,
) {
  try {
    validateModelParams(params, model, count);
  } catch (error) {
    invalid(
      error instanceof Error ? error.message : 'Invalid model parameters.',
    );
  }
}
function usage(value: unknown) {
  const raw = record(value);
  return {
    ...(typeof raw.prompt_tokens === 'number'
      ? { inputTokens: raw.prompt_tokens }
      : {}),
    ...(typeof raw.completion_tokens === 'number'
      ? { outputTokens: raw.completion_tokens }
      : {}),
    ...(typeof raw.cost === 'number' ? { costUsd: raw.cost } : {}),
  };
}
export class OpenRouterLlmProvider implements LlmProvider {
  readonly id = 'openrouter';
  constructor(
    private readonly http: ProviderHttp,
    private readonly catalog: Catalog = modelCatalog,
  ) {}
  async complete(request: LlmRequest, signal: AbortSignal) {
    const model = modelFor(this.catalog, request.model, 'llm');
    const count = request.messages.reduce(
      (sum, message) => sum + (message.images?.length ?? 0),
      0,
    );
    if (count && !model.capabilities.supportsImageInput)
      invalid(`${model.label} does not support image input.`);
    validate(
      { prompt: request.messages.map((message) => message.text).join('\n') },
      model,
      count,
    );
    const messages: unknown[] = [{ role: 'system', content: request.system }];
    for (const message of request.messages) {
      const content: unknown[] = [{ type: 'text', text: message.text }];
      for (const image of message.images ?? [])
        content.push({
          type: 'image_url',
          image_url: {
            url: await imageDataUri(image, model.capabilities, signal),
          },
        });
      messages.push({ role: message.role, content });
    }
    const body = {
      model: request.model,
      stream: false,
      max_tokens: request.maxTokens,
      messages,
    };
    validateRequestSize(body, model.capabilities);
    const { data } = await this.http.post('/chat/completions', body, signal);
    const result = record(data);
    const choice = record(
      Array.isArray(result.choices) ? result.choices[0] : undefined,
    );
    if (choice.error)
      throw this.http.error(
        200,
        { error: choice.error },
        undefined,
        request.model,
      );
    if (choice.finish_reason === 'content_filter')
      throw new ProviderError(
        'content_blocked',
        false,
        'The provider blocked this content. Revise the prompt.',
      );
    const text = record(choice.message).content;
    if (typeof text !== 'string' || !text.trim())
      throw new ProviderError(
        'unavailable',
        false,
        'The provider returned no text. Please retry.',
      );
    return {
      text,
      ...(result.usage ? { usage: usage(result.usage) } : {}),
      ...(typeof result.id === 'string' ? { generationId: result.id } : {}),
    };
  }
}
export class OpenRouterImageProvider implements ImageProvider {
  readonly id = 'openrouter';
  constructor(
    private readonly http: ProviderHttp,
    private readonly catalog: Catalog = modelCatalog,
  ) {}
  async generate(request: ImageRequest, signal: AbortSignal) {
    const model = modelFor(this.catalog, request.model, 'image');
    validate(
      request as unknown as Record<string, unknown>,
      model,
      request.references.length,
    );
    const supported = model.capabilities.supportedParameters ?? [];
    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
    };
    const optional: Record<string, unknown> = {
      aspect_ratio: request.aspectRatio,
      resolution: request.resolution,
      n: request.count,
      size: request.options?.size,
      quality: request.options?.quality,
      output_format: request.options?.output_format,
      seed: request.options?.seed,
    };
    for (const key of [
      'aspect_ratio',
      'resolution',
      'size',
      'quality',
      'output_format',
      'n',
      'seed',
    ])
      if (supported.includes(key) && optional[key] !== undefined)
        body[key] = optional[key];
    if (typeof body.size === 'string' && /^\d+x\d+$/.test(body.size)) {
      delete body.aspect_ratio;
      delete body.resolution;
    }
    if (request.count > 1 && !supported.includes('n'))
      invalid(`${model.label} does not support multiple images.`);
    if (request.references.length) {
      if (!supported.includes('input_references'))
        invalid(`${model.label} does not support reference images.`);
      body.input_references = await Promise.all(
        request.references.map(async (image) => ({
          type: 'image_url',
          image_url: {
            url: await imageDataUri(image, model.capabilities, signal),
          },
        })),
      );
    }
    validateRequestSize(body, model.capabilities);
    const { data } = await this.http.post('/images', body, signal);
    const result = record(data);
    if (!Array.isArray(result.data) || !result.data.length)
      throw new ProviderError(
        'unavailable',
        false,
        'The provider returned no images.',
      );
    const images = [];
    for (const item of result.data) {
      const image = record(item);
      if (typeof image.b64_json !== 'string' || !image.b64_json)
        throw new ProviderError(
          'unavailable',
          false,
          'The provider returned an invalid image response.',
        );
      if (
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          image.b64_json,
        )
      )
        throw new ProviderError(
          'unavailable',
          false,
          'The provider returned invalid base64 image bytes.',
        );
      const bytes = Buffer.from(image.b64_json, 'base64');
      let meta;
      try {
        meta = await sharp(bytes, { limitInputPixels: 16777216 }).metadata();
      } catch {
        throw new ProviderError(
          'unavailable',
          false,
          'The provider returned an invalid raster image.',
        );
      }
      const formats: Record<string, string> = {
        png: 'image/png',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
      };
      const mime = formats[meta.format ?? ''];
      if (
        !mime ||
        !meta.width ||
        !meta.height ||
        (image.media_type && image.media_type !== mime)
      )
        throw new ProviderError(
          'unavailable',
          false,
          'The provider returned an unsupported image format.',
        );
      images.push({ bytes, mime, width: meta.width, height: meta.height });
    }
    return {
      images,
      ...(result.usage ? { usage: usage(result.usage) } : {}),
      ...(typeof result.id === 'string' ? { generationId: result.id } : {}),
    };
  }
}
export class OpenRouterTtsProvider implements TtsProvider {
  readonly id = 'openrouter';
  constructor(
    private readonly http: ProviderHttp,
    private readonly catalog: Catalog = modelCatalog,
    private readonly duration = mp3Duration,
  ) {}
  async synthesize(request: TtsRequest, signal: AbortSignal) {
    const model = modelFor(this.catalog, request.model, 'tts');
    validate({ ...request, script: request.text }, model);
    if (!request.text.trim())
      invalid('Enter a script before generating speech.');
    if (!model.capabilities.voices?.includes(request.voice))
      invalid(`${model.label} does not support this voice.`);
    const caps = model.capabilities;
    if (caps.supportsSpeed !== true && request.speed !== 1)
      invalid(`${model.label} does not support speed control.`);
    if (!caps.speechProvider || !caps.speechFormat)
      invalid('Speech format/provider must be verified in the model catalog.');
    const body: Record<string, unknown> = {
      model: request.model,
      input: request.text,
      voice: request.voice,
      response_format: caps.speechFormat,
    };
    if (caps.speechProvider === 'elevenlabs' && caps.supportsSpeed === true) {
      body.provider = {
        options: { elevenlabs: { voice_settings: { speed: request.speed } } },
      };
    }
    if (caps.speechProvider === 'google-ai-studio') {
      // The cap is explicit catalog data, never an invented text-to-audio token formula.
      if (
        !Number.isInteger(caps.maxOutputTokens) ||
        !caps.maxOutputTokens ||
        caps.maxOutputTokens <= 0
      )
        invalid(
          'Google speech requires a verified output-token cap in the catalog.',
        );
      body.provider = {
        options: {
          'google-ai-studio': { maxOutputTokens: caps.maxOutputTokens },
        },
      };
    }
    validateRequestSize(body, caps);
    const { data: bytes, headers } = await this.http.post<Buffer>(
      '/audio/speech',
      body,
      signal,
      true,
    );
    const contentType = headers.get('content-type') ?? '';
    const generationId = headers.get('x-generation-id') ?? undefined;
    if (caps.speechFormat === 'pcm')
      return { ...pcmToWav(bytes, contentType), generationId };
    if (
      contentType.split(';')[0].trim().toLowerCase() !== 'audio/mpeg' ||
      !bytes.length
    )
      throw new ProviderError(
        'unavailable',
        false,
        'Expected a nonempty MP3 audio response.',
      );
    const durationMs = await this.duration(bytes);
    signal.throwIfAborted();
    return { bytes, mime: 'audio/mpeg', durationMs, generationId };
  }
}
export function registerOpenRouter(
  registry: ProviderRegistry,
  config: ConfigService,
) {
  const key = config.get<string>('OPENROUTER_API_KEY');
  if (!key) return;
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  const appUrl = config.get<string>('OPENROUTER_APP_URL'),
    appName = config.get<string>('OPENROUTER_APP_NAME');
  if (appUrl) headers['HTTP-Referer'] = appUrl;
  if (appName) headers['X-OpenRouter-Title'] = appName;
  const http = new ProviderHttp({
    baseUrl: config.getOrThrow<string>('OPENROUTER_BASE_URL'),
    headers,
    mapError: openrouterError,
    timeoutMs: config.getOrThrow<number>('PROVIDER_TIMEOUT_MS'),
  });
  registry.register('llm', 'openrouter', new OpenRouterLlmProvider(http));
  registry.register('image', 'openrouter', new OpenRouterImageProvider(http));
  registry.register('tts', 'openrouter', new OpenRouterTtsProvider(http));
}
