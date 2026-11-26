import { describe, expect, it } from 'vitest';
import {
  availableModelSchema,
  coerceParamsForModel,
  modelCatalog,
  validateModelParams,
  type ModelDefinition,
} from './models';
const model: ModelDefinition = {
  ...modelCatalog[0],
  capabilities: {
    maxPromptChars: 4,
    maxInputChars: 5,
    supportsSpeed: false,
    audio: 'none',
    requiresStartImage: true,
  },
};
describe('provider capability contracts', () => {
  it('enforces prompts, scripts, speed, required images and audio', () => {
    for (const params of [
      { prompt: '12345' },
      { script: '123456' },
      { speed: 1.2 },
      { hasStartImage: false },
      { generateAudio: true },
    ])
      expect(() => validateModelParams(params, model)).toThrow();
    expect(() =>
      validateModelParams(
        { prompt: '1234', script: '12345', speed: 1, hasStartImage: true },
        model,
      ),
    ).not.toThrow();
  });
  it('validates and coerces discrete speeds and included audio', () => {
    const discrete = {
      ...model,
      capabilities: {
        speedValues: [0.75, 1, 1.1, 1.2],
        audio: 'included' as const,
      },
    };
    expect(() => validateModelParams({ speed: 1.05 }, discrete)).toThrow();
    expect(
      coerceParamsForModel('voiceover', { speed: 1.09 }, discrete).params.speed,
    ).toBe(1.1);
    expect(
      coerceParamsForModel(
        'video_generator',
        { generateAudio: false },
        discrete,
      ).params.generateAudio,
    ).toBe(true);
    expect(
      availableModelSchema.parse({
        ...discrete,
        available: true,
      }).capabilities,
    ).toEqual(discrete.capabilities);
  });
});
