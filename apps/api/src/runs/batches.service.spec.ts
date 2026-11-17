import type { Repository, FindOperator } from 'typeorm';
import { emptyGraph, topoSort } from '@hiveflow/shared';
import type { SpacesService } from '../spaces/spaces.service';
import { BatchesService, blockedDescendants } from './batches.service';
import type { BatchEntity } from './batch.entity';
import type { NodeRunEntity } from './node-run.entity';
import type { RunsService } from './runs.service';
import { RunEvents } from './run-events';
function setup() {
  const graph = emptyGraph();
  graph.nodes = ['bad', 'good', 'child', 'independent', 'grandchild'].map(
    (id) => ({
      id,
      type: 'image_generator',
      position: { x: 0, y: 0 },
      params: {},
    }),
  );
  graph.edges = [
    ['bad', 'child'],
    ['good', 'independent'],
    ['child', 'grandchild'],
  ].map(([source, target], index) => ({
    id: String(index),
    source,
    target,
    sourceHandle: 'image',
    targetHandle: 'references',
  }));
  const levels = topoSort(graph);
  const batch = {
    id: 'batch',
    spaceId: 'space',
    graph,
    levels,
    currentLevel: 0,
    force: false,
    status: 'running',
    createdAt: new Date(),
    finishedAt: null,
  } as BatchEntity;
  const rows = graph.nodes.map(
    (node) =>
      ({
        id: node.id,
        nodeId: node.id,
        batchId: 'batch',
        level: levels.findIndex((ids) => ids.includes(node.id)),
        status: 'queued',
        prepared: false,
        output: null,
      }) as NodeRunEntity,
  );
  const batches = {
    findOneByOrFail: async () => ({ ...batch }),
    update: async (where: { status: string }, change: Partial<BatchEntity>) => {
      if (where.status === batch.status) Object.assign(batch, change);
    },
  };
  const runs = {
    find: async () => rows.map((row) => ({ ...row })),
    count: async ({
      where,
    }: {
      where: { level: number; status: FindOperator<string[]> };
    }) =>
      rows.filter(
        (row) =>
          row.level === where.level && where.status.value.includes(row.status),
      ).length,
    update: async (
      where: { id: string; status: string },
      change: Partial<NodeRunEntity>,
    ) => {
      const row = rows.find(
        (row) => row.id === where.id && row.status === where.status,
      );
      if (row) Object.assign(row, change);
    },
  };
  const prepare = jest.fn(async (run: NodeRunEntity) => {
    Object.assign(
      rows.find((row) => row.id === run.id)!,
      { prepared: true },
    );
  });
  const execution = { prepareBatchRun: prepare, emit: jest.fn() };
  const service = new BatchesService(
    batches as unknown as Repository<BatchEntity>,
    runs as unknown as Repository<NodeRunEntity>,
    {} as SpacesService,
    execution as unknown as RunsService,
    new RunEvents(),
  );
  return { service, rows, batch, graph, prepare };
}
it('enqueues a parallel level without starting later levels before its barrier', async () => {
  const { service, rows, batch, prepare } = setup();
  await service.advance('batch');
  expect(prepare.mock.calls.map(([row]) => row.nodeId)).toEqual([
    'bad',
    'good',
  ]);
  expect(batch.currentLevel).toBe(0);
  expect(rows.find((row) => row.id === 'child')!.prepared).toBe(false);
});
it('skips transitive failed dependencies while continuing independent branches', async () => {
  const { service, rows, batch, prepare } = setup();
  Object.assign(rows[0], { status: 'failed', prepared: true });
  Object.assign(rows[1], { status: 'succeeded', prepared: true });
  prepare.mockImplementation(async (run: NodeRunEntity) => {
    Object.assign(
      rows.find((row) => row.id === run.id)!,
      { prepared: true, status: 'succeeded' },
    );
  });
  await service.advance('batch');
  expect(rows.find((row) => row.id === 'child')!.status).toBe('skipped');
  expect(rows.find((row) => row.id === 'grandchild')!.status).toBe('skipped');
  expect(rows.find((row) => row.id === 'independent')!.status).toBe(
    'succeeded',
  );
  expect(batch.status).toBe('failed');
});
it('does not advance canceled batches or include independent nodes in failure propagation', async () => {
  const { service, batch, prepare, graph } = setup();
  batch.status = 'canceled';
  await service.advance('batch');
  expect(prepare).not.toHaveBeenCalled();
  expect([...blockedDescendants(graph, ['bad'])].sort()).toEqual([
    'child',
    'grandchild',
  ]);
});
