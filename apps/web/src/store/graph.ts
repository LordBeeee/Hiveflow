import { create } from 'zustand';
import { temporal } from 'zundo';
import {
  nodeRegistry,
  validateConnection,
  type ConnectionCandidate,
  type GraphNode,
  type NodeType,
  type Point,
  type SpaceGraph,
} from '@hiveflow/shared';

export const initialGraph: SpaceGraph = {
  schemaVersion: 1,
  nodes: [
    {
      id: '5586f79f-26ca-4487-99d9-772ee82dc6e0',
      type: 'text',
      position: { x: 170, y: 195 },
      params: {
        value:
          'A quiet cabin in the mountains, morning light, soft film grain.',
      },
    },
    {
      id: '48dbd602-28c6-470f-b939-e249fce18c27',
      type: 'image_generator',
      position: { x: 650, y: 125 },
      params: { ...nodeRegistry.image_generator.defaultParams },
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

interface GraphState extends SpaceGraph {
  selectedNodes: string[];
  selectedEdges: string[];
  dragPositions: Record<string, Point>;
  addNode: (type: NodeType, position: Point) => string;
  updateParams: (id: string, patch: Record<string, unknown>) => void;
  connect: (candidate: ConnectionCandidate) => boolean;
  addReference: (
    targetId: string,
    assetId: string | null,
  ) => string | undefined;
  select: (nodes: string[], edges: string[]) => void;
  previewPositions: (positions: Record<string, Point>) => void;
  commitPositions: (positions: Record<string, Point>) => void;
  setViewport: (viewport: SpaceGraph['viewport']) => void;
  remove: (nodeIds: string[], edgeIds?: string[]) => void;
  deleteSelection: () => void;
}

type History = Pick<SpaceGraph, 'nodes' | 'edges'>;

export const useGraphStore = create<GraphState>()(
  temporal<GraphState, [], [], History>(
    (set, get) => ({
      ...initialGraph,
      selectedNodes: [],
      selectedEdges: [],
      dragPositions: {},
      addNode: (type, position) => {
        const id = crypto.randomUUID();
        const node: GraphNode = {
          id,
          type,
          position,
          params: { ...nodeRegistry[type].defaultParams },
        };
        set((state) => ({
          nodes: [...state.nodes, node],
          selectedNodes: [id],
          selectedEdges: [],
        }));
        return id;
      },
      updateParams: (id, patch) =>
        set((state) => ({
          nodes: state.nodes.map((node) => {
            if (node.id !== id) return node;
            const parsed = nodeRegistry[node.type].paramsSchema.safeParse({
              ...node.params,
              ...patch,
            });
            return parsed.success ? { ...node, params: parsed.data } : node;
          }),
        })),
      connect: (candidate) => {
        if (!validateConnection(get(), candidate).valid) return false;
        set((state) => ({
          edges: [...state.edges, { ...candidate, id: crypto.randomUUID() }],
        }));
        return true;
      },
      addReference: (targetId, assetId) => {
        const target = get().nodes.find((node) => node.id === targetId);
        if (!target || target.type !== 'image_generator') return;
        const id = crypto.randomUUID();
        const count = get().edges.filter(
          (edge) =>
            edge.target === targetId && edge.targetHandle === 'references',
        ).length;
        set((state) => ({
          nodes: [
            ...state.nodes,
            {
              id,
              type: 'image_upload',
              position: {
                x: target.position.x - 365,
                y: target.position.y + 260 + count * 80,
              },
              params: { assetId },
            },
          ],
          edges: [
            ...state.edges,
            {
              id: crypto.randomUUID(),
              source: id,
              sourceHandle: 'image',
              target: targetId,
              targetHandle: 'references',
            },
          ],
          selectedNodes: [id],
          selectedEdges: [],
        }));
        return id;
      },
      select: (selectedNodes, selectedEdges) => {
        const state = get();
        if (
          selectedNodes.length === state.selectedNodes.length &&
          selectedEdges.length === state.selectedEdges.length &&
          selectedNodes.every(
            (id, index) => id === state.selectedNodes[index],
          ) &&
          selectedEdges.every((id, index) => id === state.selectedEdges[index])
        )
          return;
        set({ selectedNodes, selectedEdges });
      },
      previewPositions: (positions) =>
        set((state) => ({
          dragPositions: { ...state.dragPositions, ...positions },
        })),
      commitPositions: (positions) =>
        set((state) => ({
          nodes: state.nodes.map((node) =>
            positions[node.id] &&
            (node.position.x !== positions[node.id].x ||
              node.position.y !== positions[node.id].y)
              ? { ...node, position: positions[node.id] }
              : node,
          ),
          dragPositions: {},
        })),
      setViewport: (viewport) => set({ viewport }),
      remove: (nodeIds, edgeIds = []) =>
        set((state) => ({
          nodes: state.nodes.filter((node) => !nodeIds.includes(node.id)),
          edges: state.edges.filter(
            (edge) =>
              !edgeIds.includes(edge.id) &&
              !nodeIds.includes(edge.source) &&
              !nodeIds.includes(edge.target),
          ),
          selectedNodes: state.selectedNodes.filter(
            (id) => !nodeIds.includes(id),
          ),
          selectedEdges: [],
          dragPositions: {},
        })),
      deleteSelection: () =>
        get().remove(get().selectedNodes, get().selectedEdges),
    }),
    {
      partialize: ({ nodes, edges }) => ({ nodes, edges }),
      // Ignore UI/viewport changes and position updates that do not move a node.
      equality: (a, b) =>
        a.edges.length === b.edges.length &&
        a.edges.every((edge, index) => edge === b.edges[index]) &&
        a.nodes.length === b.nodes.length &&
        a.nodes.every((node, index) => node === b.nodes[index]),
      limit: 100,
    },
  ),
);

export function undo() {
  useGraphStore.setState({ dragPositions: {} });
  useGraphStore.temporal.getState().undo();
}
export function redo() {
  useGraphStore.setState({ dragPositions: {} });
  useGraphStore.temporal.getState().redo();
}

export function graphSnapshot(): SpaceGraph {
  const { nodes, edges, viewport } = useGraphStore.getState();
  return { schemaVersion: 1, nodes, edges, viewport };
}

export function loadGraph(graph: SpaceGraph): void {
  const history = useGraphStore.temporal.getState();
  history.pause();
  useGraphStore.setState({
    ...graph,
    selectedNodes: [],
    selectedEdges: [],
    dragPositions: {},
  });
  history.clear();
  history.resume();
}
