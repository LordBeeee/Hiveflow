import { z } from 'zod';
import { stableStringify } from './graph';
import type { NodeType } from './types';

export const assetSchema = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  kind: z.literal('image'),
  url: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
});
export type Asset = z.infer<typeof assetSchema>;
export const assetOutputSchema = z.object({
  assetId: z.uuid(),
  url: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const runOutputSchema = z.object({
  text: z.string().optional(),
  image: z.array(assetOutputSchema).max(4).optional(),
});
export type RunOutput = z.infer<typeof runOutputSchema>;
export const runStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'canceled',
  'skipped',
]);
export const nodeRunSchema = z.object({
  runId: z.uuid(),
  spaceId: z.uuid(),
  nodeId: z.uuid(),
  nodeType: z.enum(['text', 'image_upload', 'image_generator']),
  sequence: z.string().regex(/^\d+$/),
  batchId: z.uuid().nullable(),
  status: runStatusSchema,
  inputHash: z.string(),
  output: runOutputSchema.nullable(),
  error: z.string().nullable(),
  provider: z.string().nullable(),
  cacheHit: z.boolean(),
  waiting: z.boolean().optional(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});
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
export const uploadRequestSchema = z.object({ spaceId: z.uuid() }).strict();

export async function inputHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function executionHash(
  type: NodeType,
  params: Record<string, unknown>,
  resolved: {
    prompt?: string;
    references: { sha256: string }[];
    error?: string;
  },
) {
  const inputs: { port: string; values: string[] }[] = [];
  // Keep invalid connected inputs distinct from a valid node with no connections.
  if (resolved.error) inputs.push({ port: 'error', values: [resolved.error] });
  if (resolved.prompt !== undefined)
    inputs.push({ port: 'prompt', values: [resolved.prompt] });
  if (resolved.references.length)
    inputs.push({
      port: 'references',
      values: resolved.references.map((image) => image.sha256),
    });
  inputs.sort((a, b) => (a.port < b.port ? -1 : a.port > b.port ? 1 : 0));
  return inputHash({ type, params, inputs });
}
