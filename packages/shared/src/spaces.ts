import { z } from 'zod';
import { validateConnection } from './graph';
import { nodeRegistry, normalizeNodeParams, type NodeDef } from './nodes';
import type { SpaceGraph } from './types';

const pointSchema = z
  .object({ x: z.number().finite(), y: z.number().finite() })
  .strict();
export function createGraphSchemas<T extends Record<string, NodeDef>>(
  registry: T,
) {
  const graphStructureSchema = z
    .object({
      schemaVersion: z.literal(1),
      nodes: z
        .array(
          z
            .object({
              id: z.uuid(),
              type: z.enum(
                Object.keys(registry) as [
                  Extract<keyof T, string>,
                  ...Extract<keyof T, string>[],
                ],
              ),
              position: pointSchema,
              params: z.record(z.string(), z.unknown()),
            })
            .strict(),
        )
        .max(1000),
      edges: z
        .array(
          z
            .object({
              id: z.string().min(1).max(128),
              source: z.uuid(),
              sourceHandle: z.string().min(1),
              target: z.uuid(),
              targetHandle: z.string().min(1),
            })
            .strict(),
        )
        .max(5000),
      viewport: pointSchema.extend({
        zoom: z.number().finite().positive().max(4),
      }),
    })
    .strict();

  const spaceGraphSchema = graphStructureSchema.superRefine(
    (graph, context) => {
      const nodeIds = new Set<string>();
      graph.nodes.forEach((node, index) => {
        if (nodeIds.has(node.id))
          context.addIssue({
            code: 'custom',
            path: ['nodes', index, 'id'],
            message: 'Duplicate node ID',
          });
        nodeIds.add(node.id);
        const params = registry[node.type].paramsSchema.safeParse(node.params);
        if (!params.success)
          for (const issue of params.error.issues)
            context.addIssue({
              code: 'custom',
              path: ['nodes', index, 'params', ...issue.path],
              message: issue.message,
            });
      });
      const edgeIds = new Set<string>();
      graph.edges.forEach((edge, index) => {
        if (edgeIds.has(edge.id))
          context.addIssue({
            code: 'custom',
            path: ['edges', index, 'id'],
            message: 'Duplicate edge ID',
          });
        edgeIds.add(edge.id);
        const result = validateConnection(
          { nodes: graph.nodes, edges: graph.edges.slice(0, index) },
          edge,
          registry,
        );
        if (!result.valid)
          context.addIssue({
            code: 'custom',
            path: ['edges', index],
            message: result.error,
          });
      });
    },
  );

  return { graphStructureSchema, spaceGraphSchema };
}
export const { graphStructureSchema, spaceGraphSchema } =
  createGraphSchemas(nodeRegistry);

export const spaceNameSchema = z.string().trim().min(1).max(120);
export const createSpaceSchema = z
  .object({
    name: spaceNameSchema.optional(),
    graph: spaceGraphSchema.optional(),
  })
  .strict();
export const updateSpaceSchema = z
  .object({
    name: spaceNameSchema.optional(),
    graph: spaceGraphSchema.optional(),
    version: z.number().int().positive().max(2147483647),
  })
  .strict()
  .refine((body) => body.name !== undefined || body.graph !== undefined, {
    message: 'Provide a name or graph',
  });
export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;

export const spaceSummarySchema = z.object({
  id: z.uuid(),
  name: spaceNameSchema,
  version: z.number().int().positive().max(2147483647),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const spaceDocumentSchema = spaceSummarySchema.extend({
  graph: graphStructureSchema,
  schemaVersion: z.number().int().positive(),
});
export type SpaceSummary = z.infer<typeof spaceSummarySchema>;
export type SpaceDocument = z.infer<typeof spaceDocumentSchema>;

export function emptyGraph(): SpaceGraph {
  return {
    schemaVersion: 1,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}

// Version 1 requires no migration. Future versions must be explicitly migrated here.
export function migrateGraph(input: unknown): SpaceGraph {
  return graphStructureSchema.parse(input);
}

export function prepareGraphForLoad(input: unknown): {
  graph: SpaceGraph;
  warnings: string[];
} {
  const graph = migrateGraph(input);
  const warnings: string[] = [];
  const nodes = graph.nodes.map((node) => {
    const normalized = normalizeNodeParams(node.type, node.params);
    warnings.push(
      ...normalized.warnings.map((warning) => `${node.id}: ${warning}`),
    );
    return { ...node, params: normalized.params };
  });
  return { graph: spaceGraphSchema.parse({ ...graph, nodes }), warnings };
}
