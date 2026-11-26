import { ConfigService } from '@nestjs/config';
import { nodeRegistry } from '@hiveflow/shared';
import { VoiceoverExecutor } from './voiceover.executor';
import { ProviderRegistry } from '../providers/provider-registry';
import type { AssetsService } from '../assets/assets.service';
function setup() {
  const synthesize = jest.fn().mockResolvedValue({
    bytes: Buffer.from('wave'),
    mime: 'audio/wav',
    durationMs: 1200,
  });
  const registry = new ProviderRegistry();
  registry.register('tts', 'openrouter', {
    id: 'openrouter',
    ...{ synthesize },
  });
  const asset = {
    id: crypto.randomUUID(),
    url: '/api/assets/audio',
    sha256: 'hash',
    durationMs: 1200,
  };
  const assets = { store: jest.fn().mockResolvedValue(asset) };
  const executor = new VoiceoverExecutor(
    assets as unknown as AssetsService,
    registry,
    new ConfigService({ PROVIDER_MAX_RETRIES: 2 }),
  );
  const context = {
    spaceId: crypto.randomUUID(),
    params: {
      ...nodeRegistry.voiceover.defaultParams,
      model: 'elevenlabs/eleven-v4',
      script: 'Local script',
      voice: 'george',
    },
    signal: new AbortController().signal,
  };
  return { synthesize, assets, asset, executor, context };
}
it('uses connected script, resolves provider settings and stores audio metadata', async () => {
  const { synthesize, assets, asset, executor, context } = setup();
  const result = await executor.execute({
    ...context,
    inputs: {
      ports: { script: [{ kind: 'text', value: 'Assistant narration' }] },
    },
  });
  expect(synthesize.mock.calls[0][0]).toEqual({
    text: 'Assistant narration',
    voice: 'george',
    language: 'auto',
    speed: 1,
    model: 'elevenlabs/eleven-v4',
  });
  expect(assets.store).toHaveBeenCalledWith(context.spaceId, {
    kind: 'audio',
    bytes: Buffer.from('wave'),
    mime: 'audio/wav',
    meta: { durationMs: 1200 },
  });
  expect(result.output.audio[0]).toMatchObject({
    assetId: asset.id,
    durationMs: 1200,
    sha256: 'hash',
  });
  await executor.execute({ ...context, inputs: { ports: {} } });
  expect(synthesize.mock.calls[1][0].text).toBe('Local script');
});
it('rejects empty/oversized connected scripts without falling back or calling the provider', async () => {
  const { synthesize, executor, context } = setup();
  for (const text of ['', 'x'.repeat(5001)])
    await expect(
      executor.execute({
        ...context,
        inputs: { ports: { script: [{ kind: 'text', value: text }] } },
      }),
    ).rejects.toThrow(text ? '5,000' : 'No script');
  expect(synthesize).not.toHaveBeenCalled();
});
it('validates model capabilities and discards canceled completions before storage', async () => {
  const { synthesize, assets, executor, context } = setup();
  await expect(
    executor.execute({
      ...context,
      params: { ...context.params, voice: 'unknown' },
    }),
  ).rejects.toThrow('does not support voice');
  expect(synthesize).not.toHaveBeenCalled();
  const controller = new AbortController();
  synthesize.mockImplementationOnce(async () => {
    controller.abort(new Error('Canceled'));
    return { bytes: Buffer.from('wave'), mime: 'audio/wav', durationMs: 1200 };
  });
  await expect(
    executor.execute({ ...context, signal: controller.signal }),
  ).rejects.toThrow('Canceled');
  expect(assets.store).not.toHaveBeenCalled();
});
