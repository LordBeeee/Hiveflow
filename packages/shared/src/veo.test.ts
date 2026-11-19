import { expect, it } from 'vitest';
import {
  availableModelSchema,
  veoCatalog,
  coerceParamsForModel,
  validateModelParams,
} from './models';
import { nodeRegistry, videoGeneratorParamsSchema } from './nodes';
import { estimateModelUnits } from './costs';
it('round trips sourced Veo models and supports text-only, first/last frames and explicit output ratios', () => {
  for (const model of veoCatalog) {
    const parsed = availableModelSchema.parse({
      ...model,
      available: false,
      isDefault: false,
    });
    expect(parsed.capabilities).toEqual(model.capabilities);
    expect(parsed.pricing).toEqual(model.pricing);
    const params = coerceParamsForModel(
      'video_generator',
      {
        ...nodeRegistry.video_generator.defaultParams,
        duration: 15,
        resolution: '4k',
        aspectRatio: 'adaptive',
      },
      model,
    ).params;
    expect(params.duration).toBe(8);
    expect(params.aspectRatio).toBe('16:9');
    expect(params.resolution).toBe(model.id === 'veo-3-1' ? '4k' : '720p');
    expect(videoGeneratorParamsSchema.safeParse(params).success).toBe(true);
    expect(() =>
      validateModelParams({ ...params, hasStartImage: false }, model),
    ).not.toThrow();
    expect(estimateModelUnits(model, params, { ports: {} })).toBeGreaterThan(0);
    expect(model.capabilities).toMatchObject({
      requiresStartImage: false,
      endImageRequiresStart: true,
      supportsEndImage: true,
      maxImageMb: 20,
      audio: 'toggle',
      cancellation: 'none',
    });
    expect(model.capabilities.imageToVideoRatio).toBeUndefined();
  }
});
