import { expect, it } from 'vitest';
import {
  availableModelSchema,
  klingCatalog,
  coerceParamsForModel,
  validateModelParams,
} from './models';
import { nodeRegistry, videoGeneratorParamsSchema } from './nodes';
import { estimateModelUnits } from './costs';
it('round trips Kling capabilities and prices, coerces models and requires a start frame', () => {
  for (const model of klingCatalog) {
    const parsed = availableModelSchema.parse({
      ...model,
      available: true,
    });
    expect(parsed.capabilities).toEqual(model.capabilities);
    expect(parsed.pricing).toEqual(model.pricing);
    expect(model.pricing?.providerUnitRates?.length).toBe(
      model.id === 'kling-3-0' ? 6 : 2,
    );
    expect(model.pricing?.rates).toBeUndefined();
    const result = coerceParamsForModel(
      'video_generator',
      {
        ...nodeRegistry.video_generator.defaultParams,
        duration: 30,
        resolution: '4k',
      },
      model,
    ).params;
    expect(result.duration).toBe(15);
    expect(result.aspectRatio).toBe('adaptive');
    expect(result.generateAudio).toBe(model.capabilities.audio === 'included');
    expect(videoGeneratorParamsSchema.safeParse(result).success).toBe(true);
    expect(() =>
      validateModelParams({ ...result, hasStartImage: true }, model),
    ).not.toThrow();
    expect(() =>
      validateModelParams({ ...result, hasStartImage: false }, model),
    ).toThrow('start image');
    expect(estimateModelUnits(model, result, { ports: {} })).toBeGreaterThan(0);
    expect(model.capabilities.cancellation).toBe('none');
  }
});
