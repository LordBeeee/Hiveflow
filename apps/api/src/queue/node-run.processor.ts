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
  private workers: Worker[] = [];
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
    await this.runs.reconcile(true);
    await this.batches.reconcile();
    for (const [name, concurrency] of [
      ['node-runs', this.config.getOrThrow<number>('WORKER_CONCURRENCY')],
      [
        'video-runs',
        this.config.getOrThrow<number>('VIDEO_WORKER_CONCURRENCY'),
      ],
    ] as const) {
      const worker = new Worker(
        name,
        async (job) => this.runs.process((job.data as { runId: string }).runId),
        {
          connection: redisConnection(
            this.config.getOrThrow<string>('REDIS_URL'),
          ),
          concurrency,
        },
      );
      worker.on('error', () =>
        this.logger.warn('Queue connection interrupted; reconnecting'),
      );
      this.workers.push(worker);
    }
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
    await Promise.all(this.workers.map((worker) => worker.close()));
  }
}
