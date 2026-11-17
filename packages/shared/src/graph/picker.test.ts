import { expect, it } from 'vitest';
import { nodeRegistry } from '../nodes';
import type { GraphNode } from '../types';
import { connectionForNewNode } from './index';

const text: GraphNode = {
  id: 'text',
  type: 'text',
  position: { x: 0, y: 0 },
  params: { value: '' },
};
const generator: GraphNode = {
  id: 'generator',
  type: 'image_generator',
  position: { x: 100, y: 0 },
  params: { ...nodeRegistry.image_generator.defaultParams },
};
const graph = { nodes: [text, generator], edges: [] };
it('finds the first compatible target port when extending an output', () => {
  expect(
    connectionForNewNode(
      graph,
      { nodeId: text.id, handleId: 'text', handleType: 'source' },
      { ...generator, id: 'new' },
    ),
  ).toEqual({
    source: 'text',
    sourceHandle: 'text',
    target: 'new',
    targetHandle: 'prompt',
  });
  expect(
    connectionForNewNode(
      graph,
      { nodeId: generator.id, handleId: 'image', handleType: 'source' },
      { ...generator, id: 'new' },
    )?.targetHandle,
  ).toBe('references');
});
it('connects a compatible new output back to an existing input', () => {
  expect(
    connectionForNewNode(
      graph,
      { nodeId: generator.id, handleId: 'prompt', handleType: 'target' },
      { ...text, id: 'new' },
    ),
  ).toEqual({
    source: 'new',
    sourceHandle: 'text',
    target: 'generator',
    targetHandle: 'prompt',
  });
});
it('rejects wrong types, removed origins, occupied single inputs and duplicate node IDs', () => {
  const origin = {
    nodeId: generator.id,
    handleId: 'prompt',
    handleType: 'target' as const,
  };
  expect(
    connectionForNewNode(graph, origin, { ...generator, id: 'new' }),
  ).toBeUndefined();
  expect(
    connectionForNewNode(
      graph,
      { ...origin, nodeId: 'deleted' },
      { ...text, id: 'new' },
    ),
  ).toBeUndefined();
  const occupied = {
    ...graph,
    edges: [
      {
        id: 'edge',
        source: text.id,
        sourceHandle: 'text',
        target: generator.id,
        targetHandle: 'prompt',
      },
    ],
  };
  expect(
    connectionForNewNode(occupied, origin, { ...text, id: 'new' }),
  ).toBeUndefined();
  expect(connectionForNewNode(graph, origin, text)).toBeUndefined();
});
