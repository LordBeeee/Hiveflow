import { ConfigService } from '@nestjs/config';
import { ProviderRegistry } from './provider-registry';
import { ModelsService } from './models.service';
import { ProviderError, withProviderRetries } from './provider-error';
import { nodeRegistry, executionHash } from '@hiveflow/shared';
it('lists configured mocks and unavailable adapters, and resolves a changed default before hashing', async () => {
  const registry = new ProviderRegistry();
  for (const kind of ['image', 'llm', 'tts', 'video'] as const)
    registry.register(kind, 'mock', { id: 'mock' });
  const config = new ConfigService({ DEFAULT_IMAGE_MODEL: 'mock-image' });
  const service = new ModelsService(config, registry);
  expect(
    service
      .list()
      .filter(
        (model) => model.id.startsWith('mock-') && model.status === 'active',
      )
      .every((model) => model.available),
  ).toBe(true);
  expect(
    service.list().find((model) => model.id === 'image-studio'),
  ).toMatchObject({
    available: false,
    unavailableReason: expect.stringContaining('API key'),
  });
  const node = {
    id: crypto.randomUUID(),
    type: nodeRegistry.image_generator.type,
    position: { x: 0, y: 0 },
    params: { ...nodeRegistry.image_generator.defaultParams },
  };
  const inputs = { ports: {} };
  const first = service.prepare(node, inputs);
  config.set('DEFAULT_IMAGE_MODEL', 'mock-image-compact');
  const second = service.prepare(node, inputs);
  expect(second.model).toBe('mock-image-compact');
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
