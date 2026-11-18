import { CostsService } from './costs.service';
import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  topoSort,
  costGraphHash,
  type Batch,
  type SpaceGraph,
} from '@hiveflow/shared';
import type { User } from '../auth/current-user';
import { SpacesService } from '../spaces/spaces.service';
import { BatchEntity } from './batch.entity';
import { NodeRunEntity } from './node-run.entity';
import { RunsService } from './runs.service';
import { RunEvents } from './run-events';

export function blockedDescendants(graph: SpaceGraph, failed: string[]) {
  const blocked = new Set<string>();
  const pending = [...failed];
  while (pending.length) {
    const id = pending.pop()!;
    for (const edge of graph.edges)
      if (edge.source === id && !blocked.has(edge.target)) {
        blocked.add(edge.target);
        pending.push(edge.target);
      }
  }
  return blocked;
}
@Injectable()
export class BatchesService {
  private readonly advancing = new Set<string>();
  constructor(
    @InjectRepository(BatchEntity)
    private readonly batches: Repository<BatchEntity>,
    @InjectRepository(NodeRunEntity)
    private readonly runs: Repository<NodeRunEntity>,
    private readonly spaces: SpacesService,
    private readonly execution: RunsService,
    private readonly events: RunEvents,
    private readonly costs: CostsService,
  ) {}
  async start(
    user: User,
    spaceId: string,
    force = false,
    approved?: {
      version?: number;
      graphHash?: string;
      maxUnits?: number;
      maxProviderNodes?: number;
    },
  ) {
    const space = await this.spaces.get(user, spaceId);
    const levels = topoSort(space.graph);
    const id = await this.batches.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        spaceId,
      ]);
      const existing = await manager.findOne(BatchEntity, {
        where: { spaceId, status: 'running' },
      });
      if (existing) return existing.id;
      if (
        approved?.graphHash
          ? approved.graphHash !== (await costGraphHash(space.graph))
          : approved?.version !== undefined &&
            approved.version !== space.version
      )
        throw new ConflictException(
          'The graph changed. Review a fresh cost estimate before running.',
        );
      await this.costs.lockUser(manager, user.id);
      const plan = await this.costs.plan(spaceId, space.graph, force);
      this.costs.enforce(plan.estimate);
      if (
        (approved?.maxUnits !== undefined &&
          plan.estimate.units > approved.maxUnits) ||
        (approved?.maxProviderNodes !== undefined &&
          plan.estimate.providerNodes > approved.maxProviderNodes)
      )
        throw new ConflictException(
          'The estimate changed. Review it again before running.',
        );
      const batch = await manager.save(
        BatchEntity,
        manager.create(BatchEntity, {
          spaceId,
          graph: plan.graph,
          levels,
          force,
          status: 'running',
        }),
      );
      for (const [level, ids] of levels.entries()) {
        const createdRuns = await manager.save(
          NodeRunEntity,
          ids.map((nodeId) => {
            const node = plan.graph.nodes.find((node) => node.id === nodeId)!;
            return manager.create(NodeRunEntity, {
              spaceId,
              batchId: batch.id,
              nodeId,
              nodeType: node.type,
              params: node.params,
              inputHash: `pending:${batch.id}:${nodeId}`,
              prepared: false,
              level,
              status: 'queued' as const,
            });
          }),
        );
        for (const run of createdRuns)
          await this.costs.reserve(
            manager,
            user.id,
            run.id,
            plan.estimate.nodes.find((quote) => quote.nodeId === run.nodeId)
              ?.units ?? 0,
            plan.estimate.nodes.find((quote) => quote.nodeId === run.nodeId)
              ?.providerCall ?? false,
          );
      }
      return batch.id;
    });
    const created = await this.runs.find({
      where: { batchId: id },
      order: { sequence: 'ASC' },
    });
    for (const run of created) await this.execution.emit(run.id);
    await this.advance(id);
    return { batchId: id, runIds: created.map((run) => run.id) };
  }
  private async dto(batch: BatchEntity): Promise<Batch> {
    const rows = await this.runs.find({ where: { batchId: batch.id } });
    return {
      batchId: batch.id,
      spaceId: batch.spaceId,
      status: batch.status,
      total: rows.length,
      completed: rows.filter(
        (run) => !['queued', 'running'].includes(run.status),
      ).length,
      failed: rows.filter((run) => ['failed', 'skipped'].includes(run.status))
        .length,
      createdAt: batch.createdAt.toISOString(),
      finishedAt: batch.finishedAt?.toISOString() ?? null,
    };
  }
  async history(user: User, spaceId: string) {
    await this.spaces.get(user, spaceId);
    return Promise.all(
      (
        await this.batches.find({
          where: { spaceId },
          order: { createdAt: 'DESC' },
          take: 10,
        })
      ).map((batch) => this.dto(batch)),
    );
  }
  async cancel(user: User, id: string) {
    const batch = await this.batches.findOneBy({ id });
    if (!batch) throw new NotFoundException('Batch not found');
    await this.spaces.get(user, batch.spaceId);
    await this.batches.update(
      { id, status: 'running' },
      { status: 'canceled', finishedAt: new Date() },
    );
    const rows = await this.runs.find({
      where: { batchId: id, status: In(['queued', 'running']) },
    });
    await this.execution.cancelIds(rows.map((run) => run.id));
    const dto = await this.dto(await this.batches.findOneByOrFail({ id }));
    this.events.emitBatch(dto);
    return dto;
  }
  async reconcile() {
    for (const batch of await this.batches.find({
      where: { status: 'running' },
      order: { createdAt: 'ASC' },
    }))
      await this.advance(batch.id);
  }
  async advance(id: string) {
    if (this.advancing.has(id)) return;
    this.advancing.add(id);
    try {
      let batch = await this.batches.findOneByOrFail({ id });
      while (batch.status === 'running') {
        const rows = await this.runs.find({
          where: { batchId: id },
          order: { sequence: 'ASC' },
        });
        if (batch.currentLevel >= batch.levels.length) {
          const failed = rows.some((run) =>
            ['failed', 'skipped', 'canceled'].includes(run.status),
          );
          await this.batches.update(
            { id, status: 'running' },
            { status: failed ? 'failed' : 'succeeded', finishedAt: new Date() },
          );
          batch = await this.batches.findOneByOrFail({ id });
          break;
        }
        const blocked = blockedDescendants(
          batch.graph,
          rows
            .filter((run) =>
              ['failed', 'skipped', 'canceled'].includes(run.status),
            )
            .map((run) => run.nodeId),
        );
        const current = rows.filter((run) => run.level === batch.currentLevel);
        const outputs = new Map(
          rows
            .filter((run) => run.status === 'succeeded')
            .map((run) => [run.nodeId, run.output]),
        );
        for (const run of current) {
          if (run.status !== 'queued' || run.prepared) continue;
          if (blocked.has(run.nodeId)) {
            await this.runs.update(
              { id: run.id, status: 'queued' },
              {
                status: 'skipped',
                error: 'An upstream node failed or was canceled.',
                finishedAt: new Date(),
              },
            );
            await this.costs.refund(run.id);
            await this.execution.emit(run.id);
          } else
            await this.execution.prepareBatchRun(
              run,
              batch.graph,
              outputs,
              batch.force,
            );
        }
        const remaining = await this.runs.count({
          where: {
            batchId: id,
            level: batch.currentLevel,
            status: In(['queued', 'running']),
          },
        });
        if (remaining) break;
        await this.batches.update(
          { id, status: 'running' },
          { currentLevel: batch.currentLevel + 1 },
        );
        batch = await this.batches.findOneByOrFail({ id });
      }
      this.events.emitBatch(await this.dto(batch));
    } finally {
      this.advancing.delete(id);
    }
  }
}
