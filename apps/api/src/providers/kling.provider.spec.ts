import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { klingCatalog, nodeRegistry } from '@hiveflow/shared';
import { ProviderHttp } from './provider-http';
import { klingError } from './kling-error';
import { KlingProvider, registerKling } from './kling.provider';
import { ProviderRegistry } from './provider-registry';
import { ModelsService } from './models.service';
import { VideoGeneratorExecutor } from '../executors/video-generator.executor';
import type { AssetsService } from '../assets/assets.service';
const signal = new AbortController().signal;
const json = (data: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const envelope = (data: unknown) => json({ code: 0, data });
let bytes: Buffer;
beforeAll(async () => {
  bytes = await sharp({
    create: { width: 300, height: 300, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
});
const image = {
  url: 'http://minio/private-signed-url',
  mime: 'image/png',
  read: async () => bytes,
};
const base = {
  requestId: 'run',
  model: 'kling-3.0',
  prompt: 'A landscape',
  duration: 3,
  resolution: '720p',
  aspectRatio: 'adaptive',
  generateAudio: false,
  startImage: image,
};
function setup(...responses: Response[]) {
  const send = jest.fn();
  for (const response of responses) send.mockResolvedValueOnce(response);
  const download = jest
    .fn()
    .mockResolvedValue({ stream: Readable.from(['mp4']), mime: 'video/mp4' });
  const provider = new KlingProvider(
    new ProviderHttp(
      {
        baseUrl: 'https://kling.example/',
        headers: { Authorization: 'Bearer fixture-secret' },
        mapError: klingError,
        embeddedErrors: false,
      },
      send,
    ),
    12345,
    download,
  );
  return {
    send,
    download,
    provider,
    body: () =>
      JSON.parse(send.mock.calls[0][1].body as string) as Record<
        string,
        unknown
      >,
  };
}
it('registers only with its key without choosing a default model', () => {
  const registry = new ProviderRegistry();
  registry.register('video', 'seedance', { id: 'seedance-2-0' });
  const config = new ConfigService({
    KLING_BASE_URL: 'https://kling.example',
    MAX_VIDEO_MB: 250,
    PROVIDER_TIMEOUT_MS: 1000,
  });
  registerKling(registry, config);
  expect(registry.has('video', 'kling')).toBe(false);
  config.set('KLING_API_KEY', 'offline-key');
  registerKling(registry, config);
  const rows = new ModelsService(registry).list('video');
  expect(
    rows.filter((row) => row.provider === 'kling' && row.available),
  ).toHaveLength(2);
});
it.each(klingCatalog)(
  'sends exact $id settings and raw base64 first frame, never signed URLs/JWT',
  async (model) => {
    const c = setup(envelope({ id: 'accepted', status: 'submitted' }));
    expect(
      await c.provider.submit(
        { ...base, model: model.providerModelId },
        signal,
      ),
    ).toEqual({ taskId: 'accepted' });
    expect(c.send.mock.calls[0][0]).toBe(
      `https://kling.example/image-to-video/${model.providerModelId}`,
    );
    expect(c.send.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-secret' },
      redirect: 'error',
    });
    expect(c.body()).toEqual({
      contents: [
        { type: 'prompt', text: base.prompt },
        { type: 'first_frame', url: bytes.toString('base64') },
      ],
      settings: {
        duration: 3,
        resolution: '720p',
        ...(model.capabilities.audio === 'toggle'
          ? { audio: 'off', multi_shot: false }
          : {}),
      },
    });
    expect(JSON.stringify(c.body())).not.toContain(image.url);
    expect(JSON.stringify(c.body())).not.toContain('data:');
  },
);
it('sends a supported last frame, 4k and native audio on standard 3.0', async () => {
  const c = setup(envelope({ id: 'accepted' }));
  await c.provider.submit(
    {
      ...base,
      endImage: image,
      resolution: '4k',
      duration: 15,
      generateAudio: true,
      aspectRatio: '16:9',
    },
    signal,
  );
  expect(c.body()).toMatchObject({
    contents: [
      { type: 'prompt' },
      { type: 'first_frame' },
      { type: 'last_frame', url: bytes.toString('base64') },
    ],
    settings: {
      duration: 15,
      resolution: '4k',
      audio: 'native',
      multi_shot: false,
    },
  });
  expect(c.body()).not.toHaveProperty('aspect_ratio');
});
it('rejects missing start, turbo end/4k and invalid duration/prompt/media before HTTP', async () => {
  const c = setup();
  for (const patch of [
    { startImage: undefined },
    { model: 'unknown' },
    { duration: 2 },
    { duration: 16 },
    { prompt: ' ' },
    { prompt: 'x'.repeat(3073) },
    { model: 'kling-3.0-turbo', endImage: image },
    { model: 'kling-3.0-turbo', resolution: '4k' },
    { model: 'kling-3.0-turbo', prompt: 'x'.repeat(2501) },
  ])
    await expect(
      c.provider.submit({ ...base, ...patch }, signal),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false });
  for (const [width, height] of [
    [299, 300],
    [300, 800],
  ]) {
    const raster = await sharp({
      create: { width, height, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(
      c.provider.submit(
        { ...base, startImage: { ...image, read: async () => raster } },
        signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  }
  await expect(
    c.provider.submit(
      { ...base, startImage: { ...image, mime: 'image/webp' } },
      signal,
    ),
  ).rejects.toThrow('format');
  await expect(
    c.provider.submit(
      {
        ...base,
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
it('submits, polls exact current states and immediately downloads the video output', async () => {
  const c = setup(
    envelope({ id: 'task/a' }),
    envelope([{ id: 'task/a', status: 'submitted' }]),
    envelope([{ id: 'task/a', status: 'processing' }]),
    envelope([
      {
        id: 'task/a',
        status: 'succeeded',
        outputs: [
          { type: 'image', url: 'https://cdn.example/ignore.png' },
          {
            type: 'video',
            url: 'https://cdn.example/a.mp4?token=secret',
            duration: '3',
          },
        ],
        billing: [{ charge_type: 'cash', amount: '0.1', currency: 'USD' }],
      },
    ]),
  );
  const { taskId } = await c.provider.submit(base, signal);
  expect(await c.provider.poll(taskId, signal)).toEqual({ status: 'queued' });
  expect(await c.provider.poll(taskId, signal)).toEqual({ status: 'running' });
  const result = await c.provider.poll(taskId, signal);
  expect(result).toMatchObject({
    status: 'succeeded',
    result: {
      stream: expect.any(Readable),
      mime: 'video/mp4',
      durationMs: 3000,
    },
    costUsd: 0.1,
    billing: [{ chargeType: 'cash', amount: 0.1, currency: 'USD' }],
  });
  expect(c.send.mock.calls[1][0]).toBe(
    'https://kling.example/tasks?task_ids=task%2Fa',
  );
  expect(c.send.mock.calls[1][1]).toMatchObject({ method: 'GET' });
  expect(c.send.mock.calls[1][1].body).toBeUndefined();
  expect(c.download).toHaveBeenCalledWith(
    'https://cdn.example/a.mp4?token=secret',
    { signal, maxBytes: 12345 },
  );
  expect(JSON.stringify(result)).not.toContain('cdn.example');
});
it.each([
  [{ charge_type: 'unit', amount: '3' }],
  [{ charge_type: 'cash', currency: 'CNY', amount: '3' }],
  [
    { charge_type: 'cash', currency: 'USD', amount: '0.1' },
    { charge_type: 'unit', amount: '2' },
  ],
  [{ charge_type: 'cash', currency: 'USD', amount: '' }],
  [{ charge_type: 'cash', currency: 'USD', amount: '-1' }],
])(
  'does not label non-USD, mixed or malformed billing as dollars: %j',
  async (...billing) => {
    // jest.each expands each row; reconstruct the API billing array.
    const c = setup(
      envelope([
        {
          id: 'task',
          status: 'succeeded',
          outputs: [{ type: 'video', url: 'https://cdn.example/a.mp4' }],
          billing,
        },
      ]),
    );
    expect(await c.provider.poll('task', signal)).not.toHaveProperty('costUsd');
  },
);
it('keeps failed tasks terminal and sanitizes their messages; no remote cancel exists', async () => {
  const c = setup(
    envelope([
      {
        id: 'task',
        status: 'failed',
        message: 'fixture-secret https://private.example/token',
      },
    ]),
  );
  await expect(c.provider.poll('task', signal)).rejects.toMatchObject({
    retryable: false,
    taskId: 'task',
    userMessage: '[REDACTED] [URL omitted]',
  });
  expect('cancel' in c.provider).toBe(false);
  expect(c.download).not.toHaveBeenCalled();
});
it('handles nonzero HTTP-200 envelopes, Retry-After and permission errors with model context', async () => {
  const c = setup(
    json({ code: 1303, message: 'slow' }, 200, { 'retry-after': '2' }),
    json({ code: 1103 }, 403),
  );
  await expect(c.provider.submit(base, signal)).rejects.toMatchObject({
    code: 'rate_limited',
    retryable: true,
    retryAfterMs: 2000,
  });
  await expect(c.provider.submit(base, signal)).rejects.toThrow(
    'Kling 3.0 is unavailable',
  );
});
it('rejects undocumented envelopes, legacy statuses, wrong IDs and missing/nonvideo results', async () => {
  const c = setup(
    json({ data: { id: 'task' } }),
    envelope({ task_id: 'legacy' }),
    envelope([]),
    envelope([{ id: 'other', status: 'succeeded' }]),
    envelope([{ id: 'task', status: 'succeed' }]),
    envelope([{ id: 'task', status: 'succeeded', outputs: [] }]),
    envelope([
      {
        id: 'task',
        status: 'succeeded',
        outputs: [{ type: 'video', url: 'https://cdn.example/a' }],
      },
    ]),
  );
  await expect(c.provider.submit(base, signal)).rejects.toThrow('envelope');
  await expect(c.provider.submit(base, signal)).rejects.toThrow('task ID');
  for (let i = 0; i < 4; i++)
    await expect(c.provider.poll('task', signal)).rejects.toMatchObject({
      retryable: false,
    });
  const stream = Readable.from(['html']);
  c.download.mockResolvedValueOnce({ stream, mime: 'text/html' });
  await expect(c.provider.poll('task', signal)).rejects.toThrow('unsupported');
  expect(stream.destroyed).toBe(true);
});
it('resumes the real adapter with GET only and streams into stored assets', async () => {
  const c = setup(
    envelope([
      {
        id: 'existing',
        status: 'succeeded',
        outputs: [{ type: 'video', url: 'https://cdn.example/a' }],
      },
    ]),
  );
  const registry = new ProviderRegistry();
  registry.register('video', 'kling', c.provider);
  const assets = {
    providerReference: jest.fn(),
    store: jest.fn().mockResolvedValue({
      id: 'stored',
      url: '/api/assets/stored',
      sha256: 'hash',
    }),
  };
  const checkpointTask = jest.fn();
  const executor = new VideoGeneratorExecutor(
    assets as unknown as AssetsService,
    registry,
    new ConfigService({ PROVIDER_MAX_RETRIES: 2 }),
  );
  const result = await executor.execute({
    runId: 'run',
    spaceId: 'space',
    signal,
    checkpointTask,
    providerTaskId: 'existing',
    params: {
      ...nodeRegistry.video_generator.defaultParams,
      model: 'kling-3-0',
      aspectRatio: 'adaptive',
      prompt: 'Scene',
    },
    inputs: {
      ports: {
        start_image: [
          {
            kind: 'asset',
            assetId: 'input',
            sha256: 'hash',
            mediaKind: 'image',
          },
        ],
      },
    },
  });
  expect(c.send).toHaveBeenCalledTimes(1);
  expect(c.send.mock.calls[0][1].method).toBe('GET');
  expect(assets.providerReference).not.toHaveBeenCalled();
  expect(checkpointTask).not.toHaveBeenCalled();
  expect(assets.store.mock.calls[0][1]).toMatchObject({
    stream: expect.any(Readable),
    kind: 'video',
    mime: 'video/mp4',
  });
  expect(result.output.video?.[0].url).toBe('/api/assets/stored');
  expect(JSON.stringify(result)).not.toContain('cdn.example');
});
it('checkpoints acceptance before polling and honors local abort without inventing a remote cancel', async () => {
  const c = setup(envelope({ id: 'accepted' }));
  const controller = new AbortController();
  const checkpointTask = jest.fn().mockResolvedValue(undefined);
  c.send.mockImplementationOnce(async () => {
    expect(checkpointTask).toHaveBeenCalledWith('accepted');
    controller.abort(new Error('Local cancel'));
    throw controller.signal.reason;
  });
  const registry = new ProviderRegistry();
  registry.register('video', 'kling', c.provider);
  const assets = {
    providerReference: jest.fn().mockResolvedValue(image),
    store: jest.fn(),
  };
  const executor = new VideoGeneratorExecutor(
    assets as unknown as AssetsService,
    registry,
    new ConfigService({ PROVIDER_MAX_RETRIES: 2 }),
  );
  await expect(
    executor.execute({
      runId: 'run',
      spaceId: 'space',
      signal: controller.signal,
      checkpointTask,
      params: {
        ...nodeRegistry.video_generator.defaultParams,
        model: 'kling-3-0',
        aspectRatio: 'adaptive',
        prompt: 'Scene',
      },
      inputs: {
        ports: {
          start_image: [
            {
              kind: 'asset',
              assetId: 'input',
              sha256: 'hash',
              mediaKind: 'image',
            },
          ],
        },
      },
    }),
  ).rejects.toThrow('Local cancel');
  expect(
    c.send.mock.calls.map((call) => (call[1] as RequestInit).method),
  ).toEqual(['POST', 'GET']);
  expect(assets.store).not.toHaveBeenCalled();
});
it.each([
  [401, 1000, 'unavailable', false],
  [401, 1001, 'unavailable', false],
  [401, 1002, 'unavailable', false],
  [401, 1003, 'unavailable', false],
  [401, 1004, 'unavailable', false],
  [429, 1100, 'unavailable', false],
  [429, 1101, 'insufficient_quota', false],
  [429, 1102, 'insufficient_quota', false],
  [403, 1103, 'unavailable', false],
  [400, 1200, 'invalid_request', false],
  [400, 1201, 'invalid_request', false],
  [404, 1202, 'invalid_request', false],
  [404, 1203, 'unavailable', false],
  [400, 1300, 'invalid_request', false],
  [400, 1301, 'content_blocked', false],
  [429, 1302, 'rate_limited', true],
  [429, 1303, 'rate_limited', true],
  [429, 1304, 'unavailable', false],
  [500, 5000, 'unavailable', true],
  [503, 5001, 'unavailable', true],
  [504, 5002, 'unavailable', true],
])(
  'maps official HTTP %s / service %s to %s',
  (status, code, expected, retryable) => {
    expect(
      klingError(status as number, { code, message: 'fixture' }),
    ).toMatchObject({ code: expected, retryable });
  },
);
