import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { nodeRegistry, veoCatalog } from '@hiveflow/shared';
import { VeoProvider, registerVeo } from './veo.provider';
import { veoError } from './veo-error';
import {
  veoAuthClient,
  veoProjectId,
  veoServiceAccount,
  veoTokenSource,
} from './veo-auth';
import { ProviderRegistry } from './provider-registry';
import { ModelsService } from './models.service';
import { VideoGeneratorExecutor } from '../executors/video-generator.executor';
import type { AssetsService } from '../assets/assets.service';
const signal = new AbortController().signal;
const project = 'offline-project';
const model = 'veo-3.1-generate-001';
const name = `projects/${project}/locations/us-central1/publishers/google/models/${model}/operations/accepted`;
const mp4 = Buffer.from('000000146674797069736f6d0000000069736f6d', 'hex');
const video = {
  mimeType: 'video/mp4',
  bytesBase64Encoded: mp4.toString('base64'),
};
let bytes: Buffer;
let key: string;
let credentials: string;
beforeAll(async () => {
  bytes = await sharp({
    create: { width: 300, height: 300, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  key = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  credentials = JSON.stringify({
    type: 'service_account',
    client_email: 'fixture@offline-project.iam.gserviceaccount.com',
    private_key: key,
  });
});
const image = {
  url: 'http://minio/private-signed-url',
  mime: 'image/png',
  read: async () => bytes,
};
const base = {
  requestId: 'run',
  model,
  prompt: 'A landscape',
  duration: 4,
  resolution: '720p',
  aspectRatio: '16:9',
  generateAudio: false,
};
const json = (value: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
function setup(...responses: Response[]) {
  const send = jest.fn();
  for (const response of responses) send.mockResolvedValueOnce(response);
  const token = jest.fn().mockResolvedValue('fixture-token');
  return {
    send,
    token,
    provider: new VeoProvider(
      { projectId: project, timeoutMs: 1000, maxBytes: 1024 },
      token,
      send,
    ),
    body: () =>
      JSON.parse(send.mock.calls[0][1].body as string) as Record<
        string,
        unknown
      >,
  };
}
it('requires both explicit credentials and project and never falls back to ambient ADC', () => {
  const registry = new ProviderRegistry();
  registry.register('video', 'seedance', { id: 'seedance-2-0' });
  const config = new ConfigService({
    GOOGLE_CLOUD_PROJECT_ID: project,
    PROVIDER_TIMEOUT_MS: 1000,
    MAX_VIDEO_MB: 250,
  });
  registerVeo(registry, config);
  expect(registry.has('video', 'veo')).toBe(false);
  config.set('GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON', credentials);
  config.set('GOOGLE_CLOUD_PROJECT_ID', '');
  registerVeo(registry, config);
  expect(registry.has('video', 'veo')).toBe(false);
  config.set('GOOGLE_CLOUD_PROJECT_ID', project);
  registerVeo(registry, config);
  const rows = new ModelsService(registry).list('video');
  expect(
    rows.filter((row) => row.provider === 'veo' && row.available),
  ).toHaveLength(2);
});
it('validates service-account keys without leaking input and ignores credential-controlled endpoints', () => {
  const input = {
    ...JSON.parse(credentials),
    token_uri: 'http://127.0.0.1/token',
    universe_domain: 'private.example',
    credential_source: { executable: { command: 'do-not-run' } },
  };
  expect(veoServiceAccount(JSON.stringify(input))).toEqual({
    client_email: input.client_email,
    private_key: key,
  });
  const client = veoAuthClient(JSON.stringify(input), 10);
  expect(client.scopes).toEqual([
    'https://www.googleapis.com/auth/cloud-platform',
  ]);
  expect(client.email).toBe(input.client_email);
  for (const raw of [
    'secret-invalid-json',
    JSON.stringify({ type: 'external_account', secret: 'fixture-secret' }),
    JSON.stringify({ ...input, private_key: 'fixture-secret' }),
  ]) {
    expect(() => veoServiceAccount(raw)).toThrow(
      'GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON',
    );
    try {
      veoServiceAccount(raw);
    } catch (error) {
      expect(String(error)).not.toContain('fixture-secret');
    }
  }
  expect(() => veoProjectId('../another-project')).toThrow(
    'GOOGLE_CLOUD_PROJECT_ID',
  );
});
it('asks the official library for a token each time, honors abort/timeout and hides auth errors', async () => {
  const client = {
    getAccessToken: jest
      .fn()
      .mockResolvedValueOnce({ token: 'first' })
      .mockResolvedValueOnce({ token: 'second' }),
  };
  const source = veoTokenSource(client, 1000);
  expect(await source(signal)).toBe('first');
  expect(await source(signal)).toBe('second');
  client.getAccessToken.mockRejectedValueOnce({
    response: { status: 400, data: 'fixture-secret private-key' },
  });
  await expect(source(signal)).rejects.toMatchObject({
    code: 'unavailable',
    retryable: false,
  });
  const stalled = veoTokenSource(
    { getAccessToken: () => new Promise(() => {}) },
    10,
  );
  // Keep the test alive while AbortSignal.timeout's timer is unref'ed.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await expect(stalled(signal)).rejects.toMatchObject({
      code: 'timeout',
      retryable: false,
    });
  } finally {
    clearInterval(keepAlive);
  }
  const controller = new AbortController();
  const pending = source(controller.signal);
  controller.abort(new Error('Local cancel'));
  await expect(pending).rejects.toThrow('Local cancel');
});
it('exchanges and refreshes OAuth tokens through the official JWT client with an offline transport', async () => {
  const client = veoAuthClient(credentials, 1000);
  const exchange = jest
    .spyOn(client.transporter, 'request')
    .mockResolvedValueOnce({
      data: {
        access_token: 'oauth-first',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    } as never)
    .mockResolvedValueOnce({
      data: {
        access_token: 'oauth-renewed',
        expires_in: 3600,
        token_type: 'Bearer',
      },
    } as never);
  const source = veoTokenSource(client, 1000);
  expect(await source(signal)).toBe('oauth-first');
  expect(await source(signal)).toBe('oauth-first');
  expect(exchange).toHaveBeenCalledTimes(1);
  const options = exchange.mock.calls[0][0]!;
  expect(String(options.url)).toBe('https://oauth2.googleapis.com/token');
  const body = options.data as URLSearchParams;
  const assertion = body.get('assertion')!;
  const claims = JSON.parse(
    Buffer.from(assertion.split('.')[1], 'base64url').toString(),
  ) as Record<string, unknown>;
  expect(claims.scope).toBe('https://www.googleapis.com/auth/cloud-platform');
  expect(claims.iss).toBe('fixture@offline-project.iam.gserviceaccount.com');
  client.credentials.expiry_date = Date.now() - 1;
  expect(await source(signal)).toBe('oauth-renewed');
  expect(exchange).toHaveBeenCalledTimes(2);
});
it.each(veoCatalog)(
  'submits $id text-only using exactly one sample and no Cloud Storage destination',
  async (row) => {
    const taskName = name.replace(model, row.providerModelId);
    const c = setup(json({ name: taskName }));
    await expect(
      c.provider.submit({ ...base, model: row.providerModelId }, signal),
    ).resolves.toEqual({ taskId: taskName });
    expect(c.send.mock.calls[0][0]).toBe(
      `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/${row.providerModelId}:predictLongRunning`,
    );
    expect(c.send.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: 'Bearer fixture-token' },
      method: 'POST',
      redirect: 'error',
    });
    expect(c.body()).toEqual({
      instances: [{ prompt: base.prompt }],
      parameters: {
        sampleCount: 1,
        durationSeconds: 4,
        aspectRatio: '16:9',
        resolution: '720p',
        generateAudio: false,
      },
    });
  },
);
it('uses validated JPEG/PNG bytes for both frames and sends explicit audio/ratio', async () => {
  const jpeg = await sharp(bytes).jpeg().toBuffer();
  const c = setup(json({ name }));
  await c.provider.submit(
    {
      ...base,
      startImage: image,
      endImage: { ...image, mime: 'image/jpeg', read: async () => jpeg },
      aspectRatio: '9:16',
      duration: 8,
      resolution: '4k',
      generateAudio: true,
    },
    signal,
  );
  expect(c.body()).toEqual({
    instances: [
      {
        prompt: base.prompt,
        image: {
          bytesBase64Encoded: bytes.toString('base64'),
          mimeType: 'image/png',
        },
        lastFrame: {
          bytesBase64Encoded: jpeg.toString('base64'),
          mimeType: 'image/jpeg',
        },
      },
    ],
    parameters: {
      sampleCount: 1,
      durationSeconds: 8,
      aspectRatio: '9:16',
      resolution: '4k',
      generateAudio: true,
    },
  });
  expect(JSON.stringify(c.body())).not.toContain(image.url);
});
it('rejects unsupported settings, end-only, magic/MIME mismatches and >20 MB before authentication', async () => {
  const c = setup();
  for (const patch of [
    { model: 'unknown' },
    { duration: 5 },
    { aspectRatio: 'adaptive' },
    { model: 'veo-3.1-fast-generate-001', resolution: '4k' },
    { prompt: 'x'.repeat(2501) },
    { prompt: ' ' },
    { endImage: image },
  ])
    await expect(
      c.provider.submit({ ...base, ...patch }, signal),
    ).rejects.toMatchObject({ code: 'invalid_request', retryable: false });
  for (const ref of [
    { ...image, mime: 'image/jpeg' },
    { ...image, mime: 'image/webp' },
    { ...image, read: async () => Buffer.from('not PNG') },
    { ...image, read: async () => Buffer.alloc(20 * 1024 * 1024 + 1) },
  ])
    await expect(
      c.provider.submit({ ...base, startImage: ref }, signal),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  expect(c.token).not.toHaveBeenCalled();
  expect(c.send).not.toHaveBeenCalled();
});
it('refreshes request authorization and polls by the exact full operation name, returning only a stream', async () => {
  const c = setup(
    json({ name }),
    json({ name }),
    json({ name, done: false }),
    json({
      name,
      done: true,
      response: { videos: [video], raiMediaFilteredCount: 0 },
    }),
  );
  c.token
    .mockResolvedValueOnce('first-token')
    .mockResolvedValue('renewed-token');
  const task = await c.provider.submit(base, signal);
  expect(await c.provider.poll(task.taskId, signal)).toEqual({
    status: 'running',
  });
  expect(await c.provider.poll(task.taskId, signal)).toEqual({
    status: 'running',
  });
  const result = await c.provider.poll(task.taskId, signal);
  expect(result.status).toBe('succeeded');
  const chunks: Buffer[] = [];
  for await (const chunk of result.result!.stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks)).toEqual(mp4);
  expect(c.send.mock.calls[1][0]).toBe(
    `https://us-central1-aiplatform.googleapis.com/v1/projects/${project}/locations/us-central1/publishers/google/models/${model}:fetchPredictOperation`,
  );
  expect(JSON.parse(c.send.mock.calls[1][1].body as string)).toEqual({
    operationName: name,
  });
  expect(c.send.mock.calls[1][1].headers.Authorization).toBe(
    'Bearer renewed-token',
  );
  expect(result).not.toHaveProperty('costUsd');
  expect('cancel' in c.provider).toBe(false);
});
it('binds operation names to the configured project, region and selected model', async () => {
  const c = setup(
    json({ name: name.replace(model, 'veo-3.1-fast-generate-001') }),
    json({ name: 'https://private.example/task' }),
  );
  await expect(c.provider.submit(base, signal)).rejects.toThrow(
    'different Veo model',
  );
  await expect(c.provider.submit(base, signal)).rejects.toMatchObject({
    retryable: false,
  });
  const before = c.token.mock.calls.length;
  for (const other of [
    name.replace(project, 'other-project'),
    name.replace('us-central1', 'global'),
    name + '/extra',
    name.replace('/accepted', '/../bad'),
  ])
    await expect(c.provider.poll(other, signal)).rejects.toMatchObject({
      retryable: false,
    });
  expect(c.token).toHaveBeenCalledTimes(before);
});
it.each([
  { videos: [{ gcsUri: 'gs://private/result.mp4', mimeType: 'video/mp4' }] },
  { videos: [{ ...video, bytesBase64Encoded: 'data:video/mp4;base64,AAAA' }] },
  { videos: [{ ...video, bytesBase64Encoded: '====' }] },
  { videos: [{ ...video, bytesBase64Encoded: 'AAAA' }] },
  { videos: [{ ...video, mimeType: 'application/octet-stream' }] },
  { videos: [] },
  { videos: [video, video] },
])(
  'rejects unsupported or malformed results without downloading URLs: %j',
  async (response) => {
    const c = setup(json({ name, done: true, response }));
    await expect(c.provider.poll(name, signal)).rejects.toMatchObject({
      retryable: false,
    });
  },
);
it('enforces inline byte caps and maps RAI-filtered and terminal operations without retrying', async () => {
  const c = setup(
    json({ name, done: true, response: { raiMediaFilteredCount: 1 } }),
    json({
      name,
      done: true,
      error: {
        code: 13,
        message: 'fixture-token https://private.example/task',
      },
    }),
    json({
      name,
      done: true,
      response: {
        videos: [
          {
            ...video,
            bytesBase64Encoded: Buffer.alloc(1025).toString('base64'),
          },
        ],
      },
    }),
  );
  await expect(c.provider.poll(name, signal)).rejects.toMatchObject({
    code: 'content_blocked',
    retryable: false,
    taskId: name,
  });
  await expect(c.provider.poll(name, signal)).rejects.toMatchObject({
    code: 'unavailable',
    retryable: false,
    taskId: name,
  });
  await expect(c.provider.poll(name, signal)).rejects.toThrow(
    'inline size limit',
  );
});
it('resumes through the real adapter without submitting/signing, storing only an asset stream', async () => {
  const c = setup(json({ name, done: true, response: { videos: [video] } }));
  const registry = new ProviderRegistry();
  registry.register('video', 'veo', c.provider);
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
    providerTaskId: name,
    params: {
      ...nodeRegistry.video_generator.defaultParams,
      model: 'veo-3-1',
      duration: 4,
      prompt: 'Scene',
    },
  });
  expect(c.send).toHaveBeenCalledTimes(1);
  expect(c.send.mock.calls[0][0]).toContain(':fetchPredictOperation');
  expect(assets.providerReference).not.toHaveBeenCalled();
  expect(checkpointTask).not.toHaveBeenCalled();
  expect(assets.store.mock.calls[0][1]).toMatchObject({
    stream: expect.any(Readable),
    mime: 'video/mp4',
    kind: 'video',
  });
  expect(result.output.video?.[0].url).toBe('/api/assets/stored');
  expect(JSON.stringify(result)).not.toContain('bytesBase64Encoded');
});
it('checkpoints the full operation before polling and honors local abort without remote cancellation', async () => {
  const c = setup(json({ name }));
  const controller = new AbortController();
  const checkpointTask = jest.fn().mockResolvedValue(undefined);
  c.send.mockImplementationOnce(async () => {
    expect(checkpointTask).toHaveBeenCalledWith(name);
    controller.abort(new Error('Local cancel'));
    throw controller.signal.reason;
  });
  const registry = new ProviderRegistry();
  registry.register('video', 'veo', c.provider);
  const assets = { providerReference: jest.fn(), store: jest.fn() };
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
        model: 'veo-3-1',
        duration: 4,
        prompt: 'Scene',
      },
    }),
  ).rejects.toThrow('Local cancel');
  expect(
    c.send.mock.calls.map((call) => String(call[0]).split(':').at(-1)),
  ).toEqual(['predictLongRunning', 'fetchPredictOperation']);
  expect(assets.store).not.toHaveBeenCalled();
});
it.each([
  [400, 'INVALID_ARGUMENT', 3, 'invalid_request', false],
  [400, 'FAILED_PRECONDITION', 9, 'invalid_request', false],
  [401, 'UNAUTHENTICATED', 16, 'unavailable', false],
  [403, 'PERMISSION_DENIED', 7, 'unavailable', false],
  [404, 'NOT_FOUND', 5, 'unavailable', false],
  [429, 'RESOURCE_EXHAUSTED', 8, 'rate_limited', true],
  [499, 'CANCELLED', 1, 'canceled', false],
  [500, 'UNKNOWN', 2, 'unavailable', true],
  [500, 'INTERNAL', 13, 'unavailable', true],
  [503, 'UNAVAILABLE', 14, 'unavailable', true],
  [504, 'DEADLINE_EXCEEDED', 4, 'timeout', false],
])(
  'maps HTTP %s / %s / RPC %s to %s',
  (status, code, numeric, expected, retryable) => {
    expect(
      veoError(status as number, { error: { status: code } }, '2'),
    ).toMatchObject({ code: expected, retryable });
    expect(veoError(200, { error: { code: numeric } })).toMatchObject({
      code: expected,
      retryable,
    });
  },
);
it('maps documented billing and safety codes, honors Retry-After, and redacts secrets/URLs', async () => {
  expect(
    veoError(403, {
      error: {
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
            domain: 'googleapis.com',
            reason: 'BILLING_DISABLED',
          },
        ],
      },
    }),
  ).toMatchObject({ code: 'insufficient_quota', retryable: false });
  expect(
    veoError(400, { error: { message: 'Support codes: 15236754' } }),
  ).toMatchObject({ code: 'content_blocked', retryable: false });
  expect(veoError(429, {}, '2').retryAfterMs).toBe(2000);
  const c = setup(
    json(
      {
        error: {
          message:
            'fixture-token https://private.example/task gs://private/video.mp4',
        },
      },
      400,
    ),
  );
  await expect(c.provider.submit(base, signal)).rejects.toMatchObject({
    userMessage: '[REDACTED] [URL omitted] [URL omitted]',
  });
});
