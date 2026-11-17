import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { ProviderError } from './provider-error';
import type { VideoProvider, VideoRequest } from './video-provider';
export class MockVideoProvider implements VideoProvider {
  readonly id = 'mock-video';
  constructor(
    private readonly config: ConfigService,
    private readonly db: DataSource,
  ) {}
  async submit(request: VideoRequest, signal: AbortSignal) {
    signal.throwIfAborted();
    const references: string[] = [];
    for (const image of [request.startImage, request.endImage])
      if (image) {
        const response = await fetch(image.url, { signal });
        if (!response.ok)
          throw new ProviderError(
            'invalid_request',
            false,
            'A video reference could not be downloaded. Upload or run its source again.',
          );
        references.push(
          createHash('sha256')
            .update(Buffer.from(await response.arrayBuffer()))
            .digest('hex'),
        );
      }
    const safe = { ...request };
    delete safe.startImage;
    delete safe.endImage;
    const hash = createHash('sha256')
      .update(JSON.stringify([safe, references]))
      .digest('hex');
    const rows: { id: string }[] = await this.db.query(
      `INSERT INTO mock_video_tasks(request_id,fail,duration_ms,input_hash) VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO UPDATE SET submit_calls=mock_video_tasks.submit_calls+1 RETURNING id`,
      [
        request.requestId,
        Math.random() < this.config.getOrThrow<number>('MOCK_FAILURE_RATE'),
        18000 + (parseInt(hash.slice(0, 4), 16) % 6000),
        hash,
      ],
    );
    return { taskId: rows[0].id };
  }
  async poll(
    taskId: string,
    signal: AbortSignal,
  ): ReturnType<VideoProvider['poll']> {
    signal.throwIfAborted();
    const [task]: {
      created_at: Date;
      duration_ms: number;
      canceled: boolean;
      fail: boolean;
    }[] = await this.db.query('SELECT * FROM mock_video_tasks WHERE id=$1', [
      taskId,
    ]);
    if (!task)
      throw new ProviderError(
        'invalid_request',
        false,
        'Video task is unavailable. Please retry.',
      );
    if (task.canceled)
      return { status: 'failed', error: 'Video task was canceled.' };
    const elapsed = Date.now() - new Date(task.created_at).getTime();
    if (elapsed < 2000) return { status: 'queued', progress: 0 };
    if (elapsed < task.duration_ms)
      return {
        status: 'running',
        progress: Math.min(95, Math.floor((elapsed / task.duration_ms) * 100)),
      };
    if (task.fail)
      return {
        status: 'failed',
        error: 'Mock video provider failed. Please retry.',
      };
    return {
      status: 'succeeded',
      progress: 100,
      result: {
        stream: createReadStream(
          join(__dirname, '../../assets/mock-video.mp4'),
        ),
        mime: 'video/mp4',
        width: 320,
        height: 180,
        durationMs: 2000,
      },
    };
  }
  async cancel(taskId: string) {
    await this.db.query(
      'UPDATE mock_video_tasks SET canceled=true WHERE id=$1',
      [taskId],
    );
  }
}
