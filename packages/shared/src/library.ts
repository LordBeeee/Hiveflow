import { z } from 'zod';
import { assetSchema, mediaKinds } from './media';

export const libraryQuerySchema = z
  .object({
    kind: z.enum(mediaKinds).optional(),
    spaceId: z.uuid().optional(),
    offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(24),
  })
  .strict();

export const libraryItemSchema = z.object({
  asset: assetSchema,
  spaceName: z.string(),
  sourceKind: z.enum(['space', 'image', 'video', 'audio']).optional(),
});
export const libraryPageSchema = z.object({
  items: libraryItemSchema.array(),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export type LibraryQuery = z.infer<typeof libraryQuerySchema>;
export type LibraryItem = z.infer<typeof libraryItemSchema>;
