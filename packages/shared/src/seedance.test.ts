import { expect, it } from 'vitest';
import {
  availableModelSchema,
  coerceParamsForModel,
  seedanceCatalog,
  validateModelParams,
} from './models';
import { nodeRegistry, videoGeneratorParamsSchema } from './nodes';
it('round trips the Seedance catalog and exposes only explicit durations and sourced prices', () => {
  for (const model of seedanceCatalog) {
    expect(
      availableModelSchema.parse({
        ...model,
        available: false,
      }).capabilities,
    ).toEqual(model.capabilities);
    expect(model.pricing?.source).toBe(
      'https://docs.byteplus.com/en/docs/modelark/model-pricing',
    );
    expect(model.capabilities.durations).not.toContain(-1);
    expect(model.capabilities.durations?.[0]).toBe(4);
    expect(model.capabilities.durations?.at(-1)).toBe(
      model.id === 'seedance-2-5' ? 30 : 15,
    );
    const params = coerceParamsForModel(
      'video_generator',
      {
        ...nodeRegistry.video_generator.defaultParams,
        duration: 30,
        resolution: '4k',
        aspectRatio: '21:9',
      },
      model,
    ).params;
    expect(params.duration).toBe(model.id === 'seedance-2-5' ? 30 : 15);
    expect(videoGeneratorParamsSchema.safeParse(params).success).toBe(true);
    expect(() => validateModelParams(params, model)).not.toThrow();
    expect(model.capabilities.requiresStartImage).toBe(false);
    expect(model.capabilities.endImageRequiresStart).toBe(true);
    expect(model.capabilities.executionExpiresAfter).toBe(3600);
  }
});
