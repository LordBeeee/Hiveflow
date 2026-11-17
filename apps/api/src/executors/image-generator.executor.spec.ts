import { ProviderRegistry } from '../providers/provider-registry';
import type { AssetsService } from '../assets/assets.service';
import { nodeRegistry } from '@hiveflow/shared';
import { ImageGeneratorExecutor } from './image-generator.executor';
import type { ImageProvider } from '../providers/image-provider';

function setup() {
  const assets = {
    providerReference: jest
      .fn()
      .mockResolvedValue({ url: 'https://storage.example/signed' }),
    store: jest.fn().mockResolvedValue({
      id: 'asset',
      url: '/api/assets/asset',
      width: 10,
      height: 10,
    }),
  };
  const generate = jest
    .fn()
    .mockResolvedValue({ images: [{ bytes: Buffer.from('png') }] });
  const registry = new ProviderRegistry();
  registry.register('image', 'mock', { id: 'test', generate } as ImageProvider);
  const executor = new ImageGeneratorExecutor(
    assets as unknown as AssetsService,
    registry,
  );
  const context = {
    spaceId: crypto.randomUUID(),
    params: {
      ...nodeRegistry.image_generator.defaultParams,
      prompt: 'local',
      model: 'mock-image',
    },
    signal: new AbortController().signal,
  };
  return { executor, assets, generate, context };
}
it('uses resolved prompt and fresh signed references when calling the provider', async () => {
  const { executor, assets, generate, context } = setup();
  const assetId = crypto.randomUUID();
  await executor.execute({
    ...context,
    inputs: {
      ports: {
        prompt: [{ kind: 'text', value: 'connected' }],
        references: [{ assetId, sha256: 'hash' }].map((reference) => ({
          kind: 'asset' as const,
          mediaKind: 'image' as const,
          ...reference,
        })),
      },
    },
  });
  expect(assets.providerReference).toHaveBeenCalledWith(
    context.spaceId,
    assetId,
  );
  expect(generate.mock.calls[0][0]).toMatchObject({
    prompt: 'connected',
    references: [{ url: 'https://storage.example/signed' }],
  });
});
it('uses local prompt after disconnect, and rejects missing prompt before the provider call', async () => {
  const { executor, generate, context } = setup();
  await executor.execute({ ...context, inputs: { ports: {} } });
  expect(generate.mock.calls[0][0].prompt).toBe('local');
  context.params.prompt = '';
  await expect(executor.execute(context)).rejects.toThrow(
    'No prompt is available',
  );
  expect(generate).toHaveBeenCalledTimes(1);
});
