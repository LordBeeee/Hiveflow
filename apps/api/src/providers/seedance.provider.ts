import { ConfigService } from '@nestjs/config';
import { modelCatalog, validateModelParams } from '@hiveflow/shared';
import type { VideoProvider, VideoRequest } from './video-provider';
import { ProviderHttp } from './provider-http';
import { ProviderError } from './provider-error';
import { ProviderRegistry } from './provider-registry';
import { imageDataUri, invalid, validateRequestSize } from './validate-media';
import { seedanceError } from './seedance-error';
import { safeDownload } from './safe-download';
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function malformed(message: string): never {
  throw new ProviderError('unavailable', false, message);
}
export class SeedanceProvider implements VideoProvider {
  readonly id = 'seedance';
  constructor(
    private readonly http: ProviderHttp,
    private readonly maxBytes: number,
    private readonly download = safeDownload,
  ) {}
  async submit(request: VideoRequest, signal: AbortSignal) {
    const model = modelCatalog.find(
      (row) =>
        row.provider === 'seedance' &&
        row.providerModelId === request.model &&
        row.status !== 'removed',
    );
    if (!model) invalid('Choose a configured Seedance model from the catalog.');
    const caps = model.capabilities;
    try {
      validateModelParams(
        { ...request, hasStartImage: !!request.startImage },
        model,
        Number(!!request.startImage) + Number(!!request.endImage),
      );
    } catch (error) {
      invalid(
        error instanceof Error ? error.message : 'Invalid Seedance parameters.',
      );
    }
    if (!request.prompt.trim())
      invalid('Enter a prompt before generating video.');
    if (request.endImage && !request.startImage)
      invalid('Connect a start image before using an end image.');
    if (request.endImage && !caps.supportsEndImage)
      invalid('This model does not support an end image.');
    const content: unknown[] = [{ type: 'text', text: request.prompt }];
    for (const [image, role] of [
      [request.startImage, 'first_frame'],
      [request.endImage, 'last_frame'],
    ] as const)
      if (image)
        content.push({
          type: 'image_url',
          image_url: { url: await imageDataUri(image, caps, signal) },
          role,
        });
    const body = {
      model: request.model,
      content,
      duration: request.duration,
      resolution: request.resolution,
      ratio:
        request.startImage && caps.imageToVideoRatio === 'adaptive'
          ? 'adaptive'
          : request.aspectRatio,
      ...(caps.audio === 'toggle'
        ? { generate_audio: request.generateAudio }
        : {}),
      ...(caps.supportsDraft ? { draft: false } : {}),
      execution_expires_after: caps.executionExpiresAfter,
    };
    validateRequestSize(body, caps);
    const { data } = await this.http.post(
      '/contents/generations/tasks',
      body,
      signal,
    );
    const id = record(data).id;
    if (typeof id !== 'string' || !id.trim())
      malformed(
        'The provider accepted no valid video task ID. Check the ModelArk task history before retrying.',
      );
    return { taskId: id };
  }
  async poll(
    taskId: string,
    signal: AbortSignal,
  ): ReturnType<VideoProvider['poll']> {
    const { data } = await this.http.get(
      `/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      signal,
    );
    const task = record(data);
    const status = task.status;
    if (status === 'queued' || status === 'running') return { status };
    if (status === 'failed') {
      const mapped = this.http.error(
        400,
        { error: task.error },
        undefined,
        typeof task.model === 'string' ? task.model : 'Seedance model',
      );
      throw new ProviderError(
        mapped.code,
        false,
        mapped.userMessage,
        undefined,
        taskId,
      );
    }
    if (status === 'expired' || status === 'cancelled')
      throw new ProviderError(
        status === 'expired' ? 'timeout' : 'canceled',
        false,
        status === 'expired'
          ? 'The provider video task expired. Please run again.'
          : 'The provider video task was canceled.',
        undefined,
        taskId,
      );
    if (status !== 'succeeded')
      malformed('The provider returned an unknown video task status.');
    const url = record(task.content).video_url;
    if (typeof url !== 'string' || !url)
      malformed('The provider returned no video result.');
    const result = await this.download(url, {
      signal,
      maxBytes: this.maxBytes,
    });
    if (result.mime !== 'video/mp4') {
      result.stream.destroy();
      malformed('The provider returned an unsupported video format.');
    }
    return {
      status: 'succeeded' as const,
      result: {
        ...result,
        ...(typeof task.duration === 'number' && task.duration > 0
          ? { durationMs: Math.round(task.duration * 1000) }
          : {}),
      },
      ...(typeof record(task.usage).completion_tokens === 'number'
        ? {
            usage: {
              outputTokens: record(task.usage).completion_tokens as number,
            },
          }
        : {}),
    };
  }
  async cancel(taskId: string) {
    try {
      await this.http.delete(
        `/contents/generations/tasks/${encodeURIComponent(taskId)}`,
        AbortSignal.timeout(10000),
      );
    } catch (error) {
      if (error instanceof ProviderError && error.code === 'invalid_request')
        return false;
      throw error;
    }
    return true;
  }
}
export function registerSeedance(
  registry: ProviderRegistry,
  config: ConfigService,
) {
  const key = config.get<string>('ARK_API_KEY');
  if (!key) return;
  registry.register(
    'video',
    'seedance',
    new SeedanceProvider(
      new ProviderHttp({
        baseUrl: config.getOrThrow<string>('ARK_BASE_URL'),
        headers: { Authorization: `Bearer ${key}` },
        mapError: seedanceError,
        timeoutMs: config.getOrThrow<number>('PROVIDER_TIMEOUT_MS'),
        maxResponseBytes: 1024 * 1024,
        embeddedErrors: false,
      }),
      config.getOrThrow<number>('MAX_VIDEO_MB') * 1024 * 1024,
    ),
  );
}
