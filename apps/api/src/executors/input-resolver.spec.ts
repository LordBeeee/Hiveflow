import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { emptyGraph, nodeRegistry, type GraphNode } from '@hiveflow/shared';
import type { AssetsService } from '../assets/assets.service';
import type { NodeRunEntity } from '../runs/node-run.entity';
import { InputResolver } from './input-resolver';

function setup() {
  const spaceId = crypto.randomUUID();
  const graph = emptyGraph();
  function node(
    type: GraphNode['type'],
    params: Record<string, unknown> = nodeRegistry[type].defaultParams,
  ): GraphNode {
    const value = {
      id: crypto.randomUUID(),
      type,
      params,
      position: { x: 0, y: 0 },
    };
    graph.nodes.push(value);
    return value;
  }
  const target = node('image_generator');
  const runs = { findOne: jest.fn().mockResolvedValue(null) };
  const assets = {
    forSpace: jest
      .fn()
      .mockImplementation(async (_space: string, id: string) => ({
        id,
        sha256: id,
      })),
  };
  const resolver = new InputResolver(
    runs as unknown as Repository<NodeRunEntity>,
    assets as unknown as AssetsService,
  );
  const resolve = () => resolver.resolve(spaceId, graph, target);
  const connect = (source: GraphNode, port = 'references') =>
    graph.edges.push({
      id: crypto.randomUUID(),
      source: source.id,
      sourceHandle: source.type === 'text' ? 'text' : 'image',
      target: target.id,
      targetHandle: port,
    });
  return { graph, node, target, runs, assets, resolve, connect, spaceId };
}
it('reads connected Text synchronously and leaves local prompt untouched', async () => {
  const { node, target, runs, connect, resolve } = setup();
  target.params.prompt = 'local prompt';
  connect(node('text', { value: 'connected prompt' }), 'prompt');
  expect(await resolve()).toEqual({
    prompt: 'connected prompt',
    references: [],
  });
  expect(target.params.prompt).toBe('local prompt');
  expect(runs.findOne).not.toHaveBeenCalled();
});
it('rejects empty connected text without falling back to the local prompt', async () => {
  const { node, target, connect, resolve } = setup();
  target.params.prompt = 'must not be used';
  connect(node('text', { value: '  ' }), 'prompt');
  expect((await resolve()).error).toContain(
    "Upstream node 'Text #1' has no output",
  );
});
it('resolves all images from latest succeeded output, scoped to the Space', async () => {
  const { node, runs, assets, connect, resolve, spaceId } = setup();
  const source = node('image_generator');
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  runs.findOne.mockResolvedValue({
    output: { image: ids.map((assetId) => ({ assetId })) },
  });
  connect(source);
  expect(
    (await resolve()).references.map((reference) => reference.assetId),
  ).toEqual(ids);
  expect(runs.findOne).toHaveBeenCalledWith({
    where: { spaceId, nodeId: source.id, status: 'succeeded' },
    order: { sequence: 'DESC' },
  });
  expect(assets.forSpace).toHaveBeenCalledWith(spaceId, ids[0]);
});
it('resolves upload params without a queue job and preserves reference edge order', async () => {
  const { node, runs, connect, resolve } = setup();
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  for (const assetId of ids) connect(node('image_upload', { assetId }));
  expect(
    (await resolve()).references.map((reference) => reference.assetId),
  ).toEqual(ids);
  expect(runs.findOne).not.toHaveBeenCalled();
});
it('returns actionable errors for a source without output or a missing asset', async () => {
  const { node, runs, assets, connect, resolve } = setup();
  connect(node('image_generator'));
  expect((await resolve()).error).toContain(
    "Image Generator #2' has no output",
  );
  runs.findOne.mockResolvedValue({
    output: { image: [{ assetId: crypto.randomUUID() }] },
  });
  assets.forSpace.mockRejectedValue(new NotFoundException());
  expect((await resolve()).error).toContain('unavailable image');
});
it('handles orphan input edges and disconnected optional inputs without crashing', async () => {
  const { graph, target, resolve } = setup();
  expect(await resolve()).toEqual({ references: [] });
  graph.edges.push({
    id: crypto.randomUUID(),
    source: crypto.randomUUID(),
    sourceHandle: 'image',
    target: target.id,
    targetHandle: 'references',
  });
  expect((await resolve()).error).toContain('upstream node is missing');
});
it('propagates infrastructure failures rather than recording a misleading missing-output error', async () => {
  const { node, runs, connect, resolve } = setup();
  connect(node('image_generator'));
  runs.findOne.mockRejectedValue(new Error('database offline'));
  await expect(resolve()).rejects.toThrow('database offline');
});
