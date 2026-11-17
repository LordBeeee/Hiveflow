import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { SpacesService } from '../spaces/spaces.service';
import type { NodeRunQueue } from '../queue/node-run.queue';
import type { TextExecutor } from '../executors/text.executor';
import type { ImageUploadExecutor } from '../executors/image-upload.executor';
import type { ImageGeneratorExecutor } from '../executors/image-generator.executor';
import { RunsService } from './runs.service';
import type { NodeRunEntity } from './node-run.entity';
import { RunEvents } from './run-events';

function setup(claimed = true) {
  const row = {
    id: crypto.randomUUID(),
    spaceId: crypto.randomUUID(),
    nodeId: crypto.randomUUID(),
    nodeType: 'text',
    sequence: '1',
    batchId: null,
    status: 'running',
    inputHash: 'a'.repeat(64),
    params: { value: 'snapshot' },
    output: null,
    error: null,
    provider: null,
    cacheHit: false,
    createdAt: new Date(),
    startedAt: new Date(),
    finishedAt: null,
  } as NodeRunEntity;
  const changes: Partial<NodeRunEntity>[] = [];
  const builder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: claimed ? 1 : 0 }),
  };
  builder.set.mockImplementation((value: Partial<NodeRunEntity>) => {
    changes.push(value);
    return builder;
  });
  const repo = {
    createQueryBuilder: () => builder,
    findOneByOrFail: async () => row,
    findOneBy: async () => row,
  };
  const execute = jest.fn().mockResolvedValue({ output: { text: 'snapshot' } });
  const events = new RunEvents();
  const emit = jest.spyOn(events, 'emit');
  const service = new RunsService(
    repo as unknown as Repository<NodeRunEntity>,
    {} as SpacesService,
    {} as NodeRunQueue,
    events,
    new ConfigService({ PROVIDER_TIMEOUT_MS: 5 }),
    { type: 'text', execute } as unknown as TextExecutor,
    { type: 'image_upload' } as ImageUploadExecutor,
    { type: 'image_generator' } as ImageGeneratorExecutor,
  );
  return { service, execute, changes, builder, row, emit };
}
it('does not execute a duplicate job that cannot claim the queued row', async () => {
  const { service, execute, changes } = setup(false);
  await service.process(crypto.randomUUID());
  expect(execute).not.toHaveBeenCalled();
  expect(changes).toHaveLength(1);
});
it('executes the immutable run params and conditionally publishes success', async () => {
  const { service, execute, changes, builder, row } = setup();
  await service.process(row.id);
  expect(execute.mock.calls[0][0].params).toEqual({ value: 'snapshot' });
  expect(changes[1].status).toBe('succeeded');
  expect(builder.where).toHaveBeenLastCalledWith(
    'id = :id AND status = :status',
    { id: row.id, status: 'running' },
  );
});
it('aborts a hung executor and records a retryable timeout failure', async () => {
  const { service, execute, changes, row } = setup();
  execute.mockImplementation(() => new Promise(() => {}));
  await service.process(row.id);
  expect(changes[1].status).toBe('failed');
  expect(changes[1].error).toContain('provider_timeout');
  expect(execute.mock.calls[0][0].signal.aborted).toBe(true);
});
