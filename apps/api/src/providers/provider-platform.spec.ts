import { ProviderRegistry } from './provider-registry';
import { ModelsService } from './models.service';
import { ProviderError, withProviderRetries } from './provider-error';
import { nodeRegistry, executionHash } from '@hiveflow/shared';
it('lists configured real providers and unavailable adapters, and requires explicit model selection before hashing', async () => {
  const registry = new ProviderRegistry();
  for (const kind of ['image', 'llm', 'tts', 'video'] as const)
    registry.register(kind, kind === 'video' ? 'seedance' : 'openrouter', {
      id: 'openrouter',
    });
  const service = new ModelsService(registry);
  expect(
    service
      .list()
      .filter(
        (model) => model.provider === 'openrouter' && model.status === 'active',
      )
      .every((model) => model.available),
  ).toBe(true);
  expect(
    service.list().find((model) => model.id === 'kling-3-0'),
  ).toMatchObject({
    available: false,
    unavailableReason: expect.stringContaining('API key'),
  });
  expect(
    service.list().some((model) => /^(mock|custom)/.test(model.provider)),
  ).toBe(false);
  expect(
    new ModelsService(new ProviderRegistry())
      .list()
      .some((model) => model.available),
  ).toBe(false);
  const node = {
    id: crypto.randomUUID(),
    type: nodeRegistry.image_generator.type,
    position: { x: 0, y: 0 },
    params: {
      ...nodeRegistry.image_generator.defaultParams,
      model: 'bytedance-seed/seedream-4.5',
    },
  };
  const inputs = { ports: {} };
  const first = service.prepare(node, inputs);
  const second = service.prepare(
    {
      ...node,
      params: { ...node.params, model: 'bytedance-seed/seedream-5-0-pro' },
    },
    inputs,
  );
  for (const model of ['', 'auto'])
    expect(() =>
      service.prepare({ ...node, params: { ...node.params, model } }, inputs),
    ).toThrow('Choose a model');
  expect(second.model).toBe('bytedance-seed/seedream-5-0-pro');
  expect(await executionHash(node.type, first.params, inputs)).not.toBe(
    await executionHash(node.type, second.params, inputs),
  );
  expect(() =>
    service.prepare(
      { ...node, params: { ...node.params, model: 'missing' } },
      inputs,
    ),
  ).toThrow('choose another model');
});
it('retries only pre-acceptance transient failures and honors retry-after', async () => {
  const wait = jest.fn().mockResolvedValue(undefined);
  const action = jest
    .fn()
    .mockRejectedValueOnce(
      new ProviderError('rate_limited', true, 'Busy', 2000),
    )
    .mockResolvedValue('ok');
  const signal = new AbortController().signal;
  expect(
    await withProviderRetries(action, { maxRetries: 2, signal, wait }),
  ).toBe('ok');
  expect(wait.mock.calls[0][0]).toBeGreaterThanOrEqual(2000);
  const denied = jest
    .fn()
    .mockRejectedValue(new ProviderError('content_blocked', false, 'Blocked'));
  await expect(
    withProviderRetries(denied, { maxRetries: 2, signal, wait }),
  ).rejects.toThrow('Blocked');
  expect(denied).toHaveBeenCalledTimes(1);
  const accepted = jest
    .fn()
    .mockRejectedValue(
      new ProviderError('unavailable', true, 'Busy', undefined, 'task-id'),
    );
  await expect(
    withProviderRetries(accepted, { maxRetries: 2, signal, wait }),
  ).rejects.toThrow('Busy');
  expect(accepted).toHaveBeenCalledTimes(1);
  const checkpointed = jest
    .fn()
    .mockRejectedValue(
      new ProviderError('unavailable', true, 'Already submitted'),
    );
  await expect(
    withProviderRetries(checkpointed, {
      maxRetries: 2,
      signal,
      wait,
      accepted: () => true,
    }),
  ).rejects.toThrow('Already submitted');
  expect(checkpointed).toHaveBeenCalledTimes(1);
});
