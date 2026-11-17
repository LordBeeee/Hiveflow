import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { RunsService } from '../runs/runs.service';
import { BatchesService } from '../runs/batches.service';
import { NodeRunQueue, redisConnection } from './node-run.queue';
@Injectable()
export class NodeRunProcessor
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private worker?: Worker;
  private timer?: ReturnType<typeof setInterval>;
  private reconciling = false;
  private readonly logger = new Logger(NodeRunProcessor.name);
  constructor(
    private readonly runs: RunsService,
    private readonly queue: NodeRunQueue,
    private readonly config: ConfigService,
    private readonly batches: BatchesService,
  ) {}
  async onApplicationBootstrap() {
    await this.queue.queue.waitUntilReady();
    await this.runs.reconcile();
    await this.batches.reconcile();
    this.worker = new Worker(
      'node-runs',
      async (job) => {
        await this.runs.process((job.data as { runId: string }).runId);
      },
      {
        connection: redisConnection(
          this.config.getOrThrow<string>('REDIS_URL'),
        ),
        concurrency: this.config.getOrThrow<number>('WORKER_CONCURRENCY'),
      },
    );
    this.worker.on('error', () =>
      this.logger.warn('Queue connection interrupted; reconnecting'),
    );
    this.timer = setInterval(() => {
      if (this.reconciling) return;
      this.reconciling = true;
      void this.runs
        .reconcile()
        .then(() => this.batches.reconcile())
        .catch(() => this.logger.warn('Run reconciliation deferred'))
        .finally(() => {
          this.reconciling = false;
        });
    }, 1000);
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.worker?.close();
  }
}
