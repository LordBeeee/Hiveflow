import { z } from 'zod';
import type { NodeType, PortType } from '../types';
export type NodeCategory = 'Image' | 'Video' | 'Audio' | 'Text' | 'Utilities';

export interface NodeDef<P> {
  type: NodeType;
  label: string;
  category: NodeCategory;
  description: string;
  keywords: string[];
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

export const textParamsSchema = z.object({ value: z.string() }).strict();
export const imageUploadParamsSchema = z
  .object({
    assetId: z.uuid().nullable(),
  })
  .strict();
export const imageGeneratorParamsSchema = z
  .object({
    prompt: z.string(),
    count: z.number().int().min(1).max(4),
    model: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']),
    resolution: z.enum(['1K', '2K', '4K']),
  })
  .strict();

export type ImageGeneratorParams = z.infer<typeof imageGeneratorParamsSchema>;

export const nodeRegistry = {
  text: {
    type: 'text',
    label: 'Text',
    category: 'Text',
    description: 'Write a prompt or an idea',
    keywords: ['prompt', 'write', 'idea', 'note', 'văn bản'],
    inputs: [],
    outputs: [{ id: 'text', type: 'text' }],
    paramsSchema: textParamsSchema,
    defaultParams: { value: '' },
  },
  image_upload: {
    type: 'image_upload',
    label: 'Image Upload',
    category: 'Image',
    description: 'Bring your own reference image',
    keywords: ['reference', 'upload', 'file', 'photo', 'ảnh'],
    inputs: [],
    outputs: [{ id: 'image', type: 'image' }],
    paramsSchema: imageUploadParamsSchema,
    defaultParams: { assetId: null },
  },
  image_generator: {
    type: 'image_generator',
    label: 'Image Generator',
    category: 'Image',
    description: 'Turn a prompt into an image',
    keywords: ['generate', 'create', 'art', 'render', 'ảnh'],
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
  for (const key of Object.keys(params)) {
    if (!(key in fields)) warnings.push(`Unknown ${type}.${key}; ignored`);
  }
  for (const key of Object.keys(fields)) {
    const parsed = fields[key].safeParse(params[key]);
    if (parsed.success) result[key] = parsed.data;
    else warnings.push(`Invalid ${type}.${key}; using default`);
  }
  return { params: result, warnings };
}
