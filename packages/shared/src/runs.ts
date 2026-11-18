import { z } from 'zod';
import { stableStringify } from './graph';

export {
  assetSchema,
  assetRefSchema as assetOutputSchema,
  runOutputSchema,
} from './media';
export type {
  Asset,
  RunOutput,
  ResolvedInputs,
  ResolvedValue,
  MediaKind,
} from './media';
import { runOutputSchema, type ResolvedInputs } from './media';
import { nodeRegistry, type NodeDefinitions } from './nodes';
export const runStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'skipped',
]);
export function createNodeRunSchema<T extends NodeDefinitions>(registry: T) {
  return z.object({
    runId: z.uuid(),
    spaceId: z.uuid(),
    nodeId: z.uuid(),
    nodeType: z.enum(
      Object.keys(registry) as [
        Extract<keyof T, string>,
        ...Extract<keyof T, string>[],
      ],
    ),
    sequence: z.string().regex(/^\d+$/),
    batchId: z.uuid().nullable(),
    status: runStatusSchema,
    inputHash: z.string(),
    output: runOutputSchema.nullable(),
    error: z.string().nullable(),
    provider: z.string().nullable(),
    model: z.string().nullable().optional(),
    progress: z.number().min(0).max(100).optional(),
    cacheHit: z.boolean(),
    waiting: z.boolean().optional(),
    createdAt: z.iso.datetime(),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
  });
}
export const nodeRunSchema = createNodeRunSchema(nodeRegistry);
export type NodeRun = z.infer<typeof nodeRunSchema>;
export const runEventSchema = nodeRunSchema.extend({
  type: z.literal('run.updated'),
});
export type RunEvent = z.infer<typeof runEventSchema>;
export const batchSchema = z.object({
  batchId: z.uuid(),
  spaceId: z.uuid(),
  status: z.enum(['running', 'succeeded', 'failed', 'canceled']),
  total: z.number().int(),
  completed: z.number().int(),
  failed: z.number().int(),
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type Batch = z.infer<typeof batchSchema>;
export const batchEventSchema = batchSchema.extend({
  type: z.literal('batch.updated'),
});
export const runRequestSchema = z
  .object({ force: z.boolean().optional() })
  .strict();
export const batchRunRequestSchema = runRequestSchema.extend({
  graphHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  version: z.number().int().positive().optional(),
  maxUnits: z.number().nonnegative().optional(),
  maxProviderNodes: z.number().int().nonnegative().optional(),
});
export const uploadRequestSchema = z.object({ spaceId: z.uuid() }).strict();

export async function inputHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function executionHash(
  type: string,
  params: Record<string, unknown>,
  resolved: ResolvedInputs,
  registry: NodeDefinitions = nodeRegistry,
) {
  const inputs = Object.keys(resolved.ports)
    .sort()
    .map((port) => ({
      port,
      values: resolved.ports[port].map((item) =>
        item.kind === 'text'
          ? { kind: 'text', value: item.value }
          : { kind: item.mediaKind, sha256: item.sha256 },
      ),
    }));
  return inputHash({
    type,
    params,
    ...(registry[type]?.executionVersion
      ? { executionVersion: registry[type].executionVersion }
      : {}),
    inputs,
    ...(resolved.error ? { error: resolved.error } : {}),
  });
}
