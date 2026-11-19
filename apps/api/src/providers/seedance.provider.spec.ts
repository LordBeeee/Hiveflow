import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { nodeRegistry, seedanceCatalog } from '@hiveflow/shared';
import { ProviderHttp } from './provider-http';
import { seedanceError } from './seedance-error';
import { SeedanceProvider, registerSeedance } from './seedance.provider';
import { ProviderRegistry } from './provider-registry';
import { ModelsService } from './models.service';
import { VideoGeneratorExecutor } from '../executors/video-generator.executor';
import type { AssetsService } from '../assets/assets.service';
const signal = new AbortController().signal;
const request = {
  requestId: 'run',
  model: 'dreamina-seedance-2-0-260128',
  prompt: 'A landscape',
  duration: 4,
  resolution: '480p',
  aspectRatio: '16:9',
  generateAudio: false,
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
function setup(...responses: Response[]) {
  const send = jest.fn();
  for (const response of responses) send.mockResolvedValueOnce(response);
  const download = jest
    .fn()
    .mockResolvedValue({ stream: Readable.from(['mp4']), mime: 'video/mp4' });
  const http = new ProviderHttp(
    {
      baseUrl: 'https://ark.example/api/v3/',
      headers: { Authorization: 'Bearer fixture-secret' },
      mapError: seedanceError,
      embeddedErrors: false,
    },
    send,
  );
  return {
    send,
    download,
    provider: new SeedanceProvider(http, 12345, download),
    body: () =>
      JSON.parse(send.mock.calls[0][1].body as string) as Record<
        string,
        unknown
      >,
  };
}
it('key-gates Seedance availability without changing mock Auto defaults', () => {
  const registry = new ProviderRegistry();
  registry.register('video', 'mock-video', { id: 'mock-video' } as never);
  const config = new ConfigService({
    ARK_BASE_URL: 'https://ark.example/api/v3',
    MAX_VIDEO_MB: 10,
    PROVIDER_TIMEOUT_MS: 1000,
    DEFAULT_VIDEO_MODEL: 'mock-video',
  });
  registerSeedance(registry, config);
  expect(
    new ModelsService(config, registry)
      .list('video')
      .filter((m) => m.provider === 'seedance')
      .every((m) => !m.available),
  ).toBe(true);
  config.set('ARK_API_KEY', 'offline-key');
  registerSeedance(registry, config);
  const models = new ModelsService(config, registry).list('video');
  expect(
    models.filter((m) => m.provider === 'seedance' && m.available),
  ).toHaveLength(2);
  expect(models.find((m) => m.isDefault)?.id).toBe('mock-video');
});
it.each(seedanceCatalog)(
  'submits $id text-only with exact model fields, expiry and audio off',
  async (model) => {
    const c = setup(json({ id: 'accepted' }));
    await expect(
      c.provider.submit({ ...request, model: model.providerModelId }, signal),
    ).resolves.toEqual({ taskId: 'accepted' });
    expect(c.body()).toEqual({
      model: model.providerModelId,
      content: [{ type: 'text', text: request.prompt }],
      duration: 4,
      resolution: '480p',
      ratio: '16:9',
      generate_audio: false,
      execution_expires_after: 3600,
      ...(model.id === 'seedance-2-5' ? { draft: false } : {}),
    });
    expect(c.send.mock.calls[0][0]).toBe(
      'https://ark.example/api/v3/contents/generations/tasks',
    );
    expect(c.send.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-secret' },
      redirect: 'error',
    });
  },
);
it('reads storage bytes for both frame roles and forces 2.5 adaptive ratio', async () => {
  const bytes = await sharp({
    create: { width: 300, height: 300, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  const image = {
    url: 'http://minio/private-signed-url',
    mime: 'image/png',
    read: jest.fn().mockResolvedValue(bytes),
  };
  const c = setup(json({ id: 'task' }));
  await c.provider.submit(
    {
      ...request,
      model: 'dreamina-seedance-2-5-260628',
      startImage: image,
      endImage: image,
      duration: 30,
      resolution: '4k',
      generateAudio: true,
    },
    signal,
  );
  expect(c.body()).toMatchObject({
    ratio: 'adaptive',
    duration: 30,
    resolution: '4k',
    generate_audio: true,
  });
  expect(c.body().content).toEqual([
    { type: 'text', text: request.prompt },
    ...['first_frame', 'last_frame'].map((role) => ({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` },
      role,
    })),
  ]);
  expect(JSON.stringify(c.body())).not.toContain(image.url);
  expect(image.read).toHaveBeenCalledTimes(2);
});
it('rejects invalid capabilities and media before any provider call', async () => {
  const c = setup();
  for (const patch of [
    { duration: 30 },
    { resolution: '8k' },
    { prompt: 'x'.repeat(2501) },
    { model: 'unknown' },
    { prompt: ' ' },
  ])
    await expect(
      c.provider.submit({ ...request, ...patch }, signal),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false });
  const image = {
    url: 'http://private',
    mime: 'image/png',
    read: async () => Buffer.alloc(0),
  };
  await expect(
    c.provider.submit({ ...request, endImage: image }, signal),
  ).rejects.toThrow('start image');
  for (const [width, height] of [
    [299, 300],
    [300, 800],
    [6001, 300],
  ]) {
    const bytes = await sharp({
      create: { width, height, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(
      c.provider.submit(
        { ...request, startImage: { ...image, read: async () => bytes } },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  }
  await expect(
    c.provider.submit(
      {
        ...request,
        startImage: {
          ...image,
          read: async () => Buffer.alloc(10 * 1024 * 1024 + 1),
        },
      },
      signal,
    ),
  ).rejects.toThrow('10 MB');
  expect(c.send).not.toHaveBeenCalled();
});
it('polls accepted IDs and immediately downloads success with no provider auth forwarded', async () => {
  const c = setup(
    json({ status: 'queued' }),
    json({ status: 'running' }),
    json({
      status: 'succeeded',
      duration: 4,
      content: { video_url: 'https://cdn.example/result.mp4?secret=fixture' },
      usage: { completion_tokens: 123 },
    }),
  );
  expect(await c.provider.poll('task/a', signal)).toEqual({ status: 'queued' });
  expect(await c.provider.poll('task/a', signal)).toEqual({
    status: 'running',
  });
  const result = await c.provider.poll('task/a', signal);
  expect(result).toMatchObject({
    status: 'succeeded',
    result: {
      stream: expect.any(Readable),
      mime: 'video/mp4',
      durationMs: 4000,
    },
    usage: { outputTokens: 123 },
  });
  expect(JSON.stringify(result)).not.toContain('cdn.example');
  expect(c.send.mock.calls[0]).toEqual([
    'https://ark.example/api/v3/contents/generations/tasks/task%2Fa',
    expect.objectContaining({ method: 'GET' }),
  ]);
  expect(c.send.mock.calls[0][1].body).toBeUndefined();
  expect(c.download).toHaveBeenCalledWith(
    'https://cdn.example/result.mp4?secret=fixture',
    { signal, maxBytes: 12345 },
  );
});
it.each(['expired', 'cancelled', 'failed'])(
  'makes terminal %s tasks nonretryable',
  async (status) => {
    const c = setup(json({ status, error: { code: 'InternalServiceError' } }));
    await expect(c.provider.poll('accepted', signal)).rejects.toMatchObject({
      retryable: false,
      taskId: 'accepted',
    });
    expect(c.download).not.toHaveBeenCalled();
  },
);
it('rejects malformed IDs/status/results and nonvideo downloads', async () => {
  const c = setup(
    json({}),
    json({ status: 'unknown' }),
    json({ status: 'succeeded' }),
    json({
      status: 'succeeded',
      content: { video_url: 'https://cdn.example/a' },
    }),
  );
  await expect(c.provider.submit(request, signal)).rejects.toMatchObject({
    retryable: false,
  });
  await expect(c.provider.poll('task', signal)).rejects.toThrow('unknown');
  await expect(c.provider.poll('task', signal)).rejects.toThrow('no video');
  const stream = Readable.from(['html']);
  c.download.mockResolvedValueOnce({ stream, mime: 'text/html' });
  await expect(c.provider.poll('task', signal)).rejects.toThrow('unsupported');
  expect(stream.destroyed).toBe(true);
});
it('cancels queued tasks via DELETE/204 and reports a running-task refusal', async () => {
  const c = setup(
    new Response(null, { status: 204 }),
    json(
      {
        error: {
          code: 'OperationDenied.InvalidState',
          message: 'Task already running',
        },
      },
      400,
    ),
  );
  expect(await c.provider.cancel('task')).toBe(true);
  expect(await c.provider.cancel('running')).toBe(false);
  expect(c.send.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  expect(c.send.mock.calls[0][1].body).toBeUndefined();
});
it('resumes the real adapter without POST, signing references, or persisting the result URL', async () => {
  const c = setup(
    json({
      status: 'succeeded',
      content: { video_url: 'https://cdn.example/task.mp4' },
    }),
  );
  const registry = new ProviderRegistry();
  registry.register('video', 'seedance', c.provider);
  const assets = {
    providerReference: jest.fn(),
    store: jest.fn().mockResolvedValue({
      id: 'stored',
      url: '/api/assets/stored',
      sha256: 'hash',
    }),
  };
  const executor = new VideoGeneratorExecutor(
    assets as unknown as AssetsService,
    registry,
    new ConfigService({ PROVIDER_MAX_RETRIES: 2 }),
  );
  const checkpointTask = jest.fn();
  const result = await executor.execute({
    runId: 'run',
    providerTaskId: 'existing',
    spaceId: 'space',
    checkpointTask,
    signal,
    params: {
      ...nodeRegistry.video_generator.defaultParams,
      model: 'seedance-2-0',
      prompt: 'Scene',
      duration: 4,
      resolution: '480p',
    },
  });
  expect(c.send).toHaveBeenCalledTimes(1);
  expect(c.send.mock.calls[0][1].method).toBe('GET');
  expect(checkpointTask).not.toHaveBeenCalled();
  expect(assets.providerReference).not.toHaveBeenCalled();
  expect(assets.store.mock.calls[0][1]).toMatchObject({
    stream: expect.any(Readable),
    mime: 'video/mp4',
    kind: 'video',
  });
  expect(result.output.video?.[0].url).toBe('/api/assets/stored');
  expect(JSON.stringify(result)).not.toContain('cdn.example');
});
it.each([
  [401, 'AuthenticationError', 'unavailable', false],
  [404, 'ModelNotOpen', 'unavailable', false],
  [403, 'OperationDenied.ServiceNotOpen', 'unavailable', false],
  [403, 'OperationDenied.PermissionDenied', 'unavailable', false],
  [429, 'SetLimitExceeded', 'insufficient_quota', false],
  [429, 'QuotaExceeded', 'insufficient_quota', false],
  [403, 'AccountOverdueError', 'insufficient_quota', false],
  [429, 'ModelAccountRpmRateLimitExceeded', 'rate_limited', true],
  [400, 'InputTextSensitiveContentDetected', 'content_blocked', false],
  [500, 'InternalServiceError', 'unavailable', true],
])('maps HTTP %s %s to %s', (status, code, expected, retryable) => {
  expect(
    seedanceError(status as number, { error: { code } }, '2'),
  ).toMatchObject({ code: expected, retryable });
});
it('explains activation, privacy, and Retry-After; redacts secrets and URLs', async () => {
  expect(
    seedanceError(
      404,
      { error: { code: 'ModelNotOpen' } },
      undefined,
      'Seedance 2.5',
    ).message,
  ).toMatch(/Seedance 2.5.*Activation/);
  expect(
    seedanceError(400, {
      error: { code: 'InputImageSensitiveContentDetected.PrivacyInformation' },
    }).message,
  ).toBe('This model does not accept images containing real people.');
  expect(seedanceError(429, {}, '2').retryAfterMs).toBe(2000);
  const c = setup(
    json(
      {
        error: {
          code: 'InvalidParameter',
          message:
            'fixture-secret https://private.example?a=b data:image/png;base64,AAAA',
        },
      },
      400,
    ),
  );
  await expect(c.provider.submit(request, signal)).rejects.toMatchObject({
    userMessage: '[REDACTED] [URL omitted] [media omitted]',
  });
});
