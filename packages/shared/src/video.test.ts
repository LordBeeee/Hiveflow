import { expect, it } from 'vitest';
import { nodeRegistry, videoGeneratorParamsSchema } from './nodes';
import { coerceParamsForModel, findModel, validateModelParams } from './models';
it('keeps graph saves model-agnostic but rejects unsupported video capabilities at run time', () => {
  const params = {
    ...nodeRegistry.video_generator.defaultParams,
    model: 'removed',
    duration: 10,
    aspectRatio: '9:16',
    resolution: '1080p',
    generateAudio: true,
  };
  expect(videoGeneratorParamsSchema.safeParse(params).success).toBe(true);
  expect(() => validateModelParams(params, findModel('veo-3-1-fast')!)).toThrow(
    'duration',
  );
  const result = coerceParamsForModel(
    'video_generator',
    params,
    findModel('veo-3-1-fast')!,
  );
  expect(result.params).toMatchObject({
    duration: 8,
    aspectRatio: '9:16',
    resolution: '1080p',
    generateAudio: true,
    options: {},
  });
  expect(() =>
    validateModelParams(result.params, findModel('veo-3-1-fast')!),
  ).not.toThrow();
});
