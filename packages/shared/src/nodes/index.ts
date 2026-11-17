import { z } from 'zod';
import type { PortType } from '../types';
import type { RunOutput } from '../media';
import type { ModelKind } from '../models';
import { ASSISTANT_PRESETS_VERSION } from '../assistant-presets';
export type NodeCategory = 'Image' | 'Video' | 'Audio' | 'Text' | 'Utilities';

export interface NodeDef<P = Record<string, unknown>> {
  type: string;
  label: string;
  category: NodeCategory;
  description: string;
  keywords: readonly string[];
  modelKind?: ModelKind;
  executionVersion?: string;
  isNew?: boolean;
  staticOutput?: (params: Record<string, unknown>) => RunOutput | null;
  missingOutputHint?: string;
  inputs: readonly {
    id: string;
    type: PortType;
    required?: boolean;
    multiple?: boolean;
  }[];
  outputs: readonly { id: string; type: PortType }[];
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
    options: z
      .record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean()]),
      )
      .default({}),
  })
  .strict();

export type ImageGeneratorParams = z.infer<typeof imageGeneratorParamsSchema>;
export const assistantParamsSchema = z
  .object({
    message: z.string().max(8000),
    preset: z.enum([
      'free',
      'prompt_improver',
      'image_to_prompt',
      'script_writer',
    ]),
    model: z.string().min(1),
    options: z
      .record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean()]),
      )
      .default({}),
  })
  .strict();

export const voiceoverParamsSchema = z
  .object({
    script: z.string().max(5000),
    model: z.string().min(1),
    voice: z.string().min(1),
    language: z.string().min(1),
    speed: z
      .number()
      .min(0.75)
      .max(1.5)
      .refine(
        (value) => Math.abs(value * 20 - Math.round(value * 20)) < 1e-8,
        'Speed must use steps of 0.05',
      ),
    options: z
      .record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean()]),
      )
      .default({}),
  })
  .strict();
export const videoGeneratorParamsSchema = z
  .object({
    prompt: z.string(),
    model: z.string().min(1),
    duration: z.number().int().min(1).max(30),
    aspectRatio: z.enum(['16:9', '9:16', '1:1']),
    resolution: z.enum(['720p', '1080p']),
    generateAudio: z.boolean(),
    options: z
      .record(
        z.string(),
        z.union([z.string(), z.number().finite(), z.boolean()]),
      )
      .default({}),
  })
  .strict();
export const nodeRegistry = {
  video_generator: {
    type: 'video_generator',
    label: 'Video Generator',
    category: 'Video',
    description: 'Animate an idea with image references',
    keywords: ['video', 'motion', 'animate', 'clip', 'phim'],
    modelKind: 'video',
    isNew: true,
    inputs: [
      { id: 'prompt', type: 'text' },
      { id: 'start_image', type: 'image' },
      { id: 'end_image', type: 'image' },
    ],
    outputs: [{ id: 'video', type: 'video' }],
    paramsSchema: videoGeneratorParamsSchema,
    defaultParams: {
      prompt: '',
      model: 'auto',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
      generateAudio: false,
      options: {},
    },
  },
  voiceover: {
    type: 'voiceover',
    label: 'Voiceover',
    category: 'Audio',
    description: 'Turn a script into an audio track',
    keywords: ['voice', 'tts', 'narration', 'speech', 'giọng nói'],
    modelKind: 'tts',
    isNew: true,
    inputs: [{ id: 'script', type: 'text' }],
    outputs: [{ id: 'audio', type: 'audio' }],
    paramsSchema: voiceoverParamsSchema,
    defaultParams: {
      script: '',
      model: 'auto',
      voice: 'calm',
      language: 'auto',
      speed: 1,
      options: {},
    },
  },
  assistant: {
    type: 'assistant',
    label: 'Assistant',
    category: 'Text',
    description: 'Improve prompts, describe images or write a script',
    keywords: ['assist', 'AI', 'improve', 'vision', 'script', 'trợ lý'],
    modelKind: 'llm',
    isNew: true,
    executionVersion: ASSISTANT_PRESETS_VERSION,
    inputs: [
      { id: 'context', type: 'text', multiple: true },
      { id: 'images', type: 'image', multiple: true },
    ],
    outputs: [{ id: 'text', type: 'text' }],
    paramsSchema: assistantParamsSchema,
    defaultParams: { message: '', preset: 'free', model: 'auto', options: {} },
  },
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
    staticOutput: (params: Record<string, unknown>): RunOutput => ({
      text: String(params.value ?? ''),
    }),
    missingOutputHint: 'Enter some text',
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
    staticOutput: (params: Record<string, unknown>): RunOutput => ({
      image:
        typeof params.assetId === 'string' ? [{ assetId: params.assetId }] : [],
    }),
    missingOutputHint: 'Choose and upload an image',
  },
  image_generator: {
    type: 'image_generator',
    label: 'Image Generator',
    category: 'Image',
    description: 'Turn a prompt into an image',
    keywords: ['generate', 'create', 'art', 'render', 'ảnh'],
    modelKind: 'image',
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
      options: {},
    },
  },
} as const satisfies Record<string, NodeDef>;
export type NodeDefinitions = Readonly<Record<string, NodeDef>>;

// Retain valid fields if a document has older or malformed parameters.
export function normalizeNodeParams(
  type: keyof typeof nodeRegistry,
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
    if (params[key] === undefined && fields[key].isOptional()) {
      delete result[key];
      continue;
    }
    const parsed = fields[key].safeParse(params[key]);
    if (parsed.success) result[key] = parsed.data;
    else warnings.push(`Invalid ${type}.${key}; using default`);
  }
  return { params: result, warnings };
}
