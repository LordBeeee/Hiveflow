import { z } from 'zod';
import type { NodeType, PortType } from '../types';

export interface NodeDef<P> {
  type: NodeType;
  label: string;
  inputs: {
    id: string;
    type: PortType;
    required?: boolean;
    multiple?: boolean;
  }[];
  outputs: { id: string; type: PortType }[];
  paramsSchema: z.ZodType<P>;
  defaultParams: P;
}

export const textParamsSchema = z.object({ value: z.string() });
export const imageUploadParamsSchema = z.object({
  assetId: z.uuid().nullable(),
});
export const imageGeneratorParamsSchema = z.object({
  prompt: z.string(),
  count: z.number().int().min(1).max(4),
  model: z.string().min(1),
  aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']),
  resolution: z.enum(['1K', '2K', '4K']),
});

export type ImageGeneratorParams = z.infer<typeof imageGeneratorParamsSchema>;

export const nodeRegistry = {
  text: {
    type: 'text',
    label: 'Text',
    inputs: [],
    outputs: [{ id: 'text', type: 'text' }],
    paramsSchema: textParamsSchema,
    defaultParams: { value: '' },
  },
  image_upload: {
    type: 'image_upload',
    label: 'Image Upload',
    inputs: [],
    outputs: [{ id: 'image', type: 'image' }],
    paramsSchema: imageUploadParamsSchema,
    defaultParams: { assetId: null },
  },
  image_generator: {
    type: 'image_generator',
    label: 'Image Generator',
    inputs: [
      { id: 'prompt', type: 'text' },
      { id: 'references', type: 'image', multiple: true },
    ],
    outputs: [{ id: 'image', type: 'image' }],
    paramsSchema: imageGeneratorParamsSchema,
    defaultParams: {
      prompt: '',
      count: 1,
      model: 'auto',
      aspectRatio: '1:1',
      resolution: '1K',
    },
  },
} satisfies Record<NodeType, NodeDef<Record<string, unknown>>>;

// Retain valid fields if a document has older or malformed parameters.
export function normalizeNodeParams(
  type: NodeType,
  params: Record<string, unknown>,
) {
  const definition = nodeRegistry[type];
  const fields: Record<string, z.ZodType> = definition.paramsSchema.shape;
  const result: Record<string, unknown> = { ...definition.defaultParams };
  const warnings: string[] = [];
  for (const key of Object.keys(fields)) {
    const parsed = fields[key].safeParse(params[key]);
    if (parsed.success) result[key] = parsed.data;
    else warnings.push(`Invalid ${type}.${key}; using default`);
  }
  return { params: result, warnings };
}
