import { describe, expect, it } from 'vitest';
import { topoSort, validateConnection, wouldCreateCycle } from './index';
import { normalizeNodeParams } from '../nodes';
import type { GraphNode, NodeType, SpaceGraph } from '../types';

const node = (id: string, type: NodeType = 'image_generator'): GraphNode => ({
  id,
  type,
  params: {},
  position: { x: 0, y: 0 },
});
const edge = (
  source: string,
  target: string,
  sourceHandle = 'image',
  targetHandle = 'references',
) => ({
  id: `${source}-${target}-${targetHandle}`,
  source,
  target,
  sourceHandle,
  targetHandle,
});
const graph = (nodes: GraphNode[], edges: SpaceGraph['edges'] = []) => ({
  nodes,
  edges,
});

describe('wouldCreateCycle', () => {
  const dag = graph(
    ['a', 'b', 'c', 'd'].map((id) => node(id)),
    [edge('a', 'b'), edge('b', 'c')],
  );
  it('detects self-loops and indirect cycles', () => {
    expect(wouldCreateCycle(dag, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(dag, 'c', 'a')).toBe(true);
    expect(wouldCreateCycle(dag, 'b', 'a')).toBe(true);
  });
  it('allows forward connections and disconnected branches', () => {
    expect(wouldCreateCycle(dag, 'a', 'c')).toBe(false);
    expect(wouldCreateCycle(dag, 'c', 'd')).toBe(false);
  });
  it('terminates even with a malformed existing cycle', () => {
    expect(
      wouldCreateCycle(
        graph(dag.nodes, [edge('a', 'b'), edge('b', 'a')]),
        'd',
        'a',
      ),
    ).toBe(false);
  });
});

describe('topoSort', () => {
  it('returns dependency levels for a diamond and independent nodes', () => {
    const dag = graph(
      ['a', 'b', 'c', 'd', 'e'].map((id) => node(id)),
      [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
    );
    expect(topoSort(dag)).toEqual([['a', 'e'], ['b', 'c'], ['d']]);
  });
  it('handles empty graphs and several edges between the same nodes', () => {
    expect(topoSort(graph([]))).toEqual([]);
    expect(
      topoSort(
        graph(
          [node('a'), node('b')],
          [edge('a', 'b'), edge('a', 'b', 'text', 'prompt')],
        ),
      ),
    ).toEqual([['a'], ['b']]);
  });
  it('rejects cycles, orphan edges and duplicate node IDs', () => {
    expect(() =>
      topoSort(graph([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')])),
    ).toThrow('cycle');
    expect(() => topoSort(graph([node('a')], [edge('a', 'b')]))).toThrow(
      'Orphan',
    );
    expect(() => topoSort(graph([node('a'), node('a')]))).toThrow('Duplicate');
  });
});

describe('validateConnection', () => {
  const nodes = [
    node('t', 'text'),
    node('t2', 'text'),
    node('u', 'image_upload'),
    node('g'),
    node('g2'),
  ];
  it('allows matching text and image ports', () => {
    expect(
      validateConnection(graph(nodes), edge('t', 'g', 'text', 'prompt')).valid,
    ).toBe(true);
    expect(validateConnection(graph(nodes), edge('u', 'g')).valid).toBe(true);
  });
  it.each([
    edge('missing', 'g'),
    edge('u', 'missing'),
    edge('g', 'g'),
    edge('t', 'g', 'text', 'references'),
    edge('u', 'g', 'image', 'prompt'),
    edge('u', 'g', 'missing'),
    edge('u', 'g', 'image', 'missing'),
    edge('g', 't'),
  ])('rejects invalid endpoints and port types: %j', (candidate) => {
    expect(validateConnection(graph(nodes), candidate).valid).toBe(false);
  });
  it('enforces single-input cardinality while allowing multiple image sources', () => {
    expect(
      validateConnection(
        graph(nodes, [edge('t', 'g', 'text', 'prompt')]),
        edge('t2', 'g', 'text', 'prompt'),
      ).valid,
    ).toBe(false);
    const images = graph(nodes, [edge('u', 'g')]);
    expect(validateConnection(images, edge('g2', 'g')).valid).toBe(true);
    expect(validateConnection(images, edge('u', 'g')).valid).toBe(false);
  });
  it('rejects cycles and leaves the supplied document unchanged', () => {
    const dag = graph(nodes, [edge('g', 'g2')]);
    const before = JSON.stringify(dag);
    expect(validateConnection(dag, edge('g2', 'g')).valid).toBe(false);
    expect(JSON.stringify(dag)).toBe(before);
  });
});

it('normalizes malformed params per field while preserving valid fields', () => {
  const normalized = normalizeNodeParams('image_generator', {
    prompt: 'Keep me',
    count: 99,
    resolution: '2K',
    aspectRatio: 'bad',
    model: 'auto',
  });
  expect(normalized.params).toEqual({
    prompt: 'Keep me',
    count: 1,
    model: 'auto',
    aspectRatio: '1:1',
    resolution: '2K',
  });
  expect(normalized.warnings).toHaveLength(2);
});
