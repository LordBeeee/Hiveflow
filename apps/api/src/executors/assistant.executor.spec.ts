import { ConfigService } from '@nestjs/config';
import { assistantPresets, nodeRegistry } from '@hiveflow/shared';
import { AssistantExecutor } from './assistant.executor';
import { ProviderRegistry } from '../providers/provider-registry';
import type { AssetsService } from '../assets/assets.service';
function setup(model = 'mock-llm') {
  const complete = jest
    .fn()
    .mockResolvedValue({ text: 'Improved cabin prompt' });
  const registry = new ProviderRegistry();
  registry.register('llm', 'mock', { id: 'mock', ...{ complete } });
  const assets = {
    providerReference: jest
      .fn()
      .mockResolvedValue({ url: 'https://storage.example/private' }),
  };
  const executor = new AssistantExecutor(
    assets as unknown as AssetsService,
    registry,
    new ConfigService({ PROVIDER_MAX_RETRIES: 2 }),
  );
  const context = {
    spaceId: crypto.randomUUID(),
    params: {
      ...nodeRegistry.assistant.defaultParams,
      message: 'local',
      model,
      preset: 'prompt_improver',
    },
    signal: new AbortController().signal,
  };
  return { complete, assets, executor, context };
}
it('keeps ordered context followed by local message, uses preset and signs image references', async () => {
  const { complete, assets, executor, context } = setup();
  const assetId = crypto.randomUUID();
  const result = await executor.execute({
    ...context,
    inputs: {
      ports: {
        context: [
          { kind: 'text', value: 'first' },
          { kind: 'text', value: 'second' },
        ],
        images: [
          { kind: 'asset', assetId, sha256: 'hash', mediaKind: 'image' },
        ],
      },
    },
  });
  expect(complete.mock.calls[0][0]).toEqual({
    system: assistantPresets.prompt_improver.system,
    messages: [
      {
        role: 'user',
        text: 'first\n\nsecond\n\nlocal',
        images: [{ url: 'https://storage.example/private' }],
      },
    ],
    model: 'mock-llm',
    maxTokens: 6000,
  });
  expect(assets.providerReference).toHaveBeenCalledWith(
    context.spaceId,
    assetId,
  );
  expect(result).toEqual({
    output: { text: 'Improved cabin prompt' },
    provider: 'mock',
  });
});
it('rejects excess context and empty instructions before calling the provider', async () => {
  const { complete, executor, context } = setup();
  await expect(
    executor.execute({
      ...context,
      inputs: {
        ports: { context: [{ kind: 'text', value: 'x'.repeat(20000) }] },
      },
    }),
  ).rejects.toThrow('20,000');
  await expect(
    executor.execute({
      ...context,
      params: { ...context.params, message: '' },
    }),
  ).rejects.toThrow('Enter a message');
  expect(complete).not.toHaveBeenCalled();
});
it('rejects nonvision models before signing images or calling the provider', async () => {
  const { complete, assets, executor, context } = setup('mock-llm-text');
  await expect(
    executor.execute({
      ...context,
      inputs: {
        ports: {
          images: [
            {
              kind: 'asset',
              assetId: crypto.randomUUID(),
              sha256: 'hash',
              mediaKind: 'image',
            },
          ],
        },
      },
    }),
  ).rejects.toThrow('does not support image input');
  expect(complete).not.toHaveBeenCalled();
  expect(assets.providerReference).not.toHaveBeenCalled();
});
it('caps output at 20,000 characters and rejects empty or canceled completions', async () => {
  const { complete, executor, context } = setup();
  complete.mockResolvedValueOnce({ text: 'x'.repeat(21000) });
  expect((await executor.execute(context)).output.text).toHaveLength(20000);
  complete.mockResolvedValueOnce({ text: '' });
  await expect(executor.execute(context)).rejects.toThrow('returned no text');
  const controller = new AbortController();
  controller.abort(new Error('canceled'));
  const before = complete.mock.calls.length;
  await expect(
    executor.execute({ ...context, signal: controller.signal }),
  ).rejects.toThrow('canceled');
  expect(complete).toHaveBeenCalledTimes(before);
});
