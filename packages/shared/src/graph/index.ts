import { nodeRegistry, type NodeDef, type NodeDefinitions } from '../nodes';
import type { GraphEdge, GraphNode } from '../types';

type Graph = {
  nodes: readonly {
    id: string;
    type: string;
    params: Record<string, unknown>;
  }[];
  edges: readonly GraphEdge[];
};
export type ConnectionCandidate = Omit<GraphEdge, 'id'>;
export interface ConnectionOrigin {
  nodeId: string;
  handleId: string;
  handleType: 'source' | 'target';
}
export function connectionForNewNode(
  graph: Graph,
  origin: ConnectionOrigin,
  node: GraphNode,
): ConnectionCandidate | undefined {
  if (graph.nodes.some((existing) => existing.id === node.id)) return;
  const definition: NodeDef<Record<string, unknown>> = nodeRegistry[node.type];
  const ports =
    origin.handleType === 'source' ? definition.inputs : definition.outputs;
  const proposed = { nodes: [...graph.nodes, node], edges: graph.edges };
  for (const port of ports) {
    const candidate =
      origin.handleType === 'source'
        ? {
            source: origin.nodeId,
            sourceHandle: origin.handleId,
            target: node.id,
            targetHandle: port.id,
          }
        : {
            source: node.id,
            sourceHandle: port.id,
            target: origin.nodeId,
            targetHandle: origin.handleId,
          };
    if (validateConnection(proposed, candidate).valid) return candidate;
  }
}
export type ConnectionValidation =
  { valid: true } | { valid: false; error: string };

export function wouldCreateCycle(
  graph: Graph,
  source: string,
  target: string,
): boolean {
  if (source === target) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacency.set(edge.source, [
      ...(adjacency.get(edge.source) ?? []),
      edge.target,
    ]);
  }
  const pending = [target];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

export function validateConnection(
  graph: Graph,
  connection: ConnectionCandidate,
  registry: NodeDefinitions = nodeRegistry,
): ConnectionValidation {
  const fail = (error: string): ConnectionValidation => ({
    valid: false,
    error,
  });
  const source = graph.nodes.find((node) => node.id === connection.source);
  const target = graph.nodes.find((node) => node.id === connection.target);
  if (!source || !target) return fail('Both nodes must exist.');
  if (source.id === target.id) return fail('A node cannot connect to itself.');
  const sourceDef: NodeDef<Record<string, unknown>> = registry[source.type];
  const targetDef: NodeDef<Record<string, unknown>> = registry[target.type];
  const output = sourceDef.outputs.find(
    (port) => port.id === connection.sourceHandle,
  );
  const input = targetDef.inputs.find(
    (port) => port.id === connection.targetHandle,
  );
  if (!output || !input)
    return fail('Connect an output to an existing input port.');
  if (output.type !== input.type)
    return fail('Text connects to text; images connect to images.');
  const incoming = graph.edges.filter(
    (edge) => edge.target === target.id && edge.targetHandle === input.id,
  );
  if (!input.multiple && incoming.length)
    return fail('This input already has a connection.');
  if (
    incoming.some(
      (edge) => edge.source === source.id && edge.sourceHandle === output.id,
    )
  ) {
    return fail('These ports are already connected.');
  }
  if (wouldCreateCycle(graph, source.id, target.id))
    return fail('This connection would create a cycle.');
  return { valid: true };
}

export function topoSort(graph: Graph): string[][] {
  const ids = graph.nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate node IDs');
  const indegree = new Map(ids.map((id) => [id, 0]));
  const adjacency = new Map(ids.map((id) => [id, [] as string[]]));
  for (const edge of graph.edges) {
    if (!indegree.has(edge.source) || !indegree.has(edge.target))
      throw new Error('Orphan edge');
    indegree.set(edge.target, indegree.get(edge.target)! + 1);
    adjacency.get(edge.source)!.push(edge.target);
  }
  let level = ids.filter((id) => indegree.get(id) === 0);
  const levels: string[][] = [];
  let processed = 0;
  while (level.length) {
    levels.push(level);
    processed += level.length;
    const next: string[] = [];
    for (const id of level) {
      for (const target of adjacency.get(id)!) {
        indegree.set(target, indegree.get(target)! - 1);
        if (indegree.get(target) === 0) next.push(target);
      }
    }
    level = next;
  }
  if (processed !== ids.length) throw new Error('Graph contains a cycle');
  return levels;
}

// PostgreSQL jsonb does not preserve object key order.
export function stableStringify(input: unknown): string {
  const serialized = JSON.stringify(input, (_key, value: unknown) => {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const object = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(object)
          .sort()
          .map((key) => [key, object[key]]),
      );
    }
    return value;
  });
  if (serialized === undefined) throw new Error('Expected a JSON value');
  return serialized;
}
