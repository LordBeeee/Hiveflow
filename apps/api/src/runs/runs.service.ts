import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  executionHash,
  nodeRegistry,
  type NodeRun,
  type SpaceGraph,
  type GraphNode,
  type ResolvedInputs,
} from '@hiveflow/shared';
import type { User } from '../auth/current-user';
import { SpacesService } from '../spaces/spaces.service';
import { NodeRunQueue } from '../queue/node-run.queue';
import { ExecutorRegistry } from '../executors/executor-registry';
import { NodeRunEntity } from './node-run.entity';
import { RunEvents } from './run-events';
import { InputResolver } from '../executors/input-resolver';
import { RunCache } from './run-cache';
import { ModelsService } from '../providers/models.service';
import { ProviderError } from '../providers/provider-error';

export function runDto(run: NodeRunEntity): NodeRun {
  return {
    runId: run.id,
    spaceId: run.spaceId,
    nodeId: run.nodeId,
    nodeType: run.nodeType,
    sequence: String(run.sequence),
    batchId: run.batchId,
    status: run.status,
    inputHash: run.inputHash,
    output: run.output,
    error: run.error,
    provider: run.provider,
    model: run.model ?? null,
    cacheHit: run.cacheHit,
    waiting: !run.prepared,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);
  private readonly active = new Map<string, AbortController>();
  constructor(
    @InjectRepository(NodeRunEntity)
    private readonly runs: Repository<NodeRunEntity>,
    private readonly spaces: SpacesService,
    private readonly queue: NodeRunQueue,
    private readonly events: RunEvents,
    private readonly config: ConfigService,
    private readonly executors: ExecutorRegistry,
    private readonly inputResolver: InputResolver,
    private readonly cache: RunCache,
    private readonly models: ModelsService,
  ) {}
  private prepare(node: GraphNode, inputs: ResolvedInputs) {
    try {
      return { ...this.models.prepare(node, inputs), inputs };
    } catch (error) {
      return {
        params: node.params,
        model: null,
        provider: null,
        inputs: {
          ...inputs,
          error:
            error instanceof Error
              ? error.message
              : 'Model is unavailable. Please choose another model.',
        },
      };
    }
  }
  async start(user: User, spaceId: string, nodeId: string, force = false) {
    const space = await this.spaces.get(user, spaceId);
    const node = space.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new NotFoundException('Node not found in the saved space');
    const parsed = nodeRegistry[node.type].paramsSchema.safeParse(node.params);
    if (!parsed.success)
      throw new BadRequestException(
        'Save valid node parameters before running.',
      );
    const prepared = this.prepare(
      { ...node, params: parsed.data },
      await this.inputResolver.resolve(spaceId, space.graph, node),
    );
    const { inputs } = prepared;
    const hash = await executionHash(node.type, prepared.params, inputs);
    const cached =
      !force && !inputs.error
        ? await this.cache.find(spaceId, nodeId, hash)
        : null;
    let run: NodeRunEntity | null = null;
    for (let attempt = 0; attempt < 3 && !run; attempt++) {
      const rows: { id: string }[] = await this.runs.query(
        `INSERT INTO node_runs (space_id, node_id, node_type, status, input_hash, params, inputs, output, provider, cache_hit, finished_at, model, provider_kind)
        SELECT $1, $2, $3, $7, $4, $5::jsonb, $6::jsonb, $8::jsonb, $9, $10, CASE WHEN $10 THEN now() ELSE NULL END, $11, $12
        WHERE NOT EXISTS (SELECT 1 FROM node_runs WHERE space_id=$1 AND node_id=$2 AND input_hash=$4 AND status IN ('queued','running'))
        ON CONFLICT (space_id, node_id, input_hash) WHERE status IN ('queued','running') DO NOTHING RETURNING id`,
        [
          spaceId,
          nodeId,
          node.type,
          hash,
          JSON.stringify(prepared.params),
          JSON.stringify(inputs),
          cached ? 'succeeded' : 'queued',
          JSON.stringify(cached?.output ?? null),
          cached?.provider ?? prepared.provider,
          !!cached,
          prepared.model,
          prepared.model
            ? (nodeRegistry[node.type] as import('@hiveflow/shared').NodeDef)
                .modelKind
            : null,
        ],
      );
      run = rows.length
        ? await this.runs.findOneByOrFail({ id: rows[0].id })
        : await this.runs.findOne({
            where: {
              spaceId,
              nodeId,
              inputHash: hash,
              status: In(['queued', 'running']),
            },
            order: { sequence: 'DESC' },
          });
    }
    if (!run)
      throw new BadRequestException('Could not queue this node. Please retry.');
    this.events.emit(runDto(run));
    // PostgreSQL is the source of truth. Reconciliation repairs this enqueue gap on Redis failure.
    if (run.status === 'queued')
      await this.queue
        .enqueue(run.id)
        .catch(() =>
          this.logger.warn('Enqueue deferred; reconciliation will retry'),
        );
    return { runId: run.id };
  }
  async history(
    user: User,
    spaceId: string,
    nodeId?: string,
    succeeded = false,
  ) {
    await this.spaces.get(user, spaceId);
    const query = this.runs
      .createQueryBuilder('run')
      .where('run.space_id = :spaceId', { spaceId });
    if (succeeded) query.andWhere("run.status = 'succeeded'");
    if (nodeId)
      query
        .andWhere('run.node_id = :nodeId', { nodeId })
        .orderBy('run.sequence', 'DESC')
        .take(50);
    else
      query
        .distinctOn(['run.node_id'])
        .orderBy('run.node_id')
        .addOrderBy('run.sequence', 'DESC');
    return (await query.getMany()).map(runDto);
  }
  async process(id: string) {
    const candidate = await this.runs.findOneBy({ id });
    if (!candidate || candidate.status !== 'queued' || !candidate.prepared)
      return;
    const claimed = await this.runs.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        candidate.spaceId,
      ]);
      const running = await manager.count(NodeRunEntity, {
        where: { spaceId: candidate.spaceId, status: 'running' },
      });
      if (running >= this.config.getOrThrow<number>('SPACE_RUN_CONCURRENCY'))
        return { affected: 0 };
      if (candidate.provider) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `provider:${candidate.provider}`,
        ]);
        const used = await manager.count(NodeRunEntity, {
          where: { provider: candidate.provider, status: 'running' },
        });
        const key = `PROVIDER_CONCURRENCY_${candidate.provider.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
        if (used >= (this.config.get<number>(key) ?? 2)) return { affected: 0 };
      }
      if (candidate.providerKind) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `kind:${candidate.providerKind}`,
        ]);
        const used = await manager.count(NodeRunEntity, {
          where: { providerKind: candidate.providerKind, status: 'running' },
        });
        if (
          used >=
          (this.config.get<number>(
            `KIND_CONCURRENCY_${candidate.providerKind.toUpperCase()}`,
          ) ?? 6)
        )
          return { affected: 0 };
      }
      return manager
        .getRepository(NodeRunEntity)
        .createQueryBuilder()
        .update(NodeRunEntity)
        .set({ status: 'running', startedAt: () => 'CURRENT_TIMESTAMP' })
        .where('id = :id AND status = :status AND prepared = true', {
          id,
          status: 'queued',
        })
        .execute();
    });
    if (!claimed.affected) return;
    const run = await this.runs.findOneByOrFail({ id });
    if (run.status !== 'running') return;
    this.events.emit(runDto(run));
    const controller = new AbortController();
    this.active.set(id, controller);
    let abortListener!: () => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abortListener, {
        once: true,
      });
    });
    const timeout = setTimeout(
      () =>
        controller.abort(
          new ProviderError(
            'timeout',
            false,
            'provider_timeout: generation took too long. Please retry.',
          ),
        ),
      this.config.getOrThrow<number>('PROVIDER_TIMEOUT_MS'),
    );
    try {
      if (run.inputs?.error) throw new Error(run.inputs.error);
      const executor = this.executors.get(run.nodeType);
      if (!executor) throw new Error('Unsupported node type');
      const result = await Promise.race([
        executor.execute({
          spaceId: run.spaceId,
          params: run.params,
          inputs: run.inputs ?? undefined,
          signal: controller.signal,
        }),
        aborted,
      ]);
      const updated = await this.runs
        .createQueryBuilder()
        .update(NodeRunEntity)
        .set({
          status: 'succeeded',
          output: () => 'CAST(:output AS jsonb)',
          provider: result.provider ?? null,
          finishedAt: () => 'CURRENT_TIMESTAMP',
        })
        .setParameter('output', JSON.stringify(result.output))
        .where('id = :id AND status = :status', { id, status: 'running' })
        .execute();
      if (updated.affected) await this.emit(id);
    } catch (error) {
      await this.runs
        .createQueryBuilder()
        .update(NodeRunEntity)
        .set({
          status: 'failed',
          error:
            error instanceof ProviderError
              ? error.userMessage.slice(0, 1000)
              : error instanceof Error
                ? error.message.slice(0, 1000)
                : 'Execution failed. Please retry.',
          finishedAt: () => 'CURRENT_TIMESTAMP',
        })
        .where('id = :id AND status = :status', { id, status: 'running' })
        .execute();
      await this.emit(id);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abortListener);
      this.active.delete(id);
    }
  }
  async emit(id: string) {
    const run = await this.runs.findOneBy({ id });
    if (run) this.events.emit(runDto(run));
  }
  async cancel(user: User, id: string) {
    const run = await this.runs.findOneBy({ id });
    if (!run) throw new NotFoundException('Run not found');
    await this.spaces.get(user, run.spaceId);
    await this.cancelIds([id]);
    return runDto(await this.runs.findOneByOrFail({ id }));
  }
  async cancelIds(ids: string[]) {
    if (!ids.length) return;
    const rows: { id: string }[] = await this.runs.query(
      "UPDATE node_runs SET status='canceled', finished_at=now(), error=NULL WHERE id=ANY($1::uuid[]) AND status IN ('queued','running') RETURNING id",
      [ids],
    );
    for (const row of rows)
      this.active.get(row.id)?.abort(new Error('Run canceled'));
    for (const row of rows) {
      await this.queue.remove(row.id).catch(() => {});
      await this.emit(row.id);
    }
  }
  async prepareBatchRun(
    run: NodeRunEntity,
    graph: SpaceGraph,
    outputs: Map<string, NodeRunEntity['output']>,
    force: boolean,
  ) {
    const node = graph.nodes.find((node) => node.id === run.nodeId)!;
    const prepared = this.prepare(
      node,
      await this.inputResolver.resolve(run.spaceId, graph, node, outputs),
    );
    const { inputs } = prepared;
    const hash = await executionHash(node.type, prepared.params, inputs);
    const cached =
      !force && !inputs.error
        ? await this.cache.find(run.spaceId, run.nodeId, hash)
        : null;
    try {
      const changed = await this.runs
        .createQueryBuilder()
        .update(NodeRunEntity)
        .set({
          inputs: () => 'CAST(:inputs AS jsonb)',
          params: () => 'CAST(:params AS jsonb)',
          model: prepared.model,
          provider: prepared.provider,
          providerKind: prepared.model
            ? (nodeRegistry[node.type] as import('@hiveflow/shared').NodeDef)
                .modelKind
            : null,
          inputHash: hash,
          prepared: true,
          ...(cached
            ? {
                status: 'succeeded' as const,
                output: () => 'CAST(:output AS jsonb)',
                provider: cached.provider,
                cacheHit: true,
                finishedAt: new Date(),
              }
            : {}),
        })
        .setParameters({
          output: JSON.stringify(cached?.output ?? null),
          inputs: JSON.stringify(inputs),
          params: JSON.stringify(prepared.params),
        })
        .where("id=:id AND status='queued' AND prepared=false", { id: run.id })
        .execute();
      if (changed.affected) {
        await this.emit(run.id);
        if (!cached) await this.queue.enqueue(run.id).catch(() => {});
      }
    } catch (error) {
      // An identical active single-node run may own the unique hash; retry preparation next tick.
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      ))
        throw error;
    }
  }
  async reconcile() {
    const timeout = this.config.getOrThrow<number>('RUN_RECOVERY_TIMEOUT_MS');
    const lost = await this.runs
      .createQueryBuilder()
      .update(NodeRunEntity)
      .set({
        status: 'failed',
        error:
          'worker_lost: the worker stopped before completing this run. Please retry.',
        finishedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where("status = 'running' AND started_at < :before", {
        before: new Date(Date.now() - timeout),
      })
      .returning('id')
      .execute();
    for (const row of lost.raw as { id: string }[]) await this.emit(row.id);
    const queued = await this.runs.find({
      where: { status: 'queued', prepared: true },
      order: { sequence: 'ASC' },
      take: 500,
    });
    for (const run of queued) {
      if (
        !run.model &&
        (nodeRegistry[run.nodeType] as import('@hiveflow/shared').NodeDef)
          .modelKind
      ) {
        const prepared = this.prepare(
          {
            id: run.nodeId,
            type: run.nodeType,
            params: run.params,
            position: { x: 0, y: 0 },
          },
          run.inputs ?? { ports: {} },
        );
        await this.runs.query(
          "UPDATE node_runs SET params=$2::jsonb, inputs=$3::jsonb, model=$4, provider=$5, provider_kind=$6 WHERE id=$1 AND status='queued'",
          [
            run.id,
            JSON.stringify(prepared.params),
            JSON.stringify(prepared.inputs),
            prepared.model,
            prepared.provider,
            prepared.model
              ? (
                  nodeRegistry[
                    run.nodeType
                  ] as import('@hiveflow/shared').NodeDef
                ).modelKind
              : null,
          ],
        );
      }
      await this.queue.enqueue(run.id).catch(() => {});
    }
  }
}
