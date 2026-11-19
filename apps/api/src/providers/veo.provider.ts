import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { modelCatalog, validateModelParams } from '@hiveflow/shared';
import type { VideoProvider, VideoRequest } from './video-provider';
import { ProviderHttp } from './provider-http';
import { ProviderError } from './provider-error';
import { ProviderRegistry } from './provider-registry';
import { imageDataUri, invalid, validateRequestSize } from './validate-media';
import { veoError } from './veo-error';
import {
  veoAuthClient,
  veoTokenSource,
  veoProjectId,
  type VeoTokenSource,
} from './veo-auth';
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function malformed(message: string): never {
  throw new ProviderError('unavailable', false, message);
}
export interface VeoConfig {
  projectId: string;
  timeoutMs: number;
  maxBytes: number;
}
export class VeoProvider implements VideoProvider {
  readonly id = 'veo';
  constructor(
    private readonly config: VeoConfig,
    private readonly token: VeoTokenSource,
    private readonly transport: typeof fetch = fetch,
  ) {
    veoProjectId(config.projectId);
  }
  private prefix(model: string) {
    return `projects/${this.config.projectId}/locations/us-central1/publishers/google/models/${model}`;
  }
  private operation(name: unknown) {
    if (typeof name !== 'string')
      malformed(
        'The provider returned an invalid operation name. Check operation history before retrying.',
      );
    const model = modelCatalog.find(
      (row) =>
        row.provider === 'veo' &&
        name.startsWith(`${this.prefix(row.providerModelId)}/operations/`),
    );
    const id = model
      ? name.slice(`${this.prefix(model.providerModelId)}/operations/`.length)
      : '';
    if (!model || !/^[a-zA-Z0-9_-]+$/.test(id))
      malformed(
        'The operation does not belong to the configured project, region or Veo model.',
      );
    return { name, model };
  }
  private async http(signal: AbortSignal) {
    const token = await this.token(signal);
    signal.throwIfAborted();
    return new ProviderHttp(
      {
        baseUrl: 'https://us-central1-aiplatform.googleapis.com/v1',
        headers: { Authorization: `Bearer ${token}` },
        mapError: veoError,
        embeddedErrors: false,
        timeoutMs: this.config.timeoutMs,
        maxResponseBytes:
          Math.ceil((this.config.maxBytes * 4) / 3) + 1024 * 1024,
      },
      this.transport,
    );
  }
  async submit(request: VideoRequest, signal: AbortSignal) {
    const model = modelCatalog.find(
      (row) =>
        row.provider === 'veo' &&
        row.providerModelId === request.model &&
        row.status !== 'removed',
    );
    if (!model) invalid('Choose a configured Veo model from the catalog.');
    const caps = model.capabilities;
    try {
      validateModelParams(
        { ...request, hasStartImage: !!request.startImage },
        model,
        Number(!!request.startImage) + Number(!!request.endImage),
      );
    } catch (error) {
      invalid(
        error instanceof Error ? error.message : 'Invalid Veo parameters.',
      );
    }
    if (!request.prompt.trim())
      invalid('Enter a prompt before generating video.');
    if (request.endImage && !request.startImage)
      invalid('Connect a start image before using an end image.');
    const instance: Record<string, unknown> = { prompt: request.prompt };
    for (const [image, field] of [
      [request.startImage, 'image'],
      [request.endImage, 'lastFrame'],
    ] as const) {
      if (image) {
        const uri = await imageDataUri(image, caps, signal);
        const bytesBase64Encoded = uri.slice(uri.indexOf(',') + 1);
        const signature = Buffer.from(
          bytesBase64Encoded.slice(0, 16),
          'base64',
        );
        const png = signature
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        const jpeg =
          signature[0] === 255 && signature[1] === 216 && signature[2] === 255;
        if (
          !(image.mime === 'image/png' && png) &&
          !(image.mime === 'image/jpeg' && jpeg)
        )
          invalid('Reference image must contain valid JPEG or PNG bytes.');
        instance[field] = { bytesBase64Encoded, mimeType: image.mime };
      }
    }
    const body = {
      instances: [instance],
      parameters: {
        sampleCount: 1,
        durationSeconds: request.duration,
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        generateAudio: request.generateAudio,
      },
    };
    validateRequestSize(body, caps);
    const http = await this.http(signal);
    const { data } = await http.post(
      `/${this.prefix(model.providerModelId)}:predictLongRunning`,
      body,
      signal,
      false,
      model.label,
    );
    if (record(data).error) throw http.error(200, data, undefined, model.label);
    const operation = this.operation(record(data).name);
    if (operation.model.id !== model.id)
      malformed(
        'The provider returned an operation for a different Veo model.',
      );
    return { taskId: operation.name };
  }
  async poll(
    taskId: string,
    signal: AbortSignal,
  ): ReturnType<VideoProvider['poll']> {
    const operation = this.operation(taskId);
    const http = await this.http(signal);
    const { data } = await http.post(
      `/${this.prefix(operation.model.providerModelId)}:fetchPredictOperation`,
      { operationName: taskId },
      signal,
      false,
      operation.model.label,
    );
    const task = record(data);
    if (task.name !== taskId)
      malformed('The provider returned a different video operation.');
    if (task.error) {
      const mapped = http.error(200, task, undefined, operation.model.label);
      throw new ProviderError(
        mapped.code,
        false,
        mapped.userMessage,
        undefined,
        taskId,
      );
    }
    if (task.done === false || (task.done === undefined && !task.response))
      return { status: 'running' };
    if (task.done !== true)
      malformed('The provider returned an invalid operation status.');
    const response = record(task.response);
    if (Number(response.raiMediaFilteredCount) > 0)
      throw new ProviderError(
        'content_blocked',
        false,
        'The provider blocked this content. Revise the prompt or media.',
        undefined,
        taskId,
      );
    const videos = response.videos;
    if (!Array.isArray(videos) || videos.length !== 1)
      malformed('The provider returned no single video result.');
    const video = record(videos[0]);
    if (video.gcsUri !== undefined)
      malformed(
        'Unsupported response: Veo returned a gcsUri. Cloud Storage video retrieval is not configured.',
      );
    const value = video.bytesBase64Encoded;
    if (
      video.mimeType !== 'video/mp4' ||
      typeof value !== 'string' ||
      !value.length ||
      value.length % 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
    )
      malformed('The provider returned invalid base64 MP4 video bytes.');
    if (
      (value.length / 4) * 3 -
        (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0) >
      this.config.maxBytes
    )
      malformed('The provider video exceeds the inline size limit.');
    const bytes = Buffer.from(value, 'base64');
    if (
      bytes.toString('base64') !== value ||
      bytes.length < 12 ||
      bytes.toString('ascii', 4, 8) !== 'ftyp' ||
      bytes.readUInt32BE(0) < 12 ||
      bytes.readUInt32BE(0) > bytes.length
    )
      malformed('The provider returned invalid MP4 video bytes.');
    return {
      status: 'succeeded',
      result: { stream: Readable.from([bytes]), mime: 'video/mp4' },
    };
  }
  // Cancellation of model-specific predictLongRunning operations is not documented.
}
export function registerVeo(registry: ProviderRegistry, config: ConfigService) {
  const projectId = config.get<string>('GOOGLE_CLOUD_PROJECT_ID');
  const credentials = config.get<string>('GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON');
  if (!projectId || !credentials) return;
  const timeoutMs = config.getOrThrow<number>('PROVIDER_TIMEOUT_MS');
  registry.register(
    'video',
    'veo',
    new VeoProvider(
      {
        projectId,
        timeoutMs,
        maxBytes:
          Math.min(config.getOrThrow<number>('MAX_VIDEO_MB'), 64) * 1024 * 1024,
      },
      veoTokenSource(
        veoAuthClient(credentials, Math.min(timeoutMs, 30000)),
        Math.min(timeoutMs, 30000),
      ),
    ),
  );
}
