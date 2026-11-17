import { nodeRegistry, type NodeDefinitions } from './nodes';
import type { GraphEdge } from './types';
import type { MediaKind, ResolvedInputs, RunOutput } from './media';
export interface PlatformNode {
  id: string;
  type: string;
  params: Record<string, unknown>;
}
export async function resolveNodeInputs(
  graph: { nodes: readonly PlatformNode[]; edges: readonly GraphEdge[] },
  node: PlatformNode,
  getOutput: (node: PlatformNode) => Promise<RunOutput | null | undefined>,
  getAsset: (
    id: string,
    kind: MediaKind,
  ) => Promise<{ sha256: string; kind: MediaKind } | null>,
  registry: NodeDefinitions = nodeRegistry,
): Promise<ResolvedInputs> {
  const result: ResolvedInputs = { ports: {} };
  const fail = (message: string) => ({ ...result, error: message });
  for (const port of registry[node.type].inputs) {
    const edges = graph.edges.filter(
      (edge) => edge.target === node.id && edge.targetHandle === port.id,
    );
    if (port.required && !edges.length)
      return fail(`Input '${port.id}' is required. Connect an upstream node.`);
    for (const edge of edges) {
      const source = graph.nodes.find((source) => source.id === edge.source);
      if (!source)
        return fail(
          'A connected upstream node is missing. Reconnect the input and retry.',
        );
      const definition = registry[source.type];
      const label = `${definition.label} #${graph.nodes.filter((item) => item.type === source.type).findIndex((item) => item.id === source.id) + 1}`;
      const output = definition.staticOutput
        ? definition.staticOutput(source.params)
        : await getOutput(source);
      const value = output?.[port.type];
      if (!value || (typeof value === 'string' ? !value.trim() : !value.length))
        return fail(
          `Upstream node '${label}' has no output. ${definition.missingOutputHint ?? 'Run that node successfully'} before retrying.`,
        );
      const target = (result.ports[port.id] ??= []);
      if (typeof value === 'string') target.push({ kind: 'text', value });
      else
        for (const image of value) {
          const asset = await getAsset(image.assetId, port.type as MediaKind);
          if (!asset)
            return fail(
              `Upstream node '${label}' references an unavailable image. Upload or run that node again.`,
            );
          if (asset.kind !== port.type)
            return fail(
              `Upstream node '${label}' has an incompatible media asset.`,
            );
          target.push({
            kind: 'asset',
            assetId: image.assetId,
            sha256: asset.sha256,
            mediaKind: asset.kind,
          });
        }
    }
  }
  return result;
}
