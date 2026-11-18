import { z } from 'zod';
export const modelKinds = ['image', 'llm', 'tts', 'video'] as const;
export type ModelKind = (typeof modelKinds)[number];
export interface ModelOption {
  key: string;
  label: string;
  type: 'select' | 'number' | 'boolean';
  choices?: readonly string[];
  min?: number;
  max?: number;
  default: string | number | boolean;
}
export interface ModelCapabilities {
  aspectRatios?: readonly string[];
  resolutions?: readonly string[];
  durations?: readonly number[];
  maxCount?: number;
  maxReferences?: number;
  supportsEndImage?: boolean;
  supportsAudio?: boolean;
  supportsImageInput?: boolean;
  voices?: readonly string[];
  languages?: readonly string[];
  speed?: { min: number; max: number; default: number };
}
export interface ModelDefinition {
  id: string;
  kind: ModelKind;
  provider: string;
  providerModelId: string;
  label: string;
  status: 'active' | 'deprecated' | 'removed';
  aliases?: readonly string[];
  capabilities: ModelCapabilities;
  options: readonly ModelOption[];
  costUnits: number;
}
export interface AvailableModel extends ModelDefinition {
  available: boolean;
  unavailableReason?: string;
  isDefault: boolean;
}
const imageCapabilities: ModelCapabilities = {
  aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4'],
  resolutions: ['1K', '2K', '4K'],
  maxCount: 4,
  maxReferences: 1000,
};
export const modelCatalog: readonly ModelDefinition[] = [
  {
    id: 'mock-image',
    kind: 'image',
    provider: 'mock',
    providerModelId: 'mock-image',
    label: 'Mock Image',
    status: 'active',
    aliases: ['mock-image-v1'],
    capabilities: imageCapabilities,
    options: [],
    costUnits: 1,
  },
  {
    id: 'mock-image-compact',
    kind: 'image',
    provider: 'mock',
    providerModelId: 'mock-image-compact',
    label: 'Mock Image Compact',
    status: 'active',
    capabilities: {
      aspectRatios: ['1:1', '16:9'],
      resolutions: ['1K'],
      maxCount: 1,
      maxReferences: 2,
    },
    options: [
      {
        key: 'quality',
        label: 'Quality',
        type: 'select',
        choices: ['draft', 'standard'],
        default: 'standard',
      },
      {
        key: 'seed',
        label: 'Seed',
        type: 'number',
        min: 0,
        max: 9999,
        default: 0,
      },
      { key: 'softLight', label: 'Soft light', type: 'boolean', default: true },
    ],
    costUnits: 1,
  },
  {
    id: 'mock-image-legacy',
    kind: 'image',
    provider: 'mock',
    providerModelId: 'legacy',
    label: 'Mock Image Legacy',
    status: 'removed',
    capabilities: imageCapabilities,
    options: [],
    costUnits: 1,
  },
  {
    id: 'image-studio',
    kind: 'image',
    provider: 'custom',
    providerModelId: 'studio',
    label: 'Image Studio (custom adapter)',
    status: 'active',
    capabilities: imageCapabilities,
    options: [],
    costUnits: 1,
  },
  {
    id: 'mock-llm',
    kind: 'llm',
    provider: 'mock',
    providerModelId: 'mock-llm',
    label: 'Mock Assistant',
    status: 'active',
    capabilities: { supportsImageInput: true },
    options: [],
    costUnits: 1,
  },
  {
    id: 'mock-llm-text',
    kind: 'llm',
    provider: 'mock',
    providerModelId: 'mock-llm-text',
    label: 'Mock Assistant Text',
    status: 'active',
    capabilities: { supportsImageInput: false },
    options: [],
    costUnits: 1,
  },
  {
    id: 'assistant-studio',
    kind: 'llm',
    provider: 'custom',
    providerModelId: 'assistant-studio',
    label: 'Assistant Studio (custom adapter)',
    status: 'active',
    capabilities: { supportsImageInput: true },
    options: [],
    costUnits: 1,
  },
  {
    id: 'mock-tts',
    kind: 'tts',
    provider: 'mock',
    providerModelId: 'mock-tts',
    label: 'Mock Voice',
    status: 'active',
    capabilities: {
      voices: ['calm', 'bright'],
      languages: ['auto', 'en', 'vi'],
      speed: { min: 0.75, max: 1.5, default: 1 },
    },
    options: [],
    costUnits: 1,
  },
  {
    id: 'mock-video',
    kind: 'video',
    provider: 'mock-video',
    providerModelId: 'mock-video',
    label: 'Mock Video',
    status: 'active',
    capabilities: {
      durations: [5, 10],
      aspectRatios: ['16:9', '9:16', '1:1'],
      resolutions: ['720p', '1080p'],
      supportsEndImage: true,
      supportsAudio: true,
    },
    options: [],
    costUnits: 2,
  },
  {
    id: 'mock-tts-narration',
    kind: 'tts',
    provider: 'mock',
    providerModelId: 'mock-tts-narration',
    label: 'Mock Narrator',
    status: 'active',
    capabilities: {
      voices: ['narrator'],
      languages: ['en'],
      speed: { min: 0.8, max: 1.25, default: 1 },
    },
    options: [],
    costUnits: 1,
  },
  {
    id: 'voice-studio',
    kind: 'tts',
    provider: 'custom',
    providerModelId: 'voice-studio',
    label: 'Voice Studio (custom adapter)',
    status: 'active',
    capabilities: {
      voices: ['studio'],
      languages: ['en'],
      speed: { min: 0.75, max: 1.5, default: 1 },
    },
    options: [],
    costUnits: 1,
  },
  {
    id: 'mock-video-basic',
    kind: 'video',
    provider: 'mock-video',
    providerModelId: 'mock-video-basic',
    label: 'Mock Video Basic',
    status: 'active',
    capabilities: {
      durations: [5],
      aspectRatios: ['16:9', '1:1'],
      resolutions: ['720p'],
      supportsEndImage: false,
      supportsAudio: false,
    },
    options: [],
    costUnits: 2,
  },
  {
    id: 'video-studio',
    kind: 'video',
    provider: 'custom',
    providerModelId: 'video-studio',
    label: 'Video Studio (custom adapter)',
    status: 'active',
    capabilities: {
      durations: [5, 10],
      aspectRatios: ['16:9'],
      resolutions: ['720p'],
      supportsEndImage: false,
      supportsAudio: false,
    },
    options: [],
    costUnits: 1,
  },
];
export function findModel(id: string, catalog = modelCatalog) {
  return catalog.find(
    (model) => model.id === id || model.aliases?.includes(id),
  );
}
export function selectModel(
  id: string,
  kind: ModelKind,
  models: readonly AvailableModel[],
) {
  const model =
    id === 'auto'
      ? models.find((model) => model.kind === kind && model.isDefault)
      : (findModel(id, models) as AvailableModel | undefined);
  if (!model || model.kind !== kind || model.status === 'removed')
    throw new Error(
      'This model is unknown or removed. Please choose another model.',
    );
  if (!model.available)
    throw new Error(
      `${model.label}: ${model.unavailableReason ?? 'Provider unavailable'}. Please choose another model.`,
    );
  return model;
}
export function optionDefaults(model: ModelDefinition) {
  return Object.fromEntries(
    model.options.map((option) => [option.key, option.default]),
  );
}
export function validateModelParams(
  params: Record<string, unknown>,
  model: ModelDefinition,
  referenceCount = 0,
): Record<string, unknown> {
  const caps = model.capabilities;
  for (const [field, supported] of Object.entries({
    aspectRatio: caps.aspectRatios,
    resolution: caps.resolutions,
    duration: caps.durations,
    voice: caps.voices,
    language: caps.languages,
  })) {
    if (
      supported &&
      params[field] !== undefined &&
      !(supported as readonly unknown[]).includes(params[field])
    )
      throw new Error(
        `${model.label} does not support ${field} ${String(params[field])}. Choose a supported value.`,
      );
  }
  if (caps.maxCount !== undefined && Number(params.count ?? 1) > caps.maxCount)
    throw new Error(
      `${model.label} supports at most ${caps.maxCount} image(s).`,
    );
  if (caps.maxReferences !== undefined && referenceCount > caps.maxReferences)
    throw new Error(
      `${model.label} supports at most ${caps.maxReferences} reference images.`,
    );
  if (
    caps.speed &&
    (Number(params.speed ?? 1) < caps.speed.min ||
      Number(params.speed ?? 1) > caps.speed.max)
  )
    throw new Error(`${model.label} does not support this speed.`);
  if (params.generateAudio === true && !caps.supportsAudio)
    throw new Error(`${model.label} does not support generated audio.`);
  const raw = params.options ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Model options must be an object.');
  const options = { ...optionDefaults(model), ...raw };
  for (const [key, value] of Object.entries(options)) {
    const descriptor = model.options.find((option) => option.key === key);
    if (!descriptor) throw new Error(`Unknown model option '${key}'.`);
    if (
      descriptor.type === 'select' &&
      (typeof value !== 'string' || !descriptor.choices?.includes(value))
    )
      throw new Error(`Choose a supported ${descriptor.label}.`);
    if (descriptor.type === 'boolean' && typeof value !== 'boolean')
      throw new Error(`${descriptor.label} must be true or false.`);
    if (
      descriptor.type === 'number' &&
      (typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < (descriptor.min ?? -Infinity) ||
        value > (descriptor.max ?? Infinity))
    )
      throw new Error(`${descriptor.label} is outside its supported range.`);
  }
  return { ...params, model: model.id, options };
}
export function coerceParamsForModel(
  _type: string,
  params: Record<string, unknown>,
  model: ModelDefinition,
) {
  const result: Record<string, unknown> = {
    ...params,
    model: model.id,
    options: optionDefaults(model),
  };
  const notices: string[] = [];
  const assign = (key: string, value: unknown) => {
    if (params[key] !== value)
      notices.push(
        `${key} changed to ${String(value)}: not supported by this model`,
      );
    result[key] = value;
  };
  const caps = model.capabilities;
  for (const [key, values] of Object.entries({
    aspectRatio: caps.aspectRatios,
    resolution: caps.resolutions,
    duration: caps.durations,
    voice: caps.voices,
    language: caps.languages,
  }))
    if (
      values?.length &&
      params[key] !== undefined &&
      !(values as readonly unknown[]).includes(params[key])
    ) {
      assign(
        key,
        typeof values[0] === 'number'
          ? [...(values as readonly number[])].sort(
              (a, b) =>
                Math.abs(a - Number(params[key])) -
                Math.abs(b - Number(params[key])),
            )[0]
          : values[0],
      );
    }
  if (caps.maxCount !== undefined && Number(params.count) > caps.maxCount)
    assign('count', caps.maxCount);
  if (caps.speed && params.speed !== undefined)
    assign(
      'speed',
      Math.min(caps.speed.max, Math.max(caps.speed.min, Number(params.speed))),
    );
  if (params.generateAudio === true && !caps.supportsAudio)
    assign('generateAudio', false);
  return { params: result, notices };
}
const optionSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['select', 'number', 'boolean']),
  choices: z.string().array().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]),
});
export const availableModelSchema = z.object({
  id: z.string(),
  kind: z.enum(modelKinds),
  provider: z.string(),
  providerModelId: z.string(),
  label: z.string(),
  status: z.enum(['active', 'deprecated', 'removed']),
  aliases: z.string().array().optional(),
  capabilities: z.object({
    aspectRatios: z.string().array().optional(),
    resolutions: z.string().array().optional(),
    durations: z.number().array().optional(),
    maxCount: z.number().optional(),
    maxReferences: z.number().optional(),
    supportsEndImage: z.boolean().optional(),
    supportsAudio: z.boolean().optional(),
    supportsImageInput: z.boolean().optional(),
    voices: z.string().array().optional(),
    languages: z.string().array().optional(),
    speed: z
      .object({ min: z.number(), max: z.number(), default: z.number() })
      .optional(),
  }),
  options: optionSchema.array(),
  costUnits: z.number(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
  isDefault: z.boolean(),
});
