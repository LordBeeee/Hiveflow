import { z } from 'zod';
import { nodeRunSchema } from './runs';

export const creationKinds = ['image', 'video', 'audio'] as const;
export const creationKindSchema = z.enum(creationKinds);
export type CreationKind = z.infer<typeof creationKindSchema>;
export const creationNodeTypes = {
  image: 'image_generator',
  video: 'video_generator',
  audio: 'voiceover',
} as const;
export const creationRequestSchema = z
  .object({
    params: z.record(z.string(), z.unknown()),
    references: z.array(z.uuid()).max(10).default([]),
    startImage: z.uuid().optional(),
    endImage: z.uuid().optional(),
    force: z.boolean().default(false),
    approval: z
      .object({ fingerprint: z.string(), maxUnits: z.number().nonnegative() })
      .optional(),
  })
  .strict();
export type CreationRequest = z.infer<typeof creationRequestSchema>;
export const creationRunSchema = nodeRunSchema
  .omit({ spaceId: true, nodeId: true, batchId: true })
  .extend({
    sessionId: z.uuid(),
    params: z.record(z.string(), z.unknown()),
    references: z.array(z.uuid()),
    startImage: z.uuid().optional(),
    endImage: z.uuid().optional(),
  });
export const creationHistorySchema = z.object({
  sessionId: z.uuid().nullable(),
  runs: creationRunSchema.array(),
});
export type CreationRun = z.infer<typeof creationRunSchema>;
export const creationQuoteSchema = z.object({
  fingerprint: z.string(),
  units: z.number().nonnegative(),
  model: z.string(),
});
