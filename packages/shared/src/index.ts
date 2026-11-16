import { z } from 'zod';

export const APP_NAME = 'Hiveflow';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  app: z.literal(APP_NAME),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export * from './types';
export * from './nodes';
export * from './graph';
