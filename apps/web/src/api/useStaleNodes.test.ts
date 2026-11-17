import { expect, it } from 'vitest';
import {
  emptyGraph,
  executionHash,
  nodeRegistry,
  type NodeRun,
} from '@hiveflow/shared';
import { computeStaleNodes } from './useStaleNodes';

it('propagates changed upstream prompts through an image chain and clears after rerunning', async () => {
  const graph = emptyGraph();
  const text = {
    id: 'text',
    type: 'text' as const,
    params: { value: 'original' },
    position: { x: 0, y: 0 },
  };
  const a = {
    id: 'a',
    type: 'image_generator' as const,
    params: { ...nodeRegistry.image_generator.defaultParams },
    position: { x: 0, y: 0 },
  };
  const b = { ...a, id: 'b' };
  graph.nodes = [text, a, b];
  graph.edges = [
    {
      id: '1',
      source: text.id,
      sourceHandle: 'text',
      target: a.id,
      targetHandle: 'prompt',
    },
    {
      id: '2',
      source: a.id,
      sourceHandle: 'image',
      target: b.id,
      targetHandle: 'references',
    },
  ];
  const image = {
    assetId: 'image',
    sha256: 'asset-hash',
    url: '/api/assets/image',
    width: 10,
    height: 10,
  };
  const success = {
    a: {
      inputHash: await executionHash(
        a.type,
        { ...a.params, model: 'mock-image' },
        { ports: { prompt: [{ kind: 'text', value: 'original' }] } },
      ),
      output: { image: [image] },
    } as NodeRun,
    b: {
      inputHash: await executionHash(
        b.type,
        { ...b.params, model: 'mock-image' },
        {
          ports: {
            references: [{ sha256: 'asset-hash' }].map((reference) => ({
              kind: 'asset' as const,
              mediaKind: 'image' as const,
              assetId: 'fixture-asset',
              ...reference,
            })),
          },
        },
      ),
    } as NodeRun,
  };
  expect(
    await computeStaleNodes(graph, success, success, async () => 'asset-hash'),
  ).toEqual({ a: false, b: false });
  text.params.value = 'new prompt';
  expect(
    await computeStaleNodes(graph, success, success, async () => 'asset-hash'),
  ).toEqual({ a: true, b: true });
  const failed = {
    ...success,
    a: {
      ...success.a,
      inputHash: await executionHash(
        a.type,
        { ...a.params, model: 'mock-image' },
        { ports: { prompt: [{ kind: 'text', value: 'new prompt' }] } },
      ),
      status: 'failed' as const,
    },
  };
  expect(
    (await computeStaleNodes(graph, failed, success, async () => 'asset-hash'))
      .b,
  ).toBe(true);
  success.a.inputHash = failed.a.inputHash;
  expect(
    await computeStaleNodes(graph, success, success, async () => 'asset-hash'),
  ).toEqual({ a: false, b: false });
});
it('marks an unavailable reference stale without throwing or using an expiring URL', async () => {
  const graph = emptyGraph();
  graph.nodes = [
    {
      id: 'upload',
      type: 'image_upload',
      params: { assetId: 'missing' },
      position: { x: 0, y: 0 },
    },
    {
      id: 'target',
      type: 'image_generator',
      params: { ...nodeRegistry.image_generator.defaultParams },
      position: { x: 1, y: 1 },
    },
  ];
  graph.edges = [
    {
      id: 'edge',
      source: 'upload',
      sourceHandle: 'image',
      target: 'target',
      targetHandle: 'references',
    },
  ];
  const runs = { target: { inputHash: 'old' } as NodeRun };
  expect(
    await computeStaleNodes(graph, runs, {}, async () => {
      throw new Error('404');
    }),
  ).toEqual({ target: true });
});
it('calculates stale for a fake registry node without a node-type branch', async () => {
  const { nodeRegistry, resolveNodeInputs } = await import('@hiveflow/shared');
  const registry = {
    ...nodeRegistry,
    fake: {
      ...nodeRegistry.text,
      type: 'fake',
      staticOutput: undefined,
      inputs: [{ id: 'context', type: 'text' as const }],
      paramsSchema: nodeRegistry.text.paramsSchema,
    },
  };
  const source = { id: 'source', type: 'text', params: { value: 'before' } };
  const target = { id: 'fake', type: 'fake', params: { value: 'local' } };
  const graph = {
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
  };
  const inputs = await resolveNodeInputs(
    graph,
    target,
    async () => null,
    async () => null,
    registry,
  );
  const latest = {
    fake: {
      inputHash: await executionHash('fake', target.params, inputs),
      output: null,
    },
  };
  expect(
    await computeStaleNodes(
      graph,
      latest,
      {},
      async () => '',
      undefined,
      registry,
    ),
  ).toEqual({ fake: false });
  source.params.value = 'after';
  expect(
    await computeStaleNodes(
      graph,
      latest,
      {},
      async () => '',
      undefined,
      registry,
    ),
  ).toEqual({ fake: true });
});
