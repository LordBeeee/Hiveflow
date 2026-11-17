import { useEffect, useRef } from 'react';
import {
  executionHash,
  topoSort,
  type GraphNode,
  type NodeRun,
  type SpaceGraph,
} from '@hiveflow/shared';
import { useGraphStore } from '../store/graph';
import { useRunStore } from '../store/runs';
import { executionApi } from './execution';

export async function computeStaleNodes(
  graph: SpaceGraph,
  latest: Record<string, NodeRun>,
  successes: Record<string, NodeRun>,
  assetHash: (id: string) => Promise<string>,
) {
  const stale: Record<string, boolean> = {};
  const outdated: Record<string, boolean> = {};
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const hashes = new Map<string, Promise<string>>();
  const hash = (id: string) => {
    if (!hashes.has(id)) hashes.set(id, assetHash(id));
    return hashes.get(id)!;
  };
  for (const ids of topoSort(graph))
    for (const id of ids) {
      const node = byId.get(id)!;
      const run = latest[id];
      if (!run) continue;
      const references: { sha256: string }[] = [];
      let prompt: string | undefined;
      let upstreamStale = false;
      try {
        for (const edge of graph.edges.filter((edge) => edge.target === id)) {
          const source = byId.get(edge.source) as GraphNode;
          if (stale[source.id] || outdated[source.id]) upstreamStale = true;
          if (edge.targetHandle === 'prompt')
            prompt = String(source.params.value ?? '');
          else if (source.type === 'image_upload') {
            if (typeof source.params.assetId !== 'string')
              throw new Error('Missing reference');
            references.push({ sha256: await hash(source.params.assetId) });
          } else {
            const images = successes[source.id]?.output?.image;
            if (!images?.length) throw new Error('Missing upstream output');
            for (const image of images)
              references.push({
                sha256: image.sha256 ?? (await hash(image.assetId)),
              });
          }
        }
        const currentHash = await executionHash(node.type, node.params, {
          prompt,
          references,
        });
        stale[id] =
          !run.waiting && (upstreamStale || currentHash !== run.inputHash);
        outdated[id] =
          upstreamStale ||
          (successes[id] !== undefined &&
            currentHash !== successes[id].inputHash);
      } catch {
        stale[id] = true;
        outdated[id] = true;
      }
    }
  return stale;
}
export function useStaleNodes() {
  const nodes = useGraphStore((state) => state.nodes);
  const edges = useGraphStore((state) => state.edges);
  const latest = useRunStore((state) => state.nodes);
  const successes = useRunStore((state) => state.successes);
  const assetHashes = useRef(new Map<string, Promise<string>>());
  useEffect(() => {
    let disposed = false;
    void computeStaleNodes(
      { schemaVersion: 1, nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } },
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
    ).then((stale) => {
      if (!disposed) useRunStore.getState().setStale(stale);
    });
    return () => {
      disposed = true;
    };
  }, [nodes, edges, latest, successes]);
}
