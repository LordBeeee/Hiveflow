import { useEffect, useRef } from 'react';
import {
  executionHash,
  topoSort,
  resolveNodeInputs,
  nodeRegistry,
  modelCatalog,
  selectModel,
  validateModelParams,
  type AvailableModel,
  type NodeDefinitions,
  type PlatformNode,
  type NodeRun,
  type SpaceGraph,
} from '@hiveflow/shared';
import { useGraphStore } from '../store/graph';
import { useRunStore } from '../store/runs';
import { executionApi } from './execution';
import { useModels } from './models';

export async function computeStaleNodes(
  graph: { nodes: PlatformNode[]; edges: SpaceGraph['edges'] },
  latest: Record<string, Pick<NodeRun, 'inputHash' | 'waiting' | 'output'>>,
  successes: Record<string, Pick<NodeRun, 'inputHash' | 'waiting' | 'output'>>,
  assetHash: (id: string) => Promise<string>,
  models: readonly AvailableModel[] = modelCatalog.map((model) => ({
    ...model,
    available: model.provider === 'mock' && model.status !== 'removed',
    isDefault: model.id === `mock-${model.kind}`,
  })),
  registry: NodeDefinitions = nodeRegistry,
) {
  const stale: Record<string, boolean> = {},
    outdated: Record<string, boolean> = {};
  for (const ids of topoSort(graph))
    for (const id of ids) {
      const node = graph.nodes.find((node) => node.id === id)!;
      const run = latest[id];
      if (!run) continue;
      try {
        const inputs = await resolveNodeInputs(
          graph,
          node,
          async (source) => successes[source.id]?.output,
          async (assetId, kind) => ({ sha256: await assetHash(assetId), kind }),
          registry,
        );
        if (inputs.error) throw new Error(inputs.error);
        const definition = registry[node.type];
        let params = definition.paramsSchema.parse(node.params);
        if (definition.modelKind) {
          const model = selectModel(
            String(params.model ?? 'auto'),
            definition.modelKind,
            models,
          );
          params = validateModelParams(
            params,
            model,
            Object.values(inputs.ports)
              .flat()
              .filter(
                (value) =>
                  value.kind === 'asset' && value.mediaKind === 'image',
              ).length,
          );
        }
        const hash = await executionHash(node.type, params, inputs, registry);
        const upstream = graph.edges.some(
          (edge) =>
            edge.target === id && (stale[edge.source] || outdated[edge.source]),
        );
        stale[id] = !run.waiting && (upstream || hash !== run.inputHash);
        outdated[id] =
          upstream || (!!successes[id] && hash !== successes[id].inputHash);
      } catch {
        stale[id] = true;
        outdated[id] = true;
      }
    }
  return stale;
}
export function useStaleNodes() {
  const models = useModels();
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const latest = useRunStore((state) => state.nodes);
  const successes = useRunStore((state) => state.successes);
  const assetHashes = useRef(new Map<string, Promise<string>>());
  useEffect(() => {
    let disposed = false;
    if (!models.data) return;
    void computeStaleNodes(
      { nodes, edges },
      latest,
      successes,
      (id) => {
        if (!assetHashes.current.has(id))
          assetHashes.current.set(
            id,
            executionApi
              .asset(id)
              .then((asset) => asset.sha256)
              .catch((error) => {
                assetHashes.current.delete(id);
                throw error;
              }),
          );
        return assetHashes.current.get(id)!;
      },
      models.data,
    ).then((stale) => {
      if (!disposed) useRunStore.getState().setStale(stale);
    });
    return () => {
      disposed = true;
    };
  }, [nodes, edges, latest, successes, models.data]);
}
