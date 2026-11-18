import { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';
import {
  nodeRegistry,
  type GraphNode,
  type SpaceGraph,
} from '@hiveflow/shared';
import { CostsService } from './costs.service';
import { ModelsService } from '../providers/models.service';
import { ProviderRegistry } from '../providers/provider-registry';
import { InputResolver } from '../executors/input-resolver';
import type { AssetsService } from '../assets/assets.service';
import type { NodeRunEntity } from './node-run.entity';
import type { RunCache } from './run-cache';
function setup() {
  const config = new ConfigService({
    MAX_BATCH_PROVIDER_NODES: 2,
    MAX_BATCH_UNITS: 10,
    DAILY_UNITS_LIMIT: 100,
  });
  const registry = new ProviderRegistry();
  for (const kind of ['image', 'llm', 'tts', 'video'] as const)
    registry.register(kind, kind === 'video' ? 'mock-video' : 'mock', {
      id: 'mock',
    });
  const models = new ModelsService(config, registry);
  const resolver = new InputResolver(
    {
      findOne: jest.fn().mockResolvedValue(null),
    } as unknown as Repository<NodeRunEntity>,
    {} as AssetsService,
  );
  const cache = { find: jest.fn().mockResolvedValue(null) };
  const service = new CostsService(
    {} as DataSource,
    config,
    models,
    resolver,
    cache as unknown as RunCache,
  );
  const node = (type: GraphNode['type']): GraphNode => ({
    id: crypto.randomUUID(),
    type,
    position: { x: 0, y: 0 },
    params: { ...nodeRegistry[type].defaultParams },
  });
  const text = node('text');
  text.params.value = 'A calm lake';
  const assistant = node('assistant');
  const voice = node('voiceover');
  const graph: SpaceGraph = {
    schemaVersion: 1,
    nodes: [text, assistant, voice],
    edges: [
      {
        id: 'a',
        source: text.id,
        sourceHandle: 'text',
        target: assistant.id,
        targetHandle: 'context',
      },
      {
        id: 'b',
        source: assistant.id,
        sourceHandle: 'text',
        target: voice.id,
        targetHandle: 'script',
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
  return { service, cache, graph, text, assistant, voice };
}
it('reserves a conservative bound for unknown outputs and freezes resolved Auto models', async () => {
  const { service, graph, assistant, voice } = setup();
  const result = await service.plan(crypto.randomUUID(), graph);
  expect(result.estimate).toMatchObject({
    providerNodes: 2,
    cachedNodes: 0,
    units: 6,
    upperBound: true,
  });
  expect(
    result.graph.nodes.find((node) => node.id === assistant.id)!.params.model,
  ).toBe('mock-llm');
  expect(
    result.graph.nodes.find((node) => node.id === voice.id)!.params.model,
  ).toBe('mock-tts');
  expect(
    graph.nodes.find((node) => node.id === assistant.id)!.params.model,
  ).toBe('auto');
});
it('uses cached upstream text for exact character costs and cached outputs cost zero', async () => {
  const { service, cache, graph, assistant } = setup();
  cache.find.mockImplementation(async (_space, id) =>
    id === assistant.id ? { output: { text: 'hello' } } : null,
  );
  const quote = await service.plan(crypto.randomUUID(), graph);
  expect(quote.estimate).toMatchObject({
    providerNodes: 1,
    cachedNodes: 1,
    units: 0.005,
    upperBound: false,
  });
  cache.find.mockResolvedValue({ output: { text: 'hello' } });
  expect((await service.plan(crypto.randomUUID(), graph)).estimate.units).toBe(
    0,
  );
});
it('fails closed on cache/database errors and rejects configured limits', async () => {
  const { service, cache, graph } = setup();
  cache.find.mockRejectedValue(new Error('Database down'));
  await expect(service.plan(crypto.randomUUID(), graph)).rejects.toThrow(
    'Database down',
  );
  expect(() => service.enforce({ providerNodes: 3, units: 1 })).toThrow(
    'provider nodes',
  );
  expect(() => service.enforce({ providerNodes: 1, units: 11 })).toThrow(
    'estimated credits',
  );
});
