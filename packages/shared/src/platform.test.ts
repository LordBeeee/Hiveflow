import { expect, it } from 'vitest';
import { z } from 'zod';
import { nodeRegistry } from './nodes';
import { createGraphSchemas } from './spaces';
import { resolveNodeInputs } from './inputs';
import { createNodeRunSchema, executionHash } from './runs';
import {
  coerceParamsForModel,
  findModel,
  selectModel,
  validateModelParams,
  modelCatalog,
} from './models';
import { assetSchema } from './media';
it('adds a fake registry node without schema, resolver or hash branches', async () => {
  const registry = {
    ...nodeRegistry,
    fake: {
      type: 'fake',
      label: 'Fake',
      category: 'Text' as const,
      description: 'Test',
      keywords: [],
      inputs: [{ id: 'context', type: 'text' as const }],
      outputs: [{ id: 'text', type: 'text' as const }],
      paramsSchema: z.object({ message: z.string() }).strict(),
      defaultParams: { message: '' },
    },
  };
  const source = {
    id: crypto.randomUUID(),
    type: 'text' as const,
    position: { x: 0, y: 0 },
    params: { value: 'context' },
  };
  const target = {
    id: crypto.randomUUID(),
    type: 'fake' as const,
    position: { x: 10, y: 0 },
    params: { message: 'hello' },
  };
  const graph = {
    schemaVersion: 1 as const,
    nodes: [source, target],
    edges: [
      {
        id: 'edge',
        source: source.id,
        sourceHandle: 'text',
        target: target.id,
        targetHandle: 'context',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  expect(
    createGraphSchemas(registry).spaceGraphSchema.safeParse(graph).success,
  ).toBe(true);
  const inputs = await resolveNodeInputs(
    graph,
    target,
    async () => null,
    async () => null,
    registry,
  );
  expect(inputs).toEqual({
    ports: { context: [{ kind: 'text', value: 'context' }] },
  });
  expect(await executionHash('fake', target.params, inputs)).toMatch(
    /^[a-f0-9]{64}$/,
  );
  expect(
    createNodeRunSchema(registry).shape.nodeType.safeParse('fake').success,
  ).toBe(true);
});
it('enforces the output id/type convention for every registered node', () => {
  for (const node of Object.values(nodeRegistry))
    for (const port of node.outputs) expect(port.id).toBe(port.type);
});
it('coerces model-dependent values atomically and resets options', () => {
  const compact = findModel('bytedance-seed/seedream-5-0-pro')!;
  const result = coerceParamsForModel(
    'image_generator',
    {
      aspectRatio: 'unsupported',
      resolution: '4K',
      count: 4,
      options: { quality: 'old' },
    },
    compact,
  );
  expect(result.params).toMatchObject({
    model: compact.id,
    aspectRatio: '1:1',
    resolution: '1K',
    count: 1,
    options: { output_format: 'png', seed: 0 },
  });
  expect(result.notices).toHaveLength(3);
  expect(
    coerceParamsForModel(
      'video',
      { duration: 3, aspectRatio: 'unsupported' },
      findModel('seedance-2-0')!,
    ).params,
  ).toMatchObject({ duration: 4, aspectRatio: '16:9' });
  expect(
    coerceParamsForModel(
      'voice',
      { voice: 'missing', speed: 9, language: 'xx' },
      findModel('elevenlabs/eleven-v4')!,
    ).params,
  ).toMatchObject({ voice: 'george', speed: 1, language: 'auto' });
  expect(() =>
    validateModelParams({ aspectRatio: 'unsupported' }, compact),
  ).toThrow('does not support');
  expect(() =>
    validateModelParams({ options: { bad: true } }, compact),
  ).toThrow('Unknown model option');
});
it('resolves aliases and rejects automatic selection and rejects removed/unavailable models', () => {
  const models = modelCatalog.map((model) => ({
    ...model,
    aliases:
      model.id === 'bytedance-seed/seedream-4.5'
        ? ['seedream-alias']
        : model.aliases,
    available: model.provider === 'openrouter' && model.status !== 'removed',
  }));
  for (const id of ['', 'auto'])
    expect(() => selectModel(id, 'image', models)).toThrow('Choose a model');
  expect(selectModel('seedream-alias', 'image', models).id).toBe(
    'bytedance-seed/seedream-4.5',
  );
  expect(() => selectModel('retired-image', 'image', models)).toThrow(
    'choose another model',
  );
  expect(() => selectModel('missing', 'image', models)).toThrow(
    'choose another model',
  );
  expect(() => selectModel('unconfigured-image', 'image', models)).toThrow(
    'choose another model',
  );
});
it('uses media kind constraints in the asset schema', () => {
  const common = {
    id: crypto.randomUUID(),
    spaceId: crypto.randomUUID(),
    url: '/api/assets/test',
    mime: 'audio/wav',
    sizeBytes: 44,
    sha256: 'a'.repeat(64),
    createdAt: new Date().toISOString(),
  };
  expect(
    assetSchema.safeParse({ ...common, kind: 'audio', durationMs: 200 })
      .success,
  ).toBe(true);
  expect(assetSchema.safeParse({ ...common, kind: 'video' }).success).toBe(
    false,
  );
});
it('locks the port hash format with fixed vectors and resolved model ids', async () => {
  const inputs = {
    ports: {
      prompt: [{ kind: 'text' as const, value: 'blue hour' }],
      references: [
        {
          kind: 'asset' as const,
          assetId: 'ignored',
          sha256: 'a'.repeat(64),
          mediaKind: 'image' as const,
        },
      ],
    },
  };
  expect(
    await executionHash(
      'image_generator',
      {
        prompt: 'cabin',
        model: 'bytedance-seed/seedream-4.5',
        options: {},
        count: 1,
      },
      inputs,
    ),
  ).toBe('608659f051b68fd9369a7bdc11cc9c44573635e4e4b6ef6fef15f99d19f41dc0');
  expect(
    await executionHash(
      'image_generator',
      {
        prompt: 'cabin',
        model: 'bytedance-seed/seedream-5-0-pro',
        options: {},
        count: 1,
      },
      inputs,
    ),
  ).toBe('d8ec0be691d97afc13af36356ce06b943a6e4cbd143e0ce037c38a871fd8d25e');
  inputs.ports.references[0].assetId = 'different-id';
  expect(
    await executionHash(
      'image_generator',
      {
        count: 1,
        options: {},
        model: 'bytedance-seed/seedream-4.5',
        prompt: 'cabin',
      },
      inputs,
    ),
  ).toBe('608659f051b68fd9369a7bdc11cc9c44573635e4e4b6ef6fef15f99d19f41dc0');
});
