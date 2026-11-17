import { beforeEach, describe, expect, it } from 'vitest';
import { initialGraph, loadGraph, redo, undo, useGraphStore } from './graph';

beforeEach(() => {
  useGraphStore.setState({
    ...structuredClone(initialGraph),
    selectedNodes: [],
    selectedEdges: [],
    dragPositions: {},
  });
  useGraphStore.temporal.getState().clear();
});

describe('graph history', () => {
  it('loads a saved document with its viewport and resets prior history/selection', () => {
    useGraphStore.getState().addNode('text', { x: 10, y: 10 });
    const saved = {
      ...structuredClone(initialGraph),
      viewport: { x: -10, y: 80, zoom: 0.7 },
    };
    loadGraph(saved);
    expect(useGraphStore.getState().nodes).toEqual(saved.nodes);
    expect(useGraphStore.getState().viewport).toEqual(saved.viewport);
    expect(useGraphStore.getState().selectedNodes).toEqual([]);
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(0);
    undo();
    expect(useGraphStore.getState().nodes).toEqual(saved.nodes);
  });
  it('does not notify subscribers again when React Flow repeats the same selection', () => {
    let updates = 0;
    const unsubscribe = useGraphStore.subscribe(() => {
      updates++;
    });
    useGraphStore.getState().select([initialGraph.nodes[0].id], []);
    useGraphStore.getState().select([initialGraph.nodes[0].id], []);
    unsubscribe();
    expect(updates).toBe(1);
  });
  it('does not record deletion of an empty selection or unchanged positions', () => {
    useGraphStore.getState().deleteSelection();
    useGraphStore.getState().commitPositions({
      [initialGraph.nodes[0].id]: initialGraph.nodes[0].position,
    });
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(0);
  });
  it('ignores viewport, selection and in-progress drag updates', () => {
    const id = initialGraph.nodes[0].id;
    useGraphStore.getState().setViewport({ x: 90, y: 80, zoom: 0.8 });
    useGraphStore.getState().select([id], []);
    useGraphStore.getState().previewPositions({ [id]: { x: 250, y: 300 } });
    useGraphStore.getState().previewPositions({ [id]: { x: 300, y: 350 } });
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(0);
    expect(useGraphStore.getState().nodes[0].position).toEqual(
      initialGraph.nodes[0].position,
    );
    useGraphStore.getState().commitPositions({ [id]: { x: 300, y: 350 } });
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(1);
    undo();
    expect(useGraphStore.getState().nodes[0].position).toEqual(
      initialGraph.nodes[0].position,
    );
    expect(useGraphStore.getState().viewport.zoom).toBe(0.8);
    expect(useGraphStore.getState().dragPositions).toEqual({});
    redo();
    expect(useGraphStore.getState().nodes[0].position).toEqual({
      x: 300,
      y: 350,
    });
  });

  it('atomically deletes nodes and their edges, then restores them with undo', () => {
    const [text, generator] = initialGraph.nodes;
    const connection = {
      source: text.id,
      sourceHandle: 'text',
      target: generator.id,
      targetHandle: 'prompt',
    };
    expect(useGraphStore.getState().connect(connection)).toBe(true);
    useGraphStore.getState().select([text.id], []);
    useGraphStore.getState().deleteSelection();
    expect(useGraphStore.getState().nodes).toHaveLength(1);
    expect(useGraphStore.getState().edges).toHaveLength(0);
    undo();
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    expect(useGraphStore.getState().edges).toHaveLength(1);
    redo();
    expect(useGraphStore.getState().nodes).toHaveLength(1);
    expect(useGraphStore.getState().edges).toHaveLength(0);
  });

  it('rejects invalid or duplicate edges without modifying history', () => {
    const [text, generator] = initialGraph.nodes;
    const connection = {
      source: text.id,
      sourceHandle: 'text',
      target: generator.id,
      targetHandle: 'prompt',
    };
    useGraphStore.getState().connect(connection);
    expect(useGraphStore.getState().connect(connection)).toBe(false);
    expect(
      useGraphStore
        .getState()
        .connect({ ...connection, targetHandle: 'references' }),
    ).toBe(false);
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(1);
  });

  it('adds a reference node and edge in one undo step', () => {
    useGraphStore
      .getState()
      .addReference(initialGraph.nodes[1].id, crypto.randomUUID());
    expect(useGraphStore.getState().nodes).toHaveLength(3);
    expect(useGraphStore.getState().edges).toHaveLength(1);
    undo();
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    expect(useGraphStore.getState().edges).toHaveLength(0);
  });
  it('inserts at the drop point and connects in one undo step after validation', () => {
    const position = { x: 1023, y: 456 };
    const id = useGraphStore.getState().addConnectedNode('text', position, {
      nodeId: initialGraph.nodes[1].id,
      handleId: 'prompt',
      handleType: 'target',
    });
    expect(id).toBeDefined();
    expect(
      useGraphStore.getState().nodes.find((node) => node.id === id)?.position,
    ).toEqual(position);
    expect(useGraphStore.getState().edges[0]).toMatchObject({
      source: id,
      target: initialGraph.nodes[1].id,
      targetHandle: 'prompt',
    });
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(1);
    expect(
      useGraphStore.getState().addConnectedNode('text', position, {
        nodeId: initialGraph.nodes[1].id,
        handleId: 'prompt',
        handleType: 'target',
      }),
    ).toBeUndefined();
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(1);
    undo();
    expect(useGraphStore.getState().nodes).toHaveLength(2);
    expect(useGraphStore.getState().edges).toHaveLength(0);
    redo();
    expect(useGraphStore.getState().nodes).toHaveLength(3);
    expect(useGraphStore.getState().edges).toHaveLength(1);
  });

  it('bounds image count and restores the previous value on undo', () => {
    const id = initialGraph.nodes[1].id;
    useGraphStore.getState().updateParams(id, { count: 4 });
    useGraphStore.getState().updateParams(id, { count: 5 });
    expect(useGraphStore.getState().nodes[1].params.count).toBe(4);
    expect(useGraphStore.temporal.getState().pastStates).toHaveLength(1);
    undo();
    expect(useGraphStore.getState().nodes[1].params.count).toBe(1);
  });
});
