import { z } from 'zod';
import type { ModelDefinition } from './models';
import type { ResolvedInputs } from './media';
import type { SpaceGraph } from './types';
import { inputHash } from './runs';
export function costGraphHash(graph: SpaceGraph) {
  return inputHash({
    schemaVersion: graph.schemaVersion,
    nodes: graph.nodes.map(({ id, type, params }) => ({ id, type, params })),
    edges: graph.edges,
  });
}
// Arithmetic uses thousandths of an abstract credit, never floating point accumulation.
export function estimateModelUnits(
  model: ModelDefinition,
  params: Record<string, unknown>,
  inputs: ResolvedInputs,
  unknownScript = false,
) {
  const base = Math.round(model.costUnits * 1000);
  let milli = base;
  if (model.kind === 'image')
    milli = Math.ceil(
      base *
        Number(params.count ?? 1) *
        ((
          { '512': 0.5, '1K': 1, '1.5K': 1.5, '2K': 2, '4K': 4 } as Record<
            string,
            number
          >
        )[String(params.resolution)] ?? 1),
    );
  if (model.kind === 'video')
    milli *=
      Number(params.duration ?? 5) * (params.resolution === '1080p' ? 2 : 1);
  if (model.kind === 'tts') {
    const connected = inputs.ports.script?.[0];
    const text =
      connected?.kind === 'text'
        ? connected.value
        : String(params.script ?? '');
    if (!unknownScript && text.length > 5000)
      throw new Error(
        'Voiceover script exceeds 5,000 characters. Shorten the connected script before running.',
      );
    milli = Math.ceil((base * (unknownScript ? 5000 : text.length)) / 1000);
  }
  if (!Number.isSafeInteger(milli) || milli < 0)
    throw new Error('Invalid model cost estimate');
  return milli / 1000;
}
export const estimateRequestSchema = z
  .object({ force: z.boolean().optional(), nodeId: z.uuid().optional() })
  .strict();
export const nodeCostSchema = z.object({
  nodeId: z.uuid(),
  units: z.number().nonnegative(),
  providerUnits: z.number().nonnegative(),
  cached: z.boolean(),
  providerCall: z.boolean(),
  upperBound: z.boolean(),
  model: z.string().nullable(),
  error: z.string().optional(),
});
export const costEstimateSchema = z.object({
  providerNodes: z.number().int().nonnegative(),
  cachedNodes: z.number().int().nonnegative(),
  units: z.number().nonnegative(),
  upperBound: z.boolean(),
  nodes: nodeCostSchema.array(),
  version: z.number().int().optional(),
  graphHash: z.string().optional(),
  allowed: z.boolean().optional(),
  limitMessage: z.string().optional(),
});
export type CostEstimate = z.infer<typeof costEstimateSchema>;
