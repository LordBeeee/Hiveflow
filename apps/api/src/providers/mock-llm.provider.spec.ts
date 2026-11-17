import { ConfigService } from '@nestjs/config';
import { assistantPresets } from '@hiveflow/shared';
import { MockLlmProvider } from './mock-llm.provider';
it('is deterministic and visibly preset-aware', async () => {
  const provider = new MockLlmProvider(
    new ConfigService({ MOCK_FAILURE_RATE: 0 }),
    async () => {},
  );
  const signal = new AbortController().signal;
  for (const preset of Object.values(assistantPresets)) {
    const request = {
      system: preset.system,
      messages: [{ role: 'user' as const, text: 'A quiet cabin' }],
      model: 'mock-llm',
      maxTokens: 6000,
    };
    const first = await provider.complete(request, signal);
    expect(first).toEqual(await provider.complete(request, signal));
    expect(first.text).toContain('A quiet cabin');
  }
});
it('honors failure injection and cancellation', async () => {
  const request = {
    system: '',
    messages: [],
    model: 'mock-llm',
    maxTokens: 6000,
  };
  const provider = new MockLlmProvider(
    new ConfigService({ MOCK_FAILURE_RATE: 1 }),
    async () => {},
  );
  await expect(
    provider.complete(request, new AbortController().signal),
  ).rejects.toThrow('Mock assistant failed');
  const controller = new AbortController();
  controller.abort(new Error('Canceled'));
  await expect(provider.complete(request, controller.signal)).rejects.toThrow(
    'Canceled',
  );
});
