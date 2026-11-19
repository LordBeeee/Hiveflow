import { ConfigService } from '@nestjs/config';
import { type ModelDefinition } from '@hiveflow/shared';
import sharp from 'sharp';
import { ProviderHttp } from './provider-http';
import { ProviderRegistry } from './provider-registry';
import { openrouterError } from './openrouter-error';
import {
  OpenRouterImageProvider,
  OpenRouterLlmProvider,
  OpenRouterTtsProvider,
  registerOpenRouter,
} from './openrouter.provider';
const signal = new AbortController().signal;
// Handwritten contract rows exercise the documented wire protocol; these are not production catalog choices.
const base: ModelDefinition = {
  id: 'fixture',
  provider: 'openrouter',
  providerModelId: 'fixture',
  label: 'Fixture',
  kind: 'llm',
  status: 'active',
  capabilities: {},
  options: [],
  costUnits: 1,
};
function client(response: Response) {
  const send = jest.fn().mockResolvedValue(response);
  return {
    send,
    http: new ProviderHttp(
      {
        baseUrl: 'https://openrouter.ai/api/v1',
        headers: { Authorization: 'Bearer test-key' },
        mapError: openrouterError,
      },
      send,
    ),
    body: () =>
      JSON.parse(send.mock.calls[0][1].body as string) as Record<
        string,
        unknown
      >,
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
it('registers all three kinds only with a key; does not perform discovery or change mocks', () => {
  const registry = new ProviderRegistry();
  registerOpenRouter(registry, new ConfigService());
  expect(registry.has('llm', 'openrouter')).toBe(false);
  registerOpenRouter(
    registry,
    new ConfigService({
      OPENROUTER_API_KEY: 'test-key',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      PROVIDER_TIMEOUT_MS: 1000,
    }),
  );
  for (const kind of ['llm', 'image', 'tts'] as const)
    expect(registry.has(kind, 'openrouter')).toBe(true);
});
it('sends nonstreaming text parts plus byte-based images only to vision models', async () => {
  const c = client(
    json({
      choices: [{ message: { content: 'A cabin' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 4, cost: 0.01 },
    }),
  );
  const model = {
    ...base,
    capabilities: { supportsImageInput: true, maxReferences: 1 },
  };
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  const request = {
    model: 'fixture',
    system: 'help',
    maxTokens: 6000,
    messages: [
      {
        role: 'user' as const,
        text: 'describe',
        images: [
          {
            url: 'http://minio:9000/private',
            mime: 'image/png',
            read: async () => bytes,
          },
        ],
      },
    ],
  };
  const result = await new OpenRouterLlmProvider(c.http, [model]).complete(
    request,
    signal,
  );
  expect(result).toMatchObject({
    text: 'A cabin',
    usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.01 },
  });
  expect(c.body()).toEqual({
    model: 'fixture',
    stream: false,
    max_tokens: 6000,
    messages: [
      { role: 'system', content: 'help' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${bytes.toString('base64')}`,
            },
          },
        ],
      },
    ],
  });
  await expect(
    new OpenRouterLlmProvider(c.http, [base]).complete(request, signal),
  ).rejects.toMatchObject({ code: 'invalid_request' });
  expect(c.send).toHaveBeenCalledTimes(1);
});
it('does not return partial failed chat content and redacts embedded errors', async () => {
  const c = client(
    json({
      choices: [
        {
          finish_reason: 'error',
          message: { content: 'partial' },
          error: { code: 400, message: 'test-key' },
        },
      ],
    }),
  );
  await expect(
    new OpenRouterLlmProvider(c.http, [base]).complete(
      { model: 'fixture', system: '', messages: [], maxTokens: 1 },
      signal,
    ),
  ).rejects.toMatchObject({
    code: 'invalid_request',
    userMessage: '[REDACTED]',
  });
});
it('decodes image bytes, gates optional fields and never submits an internal reference URL', async () => {
  const bytes = await sharp({
    create: { width: 2, height: 3, channels: 3, background: 'blue' },
  })
    .png()
    .toBuffer();
  const c = client(
    json({
      data: [{ b64_json: bytes.toString('base64'), media_type: 'image/png' }],
      usage: { cost: 0.05 },
    }),
  );
  const model = {
    ...base,
    kind: 'image' as const,
    capabilities: {
      maxCount: 1,
      maxReferences: 1,
      supportedParameters: ['aspect_ratio', 'input_references', 'seed'],
    },
    options: [
      { key: 'seed', label: 'Seed', type: 'number' as const, default: 0 },
    ],
  };
  const request = {
    model: 'fixture',
    prompt: 'paint',
    count: 1,
    aspectRatio: '1:1',
    resolution: '1K' as const,
    options: { seed: 7 },
    references: [
      {
        url: 'http://minio/private',
        mime: 'image/png',
        read: async () => bytes,
      },
    ],
  };
  const result = await new OpenRouterImageProvider(c.http, [model]).generate(
    request,
    signal,
  );
  expect(result.images[0]).toEqual({
    bytes,
    mime: 'image/png',
    width: 2,
    height: 3,
  });
  expect(c.body()).toEqual({
    model: 'fixture',
    prompt: 'paint',
    aspect_ratio: '1:1',
    seed: 7,
    input_references: [
      {
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` },
      },
    ],
  });
  await expect(
    new OpenRouterImageProvider(c.http, [model]).generate(
      {
        ...request,
        references: [...request.references, ...request.references],
      },
      signal,
    ),
  ).rejects.toMatchObject({ code: 'invalid_request' });
});
it('maps blocked image requests and rejects malformed successes per all-or-nothing API', async () => {
  const model = { ...base, kind: 'image' as const };
  const request = {
    model: 'fixture',
    prompt: 'paint',
    count: 1,
    aspectRatio: '1:1',
    resolution: '1K' as const,
    references: [],
  };
  const c = client(
    json(
      {
        error: {
          code: 403,
          metadata: { error_type: 'content_policy_violation' },
        },
      },
      403,
    ),
  );
  await expect(
    new OpenRouterImageProvider(c.http, [model]).generate(request, signal),
  ).rejects.toMatchObject({ code: 'content_blocked' });
  const malformed = client(json({ data: [{ b64_json: 'not base64!' }] }));
  await expect(
    new OpenRouterImageProvider(malformed.http, [model]).generate(
      request,
      signal,
    ),
  ).rejects.toThrow('base64');
});
it('validates voices, script limits and speed before sending ElevenLabs options', async () => {
  const c = client(
    new Response(Buffer.from('ID3fixture'), {
      headers: {
        'content-type': 'audio/mpeg',
        'x-generation-id': 'gen-fixture',
      },
    }),
  );
  const model = {
    ...base,
    kind: 'tts' as const,
    capabilities: {
      voices: ['george'],
      maxInputChars: 10,
      supportsSpeed: true,
      speedValues: [0.75, 1, 1.1, 1.2],
      speechFormat: 'mp3' as const,
      speechProvider: 'elevenlabs' as const,
    },
  };
  const probe = jest.fn().mockResolvedValue(400);
  const provider = new OpenRouterTtsProvider(c.http, [model], probe);
  const request = {
    model: 'fixture',
    text: 'Hello',
    voice: 'george',
    speed: 1.1,
    language: 'auto',
  };
  expect(await provider.synthesize(request, signal)).toMatchObject({
    mime: 'audio/mpeg',
    durationMs: 400,
    generationId: 'gen-fixture',
  });
  expect(c.body()).toEqual({
    model: 'fixture',
    input: 'Hello',
    voice: 'george',
    response_format: 'mp3',
    provider: { options: { elevenlabs: { voice_settings: { speed: 1.1 } } } },
  });
  for (const patch of [
    { voice: 'unknown' },
    { text: '12345678901' },
    { speed: 1.05 },
  ])
    await expect(
      provider.synthesize({ ...request, ...patch }, signal),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  expect(c.send).toHaveBeenCalledTimes(1);
});
it('omits speed settings on models without control', async () => {
  const c = client(
    new Response(Buffer.from('ID3fixture'), {
      headers: { 'content-type': 'audio/mpeg' },
    }),
  );
  const model = {
    ...base,
    kind: 'tts' as const,
    capabilities: {
      voices: ['george'],
      supportsSpeed: false,
      speechFormat: 'mp3' as const,
      speechProvider: 'elevenlabs' as const,
    },
  };
  const provider = new OpenRouterTtsProvider(c.http, [model], async () => 100);
  const request = {
    model: 'fixture',
    text: 'Hi',
    voice: 'george',
    speed: 1,
    language: 'auto',
  };
  await provider.synthesize(request, signal);
  expect(c.body()).not.toHaveProperty('provider');
  await expect(
    provider.synthesize({ ...request, speed: 1.1 }, signal),
  ).rejects.toMatchObject({ code: 'invalid_request' });
});
it('requires a catalog token cap for Google and wraps returned PCM as WAV', async () => {
  const c = client(
    new Response(Buffer.alloc(48000), {
      headers: { 'content-type': 'audio/pcm;rate=24000;channels=1' },
    }),
  );
  const model = {
    ...base,
    kind: 'tts' as const,
    capabilities: {
      voices: ['Kore'],
      supportsSpeed: false,
      speechFormat: 'pcm' as const,
      speechProvider: 'google-ai-studio' as const,
      maxOutputTokens: 1000,
    },
  };
  const request = {
    model: 'fixture',
    text: 'Hi',
    voice: 'Kore',
    speed: 1,
    language: 'auto',
  };
  const result = await new OpenRouterTtsProvider(c.http, [model]).synthesize(
    request,
    signal,
  );
  expect(result.durationMs).toBe(1000);
  expect(result.mime).toBe('audio/wav');
  expect(c.body()).toMatchObject({
    response_format: 'pcm',
    provider: { options: { 'google-ai-studio': { maxOutputTokens: 1000 } } },
  });
  await expect(
    new OpenRouterTtsProvider(c.http, [
      {
        ...model,
        capabilities: { ...model.capabilities, maxOutputTokens: undefined },
      },
    ]).synthesize(request, signal),
  ).rejects.toMatchObject({ code: 'invalid_request' });
});

it('sends only supported image options and lets explicit pixel size override ratio/tier', async () => {
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  const c = client(json({ data: [{ b64_json: bytes.toString('base64') }] }));
  const model = {
    ...base,
    kind: 'image' as const,
    capabilities: {
      supportedParameters: [
        'n',
        'size',
        'quality',
        'output_format',
        'aspect_ratio',
        'resolution',
      ],
    },
    options: [
      {
        key: 'size',
        label: 'Size',
        type: 'select' as const,
        choices: ['1024x1024'],
        default: '1024x1024',
      },
      {
        key: 'quality',
        label: 'Quality',
        type: 'select' as const,
        choices: ['high'],
        default: 'high',
      },
      {
        key: 'output_format',
        label: 'Format',
        type: 'select' as const,
        choices: ['png'],
        default: 'png',
      },
      { key: 'seed', label: 'Seed', type: 'number' as const, default: 0 },
    ],
  };
  await new OpenRouterImageProvider(c.http, [model]).generate(
    {
      model: 'fixture',
      prompt: 'paint',
      count: 2,
      resolution: '1K',
      aspectRatio: '1:1',
      references: [],
      options: {
        size: '1024x1024',
        quality: 'high',
        output_format: 'png',
        seed: 1,
      },
    },
    signal,
  );
  expect(c.body()).toEqual({
    model: 'fixture',
    prompt: 'paint',
    n: 2,
    size: '1024x1024',
    quality: 'high',
    output_format: 'png',
  });
});
