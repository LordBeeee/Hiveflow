import { describe, expect, it } from 'vitest';
import {
  createSpaceSchema,
  emptyGraph,
  migrateGraph,
  prepareGraphForLoad,
  spaceGraphSchema,
  updateSpaceSchema,
} from './spaces';
import { nodeRegistry } from './nodes';
import { stableStringify } from './graph';

function fixture() {
  const graph = emptyGraph();
  graph.nodes = [
    {
      id: crypto.randomUUID(),
      type: 'text',
      position: { x: 1, y: 2 },
      params: { value: 'a prompt' },
    },
    ...[1, 2].map(() => ({
      id: crypto.randomUUID(),
      type: 'image_generator' as const,
      position: { x: 10, y: 20 },
      params: { ...nodeRegistry.image_generator.defaultParams },
    })),
  ];
  const [a, b] = graph.nodes;
  graph.edges = [
    {
      id: crypto.randomUUID(),
      source: a.id,
      sourceHandle: 'text',
      target: b.id,
      targetHandle: 'prompt',
    },
  ];
  return graph;
}

describe('space write validation', () => {
  it('canonicalizes nested JSON keys while preserving array order', () => {
    expect(stableStringify({ z: [{ b: 2, a: 1 }], a: 3 })).toBe(
      stableStringify({ a: 3, z: [{ a: 1, b: 2 }] }),
    );
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
  it('rejects unknown params on writes and repairs them with a warning on load', () => {
    const graph = fixture();
    graph.nodes[0].params.unknown = 'ignored';
    expect(spaceGraphSchema.safeParse(graph).success).toBe(false);
    const loaded = prepareGraphForLoad(graph);
    expect(loaded.warnings).toHaveLength(1);
    expect(loaded.graph.nodes[0].params).toEqual({ value: 'a prompt' });
  });
  it('accepts valid documents and trims names', () => {
    expect(
      createSpaceSchema.parse({ name: ' My space ', graph: fixture() }).name,
    ).toBe('My space');
    expect(
      updateSpaceSchema.safeParse({ name: 'Renamed', version: 1 }).success,
    ).toBe(true);
  });
  it('reports field-level invalid params', () => {
    const graph = fixture();
    graph.nodes[1].params.count = 20;
    const result = createSpaceSchema.safeParse({ graph });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(
        result.error.issues.map((issue) => issue.path.join('.')),
      ).toContain('graph.nodes.1.params.count');
  });
  it('rejects duplicate IDs and orphan edges', () => {
    const graph = fixture();
    graph.nodes[1].id = graph.nodes[0].id;
    expect(spaceGraphSchema.safeParse(graph).success).toBe(false);
    const orphan = fixture();
    orphan.edges[0].target = crypto.randomUUID();
    expect(spaceGraphSchema.safeParse(orphan).success).toBe(false);
  });
  it('rejects cycles, mismatched ports and duplicate single-input edges', () => {
    const graph = fixture();
    const [, b, c] = graph.nodes;
    graph.edges.push(
      {
        id: crypto.randomUUID(),
        source: b.id,
        sourceHandle: 'image',
        target: c.id,
        targetHandle: 'references',
      },
      {
        id: crypto.randomUUID(),
        source: c.id,
        sourceHandle: 'image',
        target: b.id,
        targetHandle: 'references',
      },
    );
    expect(spaceGraphSchema.safeParse(graph).success).toBe(false);
    const mismatch = fixture();
    mismatch.edges[0].targetHandle = 'references';
    expect(spaceGraphSchema.safeParse(mismatch).success).toBe(false);
    const duplicate = fixture();
    duplicate.edges.push({ ...duplicate.edges[0], id: crypto.randomUUID() });
    expect(spaceGraphSchema.safeParse(duplicate).success).toBe(false);
  });
  it.each([
    { version: 0, name: 'Name' },
    { version: 1 },
    { version: 1, name: '' },
    { version: 1, name: 'x'.repeat(121) },
    { version: 1, userId: crypto.randomUUID(), name: 'Name' },
  ])('rejects invalid patch %j', (patch) => {
    expect(updateSpaceSchema.safeParse(patch).success).toBe(false);
  });
  it('rejects unsupported versions and non-finite positions', () => {
    expect(() => migrateGraph({ ...fixture(), schemaVersion: 2 })).toThrow();
    const graph = fixture();
    graph.nodes[0].position.x = Infinity;
    expect(spaceGraphSchema.safeParse(graph).success).toBe(false);
  });
  it('repairs invalid loaded fields while preserving valid fields and viewport', () => {
    const graph = fixture();
    graph.nodes[1].params = {
      count: 99,
      prompt: 'keep',
      aspectRatio: '16:9',
      resolution: '2K',
      model: 'auto',
    };
    const result = prepareGraphForLoad(graph);
    expect(result.graph.nodes[1].params).toEqual({
      count: 1,
      prompt: 'keep',
      aspectRatio: '16:9',
      resolution: '2K',
      model: 'auto',
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.graph.viewport).toEqual(graph.viewport);
    expect(graph.nodes[1].params.count).toBe(99);
  });
});
