import { ConfigService } from '@nestjs/config';
import { modelCatalog, validateModelParams } from '@hiveflow/shared';
import type {
  VideoProvider,
  VideoRequest,
  VideoBilling,
} from './video-provider';
import { ProviderHttp } from './provider-http';
import { ProviderError } from './provider-error';
import { ProviderRegistry } from './provider-registry';
import { imageDataUri, invalid, validateRequestSize } from './validate-media';
import { klingError } from './kling-error';
import { safeDownload } from './safe-download';
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function malformed(message: string): never {
  throw new ProviderError('unavailable', false, message);
}
function billingRows(value: unknown): VideoBilling[] | undefined {
  if (!Array.isArray(value) || !value.length) return undefined;
  const result: VideoBilling[] = [];
  for (const raw of value) {
    const row = record(raw);
    if (
      !['cash', 'unit'].includes(String(row.charge_type)) ||
      !['number', 'string'].includes(typeof row.amount) ||
      String(row.amount).trim() === ''
    )
      return undefined;
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount < 0) return undefined;
    if (row.charge_type === 'cash') {
      if (row.currency !== 'USD' && row.currency !== 'CNY') return undefined;
      result.push({ chargeType: 'cash', amount, currency: row.currency });
    } else result.push({ chargeType: 'unit', amount });
  }
  return result;
}
export class KlingProvider implements VideoProvider {
  readonly id = 'kling';
  constructor(
    private readonly http: ProviderHttp,
    private readonly maxBytes: number,
    private readonly download = safeDownload,
  ) {}
  private unwrap(data: unknown, model?: string, retryAfter?: string | null) {
    const envelope = record(data);
    if (typeof envelope.code !== 'number')
      malformed(
        'The provider returned an invalid task envelope. Inspect the Kling task history before retrying.',
      );
    if (envelope.code !== 0)
      throw this.http.error(200, envelope, retryAfter, model);
    return envelope.data;
  }
  async submit(request: VideoRequest, signal: AbortSignal) {
    const model = modelCatalog.find(
      (row) =>
        row.provider === 'kling' &&
        row.providerModelId === request.model &&
        row.status !== 'removed',
    );
    if (!model) invalid('Choose a configured Kling model from the catalog.');
    const caps = model.capabilities;
    try {
      validateModelParams(
        { ...request, hasStartImage: !!request.startImage },
        model,
        Number(!!request.startImage) + Number(!!request.endImage),
      );
    } catch (error) {
      invalid(
        error instanceof Error ? error.message : 'Invalid Kling parameters.',
      );
    }
    if (!request.prompt.trim())
      invalid('Enter a prompt before generating video.');
    if (!request.startImage)
      invalid('Connect a start image before generating video.');
    if (request.endImage && !caps.supportsEndImage)
      invalid('This model does not support an end image.');
    const contents: unknown[] = [{ type: 'prompt', text: request.prompt }];
    for (const [image, type] of [
      [request.startImage, 'first_frame'],
      [request.endImage, 'last_frame'],
    ] as const) {
      if (image) {
        const uri = await imageDataUri(image, caps, signal);
        contents.push({ type, url: uri.slice(uri.indexOf(',') + 1) });
      }
    }
    const settings = {
      duration: request.duration,
      resolution: request.resolution,
      ...(caps.supportedParameters?.includes('audio')
        ? { audio: request.generateAudio ? 'native' : 'off' }
        : {}),
      ...(caps.supportedParameters?.includes('multi_shot')
        ? { multi_shot: false }
        : {}),
    };
    const body = { contents, settings };
    validateRequestSize(body, caps);
    const { data, headers } = await this.http.post(
      `/image-to-video/${encodeURIComponent(model.providerModelId)}`,
      body,
      signal,
      false,
      model.label,
    );
    const task = record(
      this.unwrap(data, model.label, headers.get('retry-after')),
    );
    if (typeof task.id !== 'string' || !task.id.trim())
      malformed(
        'The provider accepted no valid video task ID. Check the Kling task history before retrying.',
      );
    return { taskId: task.id };
  }
  async poll(
    taskId: string,
    signal: AbortSignal,
  ): ReturnType<VideoProvider['poll']> {
    const { data, headers } = await this.http.get(
      `/tasks?task_ids=${encodeURIComponent(taskId)}`,
      signal,
    );
    const tasks = this.unwrap(data, undefined, headers.get('retry-after'));
    // The current GET /tasks response is an array, even for one requested ID.
    if (
      !Array.isArray(tasks) ||
      tasks.length !== 1 ||
      record(tasks[0]).id !== taskId
    )
      malformed(
        'The provider returned no matching video task. Check its task history.',
      );
    const task = record(tasks[0]);
    if (task.status === 'submitted') return { status: 'queued' };
    if (task.status === 'processing') return { status: 'running' };
    if (task.status === 'failed') {
      // Current task failures expose message only, no documented service error code.
      const error = this.http.error(400, { message: task.message });
      throw new ProviderError(
        error.code,
        false,
        error.userMessage,
        undefined,
        taskId,
      );
    }
    if (task.status !== 'succeeded')
      malformed('The provider returned an unknown video task status.');
    const video = Array.isArray(task.outputs)
      ? task.outputs.map(record).find((item) => item.type === 'video')
      : undefined;
    if (!video || typeof video.url !== 'string' || !video.url)
      malformed('The provider returned no video result.');
    const result = await this.download(video.url, {
      signal,
      maxBytes: this.maxBytes,
    });
    if (result.mime !== 'video/mp4') {
      result.stream.destroy();
      malformed('The provider returned an unsupported video format.');
    }
    const duration =
      typeof video.duration === 'string' || typeof video.duration === 'number'
        ? Number(video.duration)
        : NaN;
    const billing = billingRows(task.billing);
    const usdOnly = billing?.every(
      (row) => row.chargeType === 'cash' && row.currency === 'USD',
    );
    return {
      status: 'succeeded',
      result: {
        ...result,
        ...(Number.isFinite(duration) && duration > 0
          ? { durationMs: Math.round(duration * 1000) }
          : {}),
      },
      ...(billing ? { billing } : {}),
      ...(usdOnly
        ? { costUsd: billing!.reduce((sum, row) => sum + row.amount, 0) }
        : {}),
    };
  }
  // No documented cancellation endpoint for this API; local abort still applies.
}
export function registerKling(
  registry: ProviderRegistry,
  config: ConfigService,
) {
  const key = config.get<string>('KLING_API_KEY');
  if (!key) return;
  registry.register(
    'video',
    'kling',
    new KlingProvider(
      new ProviderHttp({
        baseUrl: config.getOrThrow<string>('KLING_BASE_URL'),
        headers: { Authorization: `Bearer ${key}` },
        mapError: klingError,
        timeoutMs: config.getOrThrow<number>('PROVIDER_TIMEOUT_MS'),
        maxResponseBytes: 1024 * 1024,
        embeddedErrors: false,
      }),
      config.getOrThrow<number>('MAX_VIDEO_MB') * 1024 * 1024,
    ),
  );
}
