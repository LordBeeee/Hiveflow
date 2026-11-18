import type { CostsService } from './costs.service';
import { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { SpacesService } from '../spaces/spaces.service';
import type { NodeRunQueue } from '../queue/node-run.queue';
import type { ExecutorRegistry } from '../executors/executor-registry';
import type { ModelsService } from '../providers/models.service';
import { RunsService } from './runs.service';
import type { NodeRunEntity } from './node-run.entity';
import { RunEvents } from './run-events';
import type { InputResolver } from '../executors/input-resolver';
import type { RunCache } from './run-cache';

function setup(claimed = true, running = 0) {
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
    inputs: null,
    output: null,
    error: null,
    provider: null,
    model: null,
    providerKind: null,
    providerTaskId: null,
    cacheHit: false,
    prepared: true,
    level: null,
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
    findOneBy: async () => ({ ...row, status: 'queued' }),
    findOne: jest
      .fn()
      .mockImplementation(async () => ({ ...row, status: 'queued' })),
    query: jest.fn().mockResolvedValue([]),
    manager: {
      transaction: async (action: (manager: unknown) => Promise<unknown>) =>
        action({
          query: async (sql: string, ...args: unknown[]) =>
            sql.startsWith('SELECT pg_advisory')
              ? []
              : repo.query(sql, ...args),
          count: async () => running,
          getRepository: () => repo,
        }),
    },
  };
  const execute = jest.fn().mockResolvedValue({ output: { text: 'snapshot' } });
  const events = new RunEvents();
  const emit = jest.spyOn(events, 'emit');
  const spaces = {
    get: jest.fn().mockResolvedValue({
      graph: {
        nodes: [{ id: row.nodeId, type: 'text', params: row.params }],
        edges: [],
      },
    }),
  };
  const queue = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const resolver = { resolve: jest.fn().mockResolvedValue({ ports: {} }) };
  const cache = { find: jest.fn().mockResolvedValue(null) };
  const service = new RunsService(
    repo as unknown as Repository<NodeRunEntity>,
    spaces as unknown as SpacesService,
    queue as unknown as NodeRunQueue,
    events,
    new ConfigService({
      PROVIDER_TIMEOUT_MS: 5,
      SPACE_RUN_CONCURRENCY: 3,
      RUN_RECOVERY_TIMEOUT_MS: 930000,
    }),
    { get: () => ({ type: 'text', execute }) } as unknown as ExecutorRegistry,
    resolver as unknown as InputResolver,
    cache as unknown as RunCache,
    {
      prepare: (node: { params: Record<string, unknown> }) => ({
        params: node.params,
        model: null,
        provider: null,
      }),
    } as unknown as ModelsService,
    {
      price: () => 0,
      lockUser: jest.fn().mockResolvedValue(undefined),
      reserve: jest.fn().mockResolvedValue(undefined),
      enforce: jest.fn(),
      lockRunUser: jest.fn().mockResolvedValue(undefined),
      adjust: jest.fn().mockResolvedValue(undefined),
      refund: jest.fn().mockResolvedValue(undefined),
      reconcileRefunds: jest.fn().mockResolvedValue(undefined),
    } as unknown as CostsService,
  );
  return { service, execute, changes, builder, row, emit, repo, queue, cache };
}
it('returns an existing identical active run instead of executing a second provider job', async () => {
  const { service, row, queue, execute, repo } = setup();
  const result = await service.start({ id: 'user' }, row.spaceId, row.nodeId);
  expect(result.runId).toBe(row.id);
  expect(repo.findOne).toHaveBeenCalledTimes(1);
  expect(queue.enqueue).toHaveBeenCalledWith(row.id, row.providerKind);
  expect(execute).not.toHaveBeenCalled();
});
it('checkpoints accepted task IDs and emits progress only when it changes', async () => {
  const { service, execute, repo, row, emit } = setup();
  row.nodeType = 'video_generator';
  row.providerKind = 'video';
  repo.query.mockResolvedValue([{ status: 'running' }]);
  execute.mockImplementationOnce(async (context) => {
    await context.checkpointTask('accepted');
    context.reportProgress(25);
    context.reportProgress(25);
    context.reportProgress(40);
    return { output: { video: [] } };
  });
  await service.process(row.id);
  const checkpoints = repo.query.mock.calls.filter(([sql]) =>
    String(sql).includes('provider_task_id'),
  );
  expect(checkpoints).toHaveLength(1);
  expect(
    emit.mock.calls
      .filter(([run]) => run.progress !== undefined)
      .map(([run]) => run.progress),
  ).toEqual([25, 40]);
});
it('requeues video on startup for polling recovery and excludes accepted tasks from worker_lost', async () => {
  const { service, repo, builder, queue, row } = setup();
  Object.assign(repo, { find: jest.fn().mockResolvedValue([]) });
  Object.assign(builder, { returning: jest.fn().mockReturnThis() });
  builder.execute.mockResolvedValue({ affected: 0, ...{ raw: [] } });
  repo.query.mockResolvedValue([{ id: row.id, provider_kind: 'video' }]);
  await service.reconcile(true);
  expect(queue.enqueue).toHaveBeenCalledWith(row.id, 'video', true);
  expect(
    builder.where.mock.calls.some(([sql]) =>
      String(sql).includes('provider_task_id IS NULL'),
    ),
  ).toBe(true);
});
it('publishes a cache-hit run without queueing provider execution', async () => {
  const { service, row, queue, cache, repo, emit } = setup();
  Object.assign(row, {
    status: 'succeeded',
    cacheHit: true,
    output: { text: 'cached' },
  });
  cache.find.mockResolvedValue(row);
  repo.query.mockResolvedValue([{ id: row.id }]);
  await service.start({ id: 'user' }, row.spaceId, row.nodeId);
  expect(queue.enqueue).not.toHaveBeenCalled();
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({ cacheHit: true, output: { text: 'cached' } }),
  );
});
it('bypasses succeeded cache entries for force requests', async () => {
  const { service, row, queue, cache, repo } = setup();
  row.status = 'queued';
  repo.query.mockResolvedValue([{ id: row.id }]);
  await service.start({ id: 'user' }, row.spaceId, row.nodeId, true);
  expect(cache.find).not.toHaveBeenCalled();
  expect(queue.enqueue).toHaveBeenCalledWith(row.id, row.providerKind);
});
it('does not execute a duplicate job that cannot claim the queued row', async () => {
  const { service, execute, changes } = setup(false);
  await service.process(crypto.randomUUID());
  expect(execute).not.toHaveBeenCalled();
  expect(changes).toHaveLength(1);
});
it('leaves work queued when the per-Space running limit has been reached', async () => {
  const { service, execute, changes } = setup(true, 3);
  await service.process(crypto.randomUUID());
  expect(execute).not.toHaveBeenCalled();
  expect(changes).toHaveLength(0);
});
it('does not claim a job when its provider quota is full', async () => {
  const { service, row, execute, changes } = setup(true, 2);
  row.provider = 'mock';
  row.providerKind = 'image';
  await service.process(row.id);
  expect(execute).not.toHaveBeenCalled();
  expect(changes).toHaveLength(0);
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
it('records an input resolution failure before invoking an executor', async () => {
  const { service, execute, row, changes } = setup();
  row.inputs = { ports: {}, error: "Upstream node 'Text #1' has no output" };
  await service.process(row.id);
  expect(execute).not.toHaveBeenCalled();
  expect(changes[1]).toMatchObject({
    status: 'failed',
    error: row.inputs.error,
  });
});
