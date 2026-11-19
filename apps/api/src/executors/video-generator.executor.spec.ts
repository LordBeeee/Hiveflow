import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { nodeRegistry } from '@hiveflow/shared';
import { VideoGeneratorExecutor } from './video-generator.executor';
import { ProviderRegistry } from '../providers/provider-registry';
import { ProviderError } from '../providers/provider-error';
import type { AssetsService } from '../assets/assets.service';
function setup(model = 'mock-video') {
  const provider = {
    id: 'mock-video',
    submit: jest.fn().mockResolvedValue({ taskId: 'accepted' }),
    poll: jest.fn().mockResolvedValue({
      status: 'succeeded',
      progress: 100,
      result: {
        stream: Readable.from(['mp4']),
        mime: 'video/mp4',
        width: 320,
        height: 180,
        durationMs: 2000,
      },
    }),
    cancel: jest.fn().mockResolvedValue(undefined),
  };
  const registry = new ProviderRegistry();
  registry.register('video', 'mock-video', provider);
  const assets = {
    providerReference: jest.fn().mockResolvedValue({
      url: 'https://private.example/signed',
      mime: 'image/png',
      read: async () => Buffer.from('reference'),
    }),
    store: jest.fn().mockResolvedValue({
      id: crypto.randomUUID(),
      url: '/api/assets/video',
      sha256: 'hash',
      width: 320,
      height: 180,
      durationMs: 2000,
    }),
  };
  const executor = new VideoGeneratorExecutor(
    assets as unknown as AssetsService,
    registry,
    new ConfigService({ PROVIDER_MAX_RETRIES: 2 }),
  );
  const context = {
    runId: crypto.randomUUID(),
    spaceId: crypto.randomUUID(),
    params: {
      ...nodeRegistry.video_generator.defaultParams,
      model,
      prompt: 'Scene',
    },
    signal: new AbortController().signal,
    checkpointTask: jest.fn().mockResolvedValue(undefined),
    reportProgress: jest.fn(),
  };
  return { provider, assets, executor, context };
}
it('checkpoints acceptance before polling and streams the result with progress', async () => {
  const { provider, assets, executor, context } = setup();
  provider.poll.mockImplementationOnce(async () => {
    expect(context.checkpointTask).toHaveBeenCalledWith('accepted');
    return {
      status: 'succeeded',
      progress: 100,
      result: {
        stream: Readable.from(['mp4']),
        mime: 'video/mp4',
        width: 320,
        height: 180,
        durationMs: 2000,
      },
    };
  });
  const result = await executor.execute({
    ...context,
    inputs: {
      ports: {
        prompt: [{ kind: 'text', value: 'Connected' }],
        start_image: [
          {
            kind: 'asset',
            assetId: 'image',
            sha256: 'hash',
            mediaKind: 'image',
          },
        ],
      },
    },
  });
  expect(provider.submit.mock.calls[0][0]).toMatchObject({
    prompt: 'Connected',
    requestId: context.runId,
    startImage: {
      url: 'https://private.example/signed',
      mime: 'image/png',
      read: expect.any(Function),
    },
  });
  expect(assets.store.mock.calls[0][1]).toMatchObject({
    kind: 'video',
    stream: expect.any(Readable),
    mime: 'video/mp4',
  });
  expect(result.output.video).toHaveLength(1);
  expect(context.reportProgress).toHaveBeenCalledWith(100);
});
it('resumes accepted tasks by polling without any submit or reference signing', async () => {
  const { provider, assets, executor, context } = setup();
  await executor.execute({ ...context, providerTaskId: 'existing' });
  expect(provider.submit).not.toHaveBeenCalled();
  expect(context.checkpointTask).not.toHaveBeenCalled();
  expect(assets.providerReference).not.toHaveBeenCalled();
  expect(provider.poll).toHaveBeenCalledWith('existing', context.signal);
});
it('rejects unsupported capabilities before calling the provider', async () => {
  const { provider, executor, context } = setup('mock-video-basic');
  await expect(
    executor.execute({
      ...context,
      params: { ...context.params, generateAudio: true },
    }),
  ).rejects.toThrow('generated audio');
  await expect(
    executor.execute({
      ...context,
      params: { ...context.params, duration: 10 },
    }),
  ).rejects.toThrow('duration');
  await expect(
    executor.execute({
      ...context,
      inputs: {
        ports: {
          end_image: [
            {
              kind: 'asset',
              assetId: 'image',
              sha256: 'hash',
              mediaKind: 'image',
            },
          ],
        },
      },
    }),
  ).rejects.toThrow('end image');
  expect(provider.submit).not.toHaveBeenCalled();
});
it('does not resubmit after a poll failure and cancels accepted tasks on abort', async () => {
  const { provider, executor, context } = setup();
  provider.poll.mockRejectedValueOnce(
    new ProviderError('invalid_request', false, 'Task rejected'),
  );
  await expect(executor.execute(context)).rejects.toThrow('Task rejected');
  expect(provider.submit).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  provider.poll.mockImplementationOnce(async () => {
    controller.abort(new Error('Canceled'));
    throw controller.signal.reason;
  });
  await expect(
    executor.execute({
      ...context,
      providerTaskId: 'existing',
      signal: controller.signal,
    }),
  ).rejects.toThrow('Canceled');
  expect(provider.cancel).toHaveBeenCalledWith('existing');
  expect(provider.submit).toHaveBeenCalledTimes(1);
});
it('retries transient polling without submitting an accepted task again', async () => {
  jest.useFakeTimers();
  try {
    const { provider, executor, context } = setup();
    provider.poll.mockRejectedValueOnce(
      new ProviderError('unavailable', true, 'Still processing'),
    );
    const pending = executor.execute({
      ...context,
      providerTaskId: 'existing',
    });
    await jest.advanceTimersByTimeAsync(2000);
    await pending;
    expect(provider.poll).toHaveBeenCalledTimes(2);
    expect(provider.submit).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
