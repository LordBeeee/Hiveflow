import { expect, it } from 'vitest';
import { assistantParamsSchema, nodeRegistry } from './nodes';
import {
  ASSISTANT_PRESETS_VERSION,
  assistantPresets,
} from './assistant-presets';
import { executionHash } from './runs';
it('bounds local message and accepts each preset with model-agnostic saves', () => {
  for (const preset of Object.keys(assistantPresets))
    expect(
      assistantParamsSchema.safeParse({ message: '', preset, model: 'retired' })
        .success,
    ).toBe(true);
  expect(
    assistantParamsSchema.safeParse({
      ...nodeRegistry.assistant.defaultParams,
      message: 'a'.repeat(8001),
    }).success,
  ).toBe(false);
});
it('versions preset execution hashes without changing image hashes', async () => {
  const params = {
    ...nodeRegistry.assistant.defaultParams,
    model: 'google/gemini-4-neon',
  };
  const first = await executionHash('assistant', params, { ports: {} });
  expect(first).toBe(await executionHash('assistant', params, { ports: {} }));
  const registry = {
    ...nodeRegistry,
    assistant: {
      ...nodeRegistry.assistant,
      executionVersion: ASSISTANT_PRESETS_VERSION + '-next',
    },
  };
  expect(first).not.toBe(
    await executionHash('assistant', params, { ports: {} }, registry),
  );
  expect(
    await executionHash('image_generator', {}, { ports: {} }, registry),
  ).toBe(await executionHash('image_generator', {}, { ports: {} }));
});
