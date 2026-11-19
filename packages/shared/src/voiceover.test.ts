import { expect, it } from 'vitest';
import { nodeRegistry, voiceoverParamsSchema } from './nodes';
import { coerceParamsForModel, findModel } from './models';
it('bounds scripts and speed including its 0.05 step while permitting model-agnostic saves', () => {
  const params = nodeRegistry.voiceover.defaultParams;
  expect(
    voiceoverParamsSchema.safeParse({
      ...params,
      model: 'retired',
      voice: 'unknown',
      language: 'xx',
      speed: 1.15,
    }).success,
  ).toBe(true);
  for (const patch of [
    { script: 'x'.repeat(5001) },
    { speed: 0.65 },
    { speed: 1.55 },
    { speed: 1.12 },
  ])
    expect(
      voiceoverParamsSchema.safeParse({ ...params, ...patch }).success,
    ).toBe(false);
});
it('coerces voice, language, speed and options together for the selected model', () => {
  const result = coerceParamsForModel(
    'voiceover',
    {
      ...nodeRegistry.voiceover.defaultParams,
      voice: 'bright',
      language: 'vi',
      speed: 1.5,
      options: { old: true },
    },
    findModel('mock-tts-narration')!,
  );
  expect(result.params).toMatchObject({
    model: 'mock-tts-narration',
    voice: 'narrator',
    language: 'en',
    speed: 1.25,
    options: {},
  });
  expect(result.notices).toHaveLength(3);
  expect(voiceoverParamsSchema.safeParse(result.params).success).toBe(true);
});
