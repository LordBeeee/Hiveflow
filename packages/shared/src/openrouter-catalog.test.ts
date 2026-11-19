import { describe, expect, it } from 'vitest';
import {
  availableModelSchema,
  coerceParamsForModel,
  findModel,
  modelCatalog,
  openrouterCatalog,
  validateModelParams,
} from './models';
import {
  imageGeneratorParamsSchema,
  nodeRegistry,
  voiceoverParamsSchema,
} from './nodes';
import { estimateModelUnits } from './costs';
describe('chosen OpenRouter catalog', () => {
  it('contains only the chosen kinds/families with unique IDs and sourced prices', () => {
    expect(
      openrouterCatalog.filter((model) => model.kind === 'llm'),
    ).toHaveLength(83);
    expect(
      openrouterCatalog.filter((model) => model.kind === 'image'),
    ).toHaveLength(19);
    expect(
      openrouterCatalog.filter((model) => model.kind === 'tts'),
    ).toHaveLength(12);
    expect(new Set(modelCatalog.map((model) => model.id)).size).toBe(
      modelCatalog.length,
    );
    for (const model of openrouterCatalog) {
      expect(model.providerModelId).toBe(model.id);
      expect(model.pricing?.source).toMatch(
        /^https:\/\/openrouter.ai\/api\/v1\//,
      );
      expect(model.pricing?.checkedAt).toBe('2026-11-19');
      expect(Number.isFinite(model.costUnits)).toBe(true);
      expect(model.costUnits).toBeGreaterThanOrEqual(0);
      const parsed = availableModelSchema.parse({
        ...model,
        available: true,
        isDefault: false,
      });
      expect(parsed.capabilities).toEqual(model.capabilities);
      expect(parsed.pricing).toEqual(model.pricing);
      expect(parsed.options).toEqual(model.options);
      if (model.kind === 'llm')
        expect(model.providerModelId).toMatch(/^(openai|google)\//);
    }
  });
  it('keeps documented preview/deprecation/retirement status', () => {
    expect(findModel('google/gemini-3.1-flash-tts-preview')?.status).toBe(
      'preview',
    );
    expect(findModel('openai/gpt-5')?.status).toBe('deprecated');
    expect(findModel('google/gemini-2.5-flash-image')?.status).toBe(
      'deprecated',
    );
    expect(findModel('openai/gpt-image-1')?.status).toBe('removed');
  });
  it('coerces existing mock settings into valid image/speech settings', () => {
    for (const model of openrouterCatalog.filter(
      (entry) => entry.kind !== 'llm',
    )) {
      const type = model.kind === 'image' ? 'image_generator' : 'voiceover';
      const { params } = coerceParamsForModel(
        type,
        { ...nodeRegistry[type].defaultParams },
        model,
      );
      expect(() =>
        (type === 'image_generator'
          ? imageGeneratorParamsSchema
          : voiceoverParamsSchema
        ).parse(params),
      ).not.toThrow();
      expect(() => validateModelParams(params, model)).not.toThrow();
    }
    const lite = findModel('bytedance-seed/seedream-5-0-lite')!;
    expect(
      coerceParamsForModel('image_generator', { resolution: '1K' }, lite).params
        .resolution,
    ).toBe('2K');
    expect(
      voiceoverParamsSchema.parse({
        ...nodeRegistry.voiceover.defaultParams,
        speed: 0.7,
      }).speed,
    ).toBe(0.7);
  });
  it('allows newly documented ratios/tiers and rounds fractional tier estimates upward', () => {
    expect(
      imageGeneratorParamsSchema.parse({
        ...nodeRegistry.image_generator.defaultParams,
        resolution: '1.5K',
        aspectRatio: '21:9',
      }).resolution,
    ).toBe('1.5K');
    const model = {
      ...findModel('google/gemini-3.1-flash-image')!,
      costUnits: 1.001,
    };
    expect(
      estimateModelUnits(model, { count: 1, resolution: '512' }, { ports: {} }),
    ).toBe(0.501);
    expect(
      estimateModelUnits(
        model,
        { count: 1, resolution: '1.5K' },
        { ports: {} },
      ),
    ).toBe(1.502);
  });
});
