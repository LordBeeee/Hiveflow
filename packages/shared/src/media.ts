import { z } from 'zod';
export const mediaKinds = ['image', 'video', 'audio'] as const;
export type MediaKind = (typeof mediaKinds)[number];
export const assetRefSchema = z.object({
  assetId: z.uuid(),
  url: z.string().optional(),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
});
export const runOutputSchema = z.object({
  text: z.string().optional(),
  image: assetRefSchema.array().max(4).optional(),
  video: assetRefSchema.array().max(1).optional(),
  audio: assetRefSchema.array().max(1).optional(),
});
export type RunOutput = z.infer<typeof runOutputSchema>;
const commonAsset = z.object({
  id: z.uuid(),
  spaceId: z.uuid(),
  url: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.iso.datetime(),
});
const dimensions = {
  width: z.number().int().positive(),
  height: z.number().int().positive(),
};
export const assetSchema = z.discriminatedUnion('kind', [
  commonAsset.extend({
    kind: z.literal('image'),
    ...dimensions,
    durationMs: z.null().optional(),
  }),
  commonAsset.extend({
    kind: z.literal('video'),
    ...dimensions,
    durationMs: z.number().int().nonnegative().nullable().optional(),
  }),
  commonAsset.extend({
    kind: z.literal('audio'),
    width: z.null().optional(),
    height: z.null().optional(),
    durationMs: z.number().int().nonnegative().nullable().optional(),
  }),
]);
export type Asset = z.infer<typeof assetSchema>;
export type ResolvedValue =
  | { kind: 'text'; value: string }
  | { kind: 'asset'; assetId: string; sha256: string; mediaKind: MediaKind };
export interface ResolvedInputs {
  ports: Record<string, ResolvedValue[]>;
  error?: string;
}
