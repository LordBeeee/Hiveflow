import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

export function redisConnection(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username
      ? { username: decodeURIComponent(parsed.username) }
      : {}),
    ...(parsed.password
      ? { password: decodeURIComponent(parsed.password) }
      : {}),
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
}
@Injectable()
export class NodeRunQueue implements OnModuleDestroy {
  readonly queue: Queue<{ runId: string }>;
  readonly videoQueue: Queue<{ runId: string }>;
  constructor(config: ConfigService) {
    this.queue = new Queue('node-runs', {
      connection: {
        ...redisConnection(config.getOrThrow<string>('REDIS_URL')),
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      },
    });
    this.videoQueue = new Queue('video-runs', {
      connection: {
        ...redisConnection(config.getOrThrow<string>('REDIS_URL')),
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      },
    });
    this.videoQueue.on('error', () => {});
    this.queue.on('error', () => {}); // Reconciliation retries enqueueing after transient Redis failures.
  }
  async enqueue(runId: string, kind?: string | null, recovery = false) {
    const queue = kind === 'video' ? this.videoQueue : this.queue;
    const jobId = recovery ? `${runId}-resume-${Date.now()}` : runId;
    const existing = await queue.getJob(jobId);
    if (existing && ['completed', 'failed'].includes(await existing.getState()))
      await existing.remove();
    await queue.add(
      'execute',
      { runId },
      { jobId, removeOnComplete: 1000, removeOnFail: 1000 },
    );
  }
  async onModuleDestroy() {
    await Promise.all([this.queue.close(), this.videoQueue.close()]);
  }
  async remove(runId: string) {
    for (const queue of [this.queue, this.videoQueue]) {
      const job = await queue.getJob(runId);
      if (job && (await job.getState()) !== 'active') await job.remove();
    }
  }
}
