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
  expect(() =>
    validateModelParams(params, findModel('mock-video-basic')!),
  ).toThrow('aspectRatio');
  const result = coerceParamsForModel(
    'video_generator',
    params,
    findModel('mock-video-basic')!,
  );
  expect(result.params).toMatchObject({
    duration: 5,
    aspectRatio: '16:9',
    resolution: '720p',
    generateAudio: false,
    options: {},
  });
  expect(() =>
    validateModelParams(result.params, findModel('mock-video-basic')!),
  ).not.toThrow();
});
