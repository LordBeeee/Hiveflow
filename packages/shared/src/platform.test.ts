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
  const compact = findModel('mock-image-compact')!;
  const result = coerceParamsForModel(
    'image_generator',
    {
      aspectRatio: '3:4',
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
    options: { quality: 'standard', seed: 0, softLight: true },
  });
  expect(result.notices).toHaveLength(3);
  expect(
    coerceParamsForModel(
      'video',
      { duration: 8, aspectRatio: '4:3' },
      findModel('mock-video')!,
    ).params,
  ).toMatchObject({ duration: 10, aspectRatio: '16:9' });
  expect(
    coerceParamsForModel(
      'voice',
      { voice: 'missing', speed: 9, language: 'xx' },
      findModel('mock-tts')!,
    ).params,
  ).toMatchObject({ voice: 'calm', speed: 1.5, language: 'auto' });
  expect(() => validateModelParams({ aspectRatio: '3:4' }, compact)).toThrow(
    'does not support',
  );
  expect(() =>
    validateModelParams({ options: { bad: true } }, compact),
  ).toThrow('Unknown model option');
});
it('resolves auto and aliases to concrete ids and rejects removed/unavailable models', () => {
  const models = modelCatalog.map((model) => ({
    ...model,
    available: model.provider === 'mock' && model.status !== 'removed',
    isDefault: model.id === 'mock-image',
  }));
  expect(selectModel('auto', 'image', models).id).toBe('mock-image');
  expect(selectModel('mock-image-v1', 'image', models).id).toBe('mock-image');
  expect(() => selectModel('mock-image-legacy', 'image', models)).toThrow(
    'choose another model',
  );
  expect(() => selectModel('missing', 'image', models)).toThrow(
    'choose another model',
  );
  expect(() => selectModel('image-studio', 'image', models)).toThrow(
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
      { prompt: 'cabin', model: 'mock-image', options: {}, count: 1 },
      inputs,
    ),
  ).toBe('59e367999339525434fb5334f209e5f9c7cbb092694ec94c387f6c62ffdb6c23');
  expect(
    await executionHash(
      'image_generator',
      { prompt: 'cabin', model: 'mock-image-compact', options: {}, count: 1 },
      inputs,
    ),
  ).toBe('b6491fa851aef36738ec05325d699e1fc8891d8dba0282867f9ff819c735d2ee');
  inputs.ports.references[0].assetId = 'different-id';
  expect(
    await executionHash(
      'image_generator',
      { count: 1, options: {}, model: 'mock-image', prompt: 'cabin' },
      inputs,
    ),
  ).toBe('59e367999339525434fb5334f209e5f9c7cbb092694ec94c387f6c62ffdb6c23');
});
