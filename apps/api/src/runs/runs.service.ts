import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { inputHash, nodeRegistry, type NodeRun } from '@hiveflow/shared';
import type { User } from '../auth/current-user';
import { SpacesService } from '../spaces/spaces.service';
import { NodeRunQueue } from '../queue/node-run.queue';
import { TextExecutor } from '../executors/text.executor';
import { ImageUploadExecutor } from '../executors/image-upload.executor';
import { ImageGeneratorExecutor } from '../executors/image-generator.executor';
import type { NodeExecutor } from '../executors/node-executor';
import { NodeRunEntity } from './node-run.entity';
import { RunEvents } from './run-events';
import { InputResolver } from '../executors/input-resolver';

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
    cacheHit: run.cacheHit,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}
@Injectable()
export class RunsService {
  private readonly logger = new Logger(RunsService.name);
  private readonly executors: Map<string, NodeExecutor>;
  constructor(
    @InjectRepository(NodeRunEntity)
    private readonly runs: Repository<NodeRunEntity>,
    private readonly spaces: SpacesService,
    private readonly queue: NodeRunQueue,
    private readonly events: RunEvents,
    private readonly config: ConfigService,
    text: TextExecutor,
    upload: ImageUploadExecutor,
    generator: ImageGeneratorExecutor,
    private readonly inputResolver: InputResolver,
  ) {
    this.executors = new Map(
      [text, upload, generator].map((executor) => [executor.type, executor]),
    );
  }
  async start(user: User, spaceId: string, nodeId: string) {
    const space = await this.spaces.get(user, spaceId);
    const node = space.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) throw new NotFoundException('Node not found in the saved space');
    const parsed = nodeRegistry[node.type].paramsSchema.safeParse(node.params);
    if (!parsed.success)
      throw new BadRequestException(
        'Save valid node parameters before running.',
      );
    const inputs = await this.inputResolver.resolve(spaceId, space.graph, node);
    const hash = await inputHash({
      type: node.type,
      params: parsed.data,
      inputs,
    });
    let run: NodeRunEntity | null = null;
    for (let attempt = 0; attempt < 3 && !run; attempt++) {
      const rows: { id: string }[] = await this.runs.query(
        `INSERT INTO node_runs (space_id, node_id, node_type, status, input_hash, params, inputs)
        VALUES ($1, $2, $3, 'queued', $4, $5::jsonb, $6::jsonb)
        ON CONFLICT (space_id, node_id, input_hash) WHERE status IN ('queued','running') DO NOTHING RETURNING id`,
        [
          spaceId,
          nodeId,
          node.type,
          hash,
          JSON.stringify(parsed.data),
          JSON.stringify(inputs),
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
    await this.queue
      .enqueue(run.id)
      .catch(() =>
        this.logger.warn('Enqueue deferred; reconciliation will retry'),
      );
    return { runId: run.id };
  }
  async history(user: User, spaceId: string, nodeId?: string) {
    await this.spaces.get(user, spaceId);
    const query = this.runs
      .createQueryBuilder('run')
      .where('run.space_id = :spaceId', { spaceId });
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
    const claimed = await this.runs
      .createQueryBuilder()
      .update(NodeRunEntity)
      .set({ status: 'running', startedAt: () => 'CURRENT_TIMESTAMP' })
      .where('id = :id AND status = :status', { id, status: 'queued' })
      .execute();
    if (!claimed.affected) return;
    const run = await this.runs.findOneByOrFail({ id });
    this.events.emit(runDto(run));
    const controller = new AbortController();
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
          new Error(
            'provider_timeout: image generation took too long. Please retry.',
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
            error instanceof Error
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
    }
  }
  private async emit(id: string) {
    const run = await this.runs.findOneBy({ id });
    if (run) this.events.emit(runDto(run));
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
      where: { status: 'queued' },
      order: { sequence: 'ASC' },
      take: 500,
    });
    for (const run of queued) await this.queue.enqueue(run.id).catch(() => {});
  }
}
