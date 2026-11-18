import { Readable } from 'node:stream';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  HeadObjectCommand,
  ListMultipartUploadsCommand,
} from '@aws-sdk/client-s3';
import storageModule from '../dist/assets/storage.service.js';
import assetModule from '../dist/assets/asset.entity.js';
import assetsModule from '../dist/assets/assets.service.js';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { ConfigModule } from '@nestjs/config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import shared from '@hiveflow/shared';
await ConfigModule.forRoot({
  envFilePath: fileURLToPath(new URL('../../../.env', import.meta.url)),
});
const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const storage = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});
let id;
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  assert(response.ok, `${response.status} ${await response.clone().text()}`);
  return response.json();
}

try {
  const graph = shared.emptyGraph();
  const node = (type, params) => ({
    id: randomUUID(),
    type,
    params: { ...shared.nodeRegistry[type].defaultParams, ...params },
    position: { x: 0, y: 0 },
  });
  const text = node('text', { value: 'A calm lake at sunrise' }),
    assistant = node('assistant', {
      preset: 'prompt_improver',
      message: 'Add motion',
    }),
    video = node('video_generator', { prompt: 'Local video' }),
    upload = node('image_upload', {});
  const edge = (source, target, sourceHandle, targetHandle) => ({
    id: randomUUID(),
    source: source.id,
    target: target.id,
    sourceHandle,
    targetHandle,
  });
  graph.nodes = [text, assistant, video];
  graph.edges = [
    edge(text, assistant, 'text', 'context'),
    edge(assistant, video, 'text', 'prompt'),
  ];
  id = (
    await request('/spaces', 'POST', {
      name: 'Phase 10 integration fixture',
      graph,
    })
  ).id;
  const png = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#90b0c0' },
  })
    .png()
    .toBuffer();
  const form = new FormData();
  form.set('spaceId', id);
  form.set('file', new Blob([png], { type: 'image/png' }), 'reference.png');
  const uploaded = await fetch(`${base}/assets`, {
    method: 'POST',
    body: form,
  });
  assert(uploaded.ok);
  const asset = await uploaded.json();
  upload.params.assetId = asset.id;
  graph.nodes.push(upload);
  graph.edges.push(edge(upload, video, 'image', 'start_image'));
  async function save() {
    const current = await request(`/spaces/${id}`);
    await request(`/spaces/${id}`, 'PATCH', {
      version: current.version,
      graph,
    });
  }
  await save();
  async function until(check, timeout = 65000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try {
        const value = await check();
        if (value) return value;
      } catch (error) {
        if (!process.env.VIDEO_RESTART_API) throw error;
      }
      await delay(100);
    }
    throw new Error('Video integration timed out');
  }
  const progress = new Set();
  async function finished(runId) {
    return until(async () => {
      const row = (await request(`/spaces/${id}/runs?nodeId=${video.id}`)).find(
        (run) => run.runId === runId,
      );
      if (row?.progress !== undefined) progress.add(row.progress);
      return (
        row && ['succeeded', 'failed', 'canceled'].includes(row.status) && row
      );
    });
  }
  const start = await request(`/spaces/${id}/run`, 'POST', {});
  const result = await until(async () => {
    const run = (await request(`/spaces/${id}/runs?nodeId=${video.id}`))[0];
    if (run?.progress !== undefined) progress.add(run.progress);
    const batch = (await request(`/spaces/${id}/batches`)).find(
      (batch) => batch.batchId === start.batchId,
    );
    return batch.status !== 'running' && batch;
  });
  assert.equal(
    result.status,
    'succeeded',
    JSON.stringify(
      (
        await db.query(
          "SELECT node_type,error FROM node_runs WHERE batch_id=$1 AND status='failed'",
          [start.batchId],
        )
      ).rows,
    ),
  );
  assert(
    [...progress].some((value) => value > 0 && value < 100),
    'Progress must move',
  );
  const generated = (await request(`/spaces/${id}/runs?nodeId=${video.id}`))[0];
  const ref = generated.output.video[0];
  const dbRun = (
    await db.query('SELECT * FROM node_runs WHERE id=$1', [generated.runId])
  ).rows[0];
  assert(dbRun.provider_task_id);
  assert.equal(dbRun.provider, 'mock-video');
  assert.equal(dbRun.inputs.ports.start_image[0].assetId, asset.id);
  assert(!JSON.stringify(dbRun).includes('X-Amz'));
  const metadata = await request(`/assets/${ref.assetId}/metadata`);
  assert.equal(metadata.kind, 'video');
  assert.equal(metadata.durationMs, 2000);
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 180);
  const full = await fetch(`${base}/assets/${ref.assetId}`);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.match(full.headers.get('cache-control'), /max-age=3600/);
  assert.match(full.headers.get('content-disposition'), /\.mp4"$/);
  const bytes = Buffer.from(await full.arrayBuffer());
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    metadata.sha256,
  );
  for (const [header, a, b] of [
    ['bytes=0-15', 0, 15],
    ['bytes=-16', bytes.length - 16, bytes.length - 1],
    ['bytes=100-', 100, bytes.length - 1],
  ]) {
    const response = await fetch(`${base}/assets/${ref.assetId}`, {
      headers: { Range: header },
    });
    assert.equal(response.status, 206);
    assert.equal(
      response.headers.get('content-range'),
      `bytes ${a}-${b}/${bytes.length}`,
    );
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      bytes.subarray(a, b + 1),
    );
  }
  const invalid = await fetch(`${base}/assets/${ref.assetId}`, {
    headers: { Range: `bytes=${bytes.length}-` },
  });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), `bytes */${bytes.length}`);
  const ifRange = await fetch(`${base}/assets/${ref.assetId}`, {
    headers: { Range: 'bytes=0-15', 'If-Range': '"outdated"' },
  });
  assert.equal(ifRange.status, 200);
  await ifRange.arrayBuffer();
  const matching = await fetch(`${base}/assets/${ref.assetId}`, {
    headers: { Range: 'bytes=0-15', 'If-Range': full.headers.get('etag') },
  });
  assert.equal(matching.status, 206);
  await matching.arrayBuffer();

  // Cross the multipart threshold with a generated byte stream; no full video Buffer.
  const mediaDb = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [assetModule.AssetEntity],
    synchronize: false,
  });
  const mediaConfig = new ConfigService(process.env);
  const mediaStorage = new storageModule.S3StorageService(mediaConfig);
  try {
    await mediaDb.initialize();
    await mediaStorage.onModuleInit();
    const mediaService = new assetsModule.AssetsService(
      mediaDb.getRepository(assetModule.AssetEntity),
      mediaStorage,
      {},
      mediaConfig,
    );
    const expected = createHash('sha256');
    async function* payload(fail = false) {
      const header = Buffer.alloc(32);
      header.writeUInt32BE(32, 0);
      header.write('ftyp', 4);
      if (!fail) expected.update(header);
      yield header;
      for (let index = 0; index < 96; index++) {
        const chunk = Buffer.alloc(65536, index);
        if (!fail) expected.update(chunk);
        yield chunk;
      }
      if (fail) throw new Error('fixture stream interrupted');
    }
    const large = await mediaService.store(id, {
      kind: 'video',
      stream: Readable.from(payload()),
      mime: 'video/mp4',
      meta: { width: 320, height: 180, durationMs: 2000 },
    });
    assert.equal(large.sizeBytes, 6291488);
    assert.equal(large.sha256, expected.digest('hex'));
    const key = (
      await db.query('SELECT storage_key FROM assets WHERE id=$1', [large.id])
    ).rows[0].storage_key;
    const head = await storage.send(
      new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
    assert.match(
      head.ETag,
      /-2"$/,
      'The large stream must use multipart upload',
    );
    const part = await fetch(`${base}/assets/${large.id}`, {
      headers: { Range: 'bytes=5242875-5242890' },
    });
    assert.equal(part.status, 206);
    assert.deepEqual(
      Buffer.from(await part.arrayBuffer()),
      Buffer.alloc(16, 79),
    );
    await assert.rejects(
      () =>
        mediaService.store(id, {
          kind: 'video',
          stream: Readable.from(payload(true)),
          mime: 'video/mp4',
          meta: { width: 320, height: 180 },
        }),
      /fixture stream interrupted/,
    );
    const pendingParts = await storage.send(
      new ListMultipartUploadsCommand({
        Bucket: process.env.S3_BUCKET,
        Prefix: `spaces/${id}/`,
      }),
    );
    assert.equal(
      pendingParts.Uploads?.length ?? 0,
      0,
      'Failed streams must abort incomplete multipart uploads',
    );
  } finally {
    mediaStorage.onModuleDestroy();
    if (mediaDb.isInitialized) await mediaDb.destroy();
  }
  const cached = await request(
    `/spaces/${id}/nodes/${video.id}/run`,
    'POST',
    {},
  );
  assert.equal((await finished(cached.runId)).cacheHit, true);
  video.params.model = 'mock-video-basic';
  video.params.duration = 10;
  await save();
  let rejected = await request(
    `/spaces/${id}/nodes/${video.id}/run`,
    'POST',
    {},
  );
  assert.match((await finished(rejected.runId)).error, /duration/);
  video.params.duration = 5;
  graph.edges.push(edge(upload, video, 'image', 'end_image'));
  await save();
  rejected = await request(`/spaces/${id}/nodes/${video.id}/run`, 'POST', {});
  assert.match((await finished(rejected.runId)).error, /end image/);
  assert.equal(
    (
      await db.query(
        'SELECT count(*) FROM mock_video_tasks WHERE request_id=$1',
        [rejected.runId],
      )
    ).rows[0].count,
    '0',
  );
  video.params.model = 'auto';
  graph.edges = graph.edges.filter((item) => item.targetHandle !== 'end_image');
  await save();
  let forced = await request(`/spaces/${id}/nodes/${video.id}/run`, 'POST', {
    force: true,
  });
  const checkpoint = async (runId) =>
    until(async () => {
      const row = (
        await db.query('SELECT provider_task_id FROM node_runs WHERE id=$1', [
          runId,
        ])
      ).rows[0];
      return row.provider_task_id;
    });
  let taskId = await checkpoint(forced.runId);
  if (process.env.VIDEO_RESTART_API === '1') {
    execFileSync('docker', ['compose', 'kill', '-s', 'SIGKILL', 'api'], {
      stdio: 'pipe',
    });
    execFileSync('docker', ['compose', 'start', 'api'], { stdio: 'pipe' });
    await until(async () => {
      const response = await fetch(`${base}/health`);
      return response.ok;
    });
    const resumed = await finished(forced.runId);
    assert.equal(resumed.status, 'succeeded', resumed.error);
    assert.equal(
      (
        await db.query('SELECT provider_task_id FROM node_runs WHERE id=$1', [
          forced.runId,
        ])
      ).rows[0].provider_task_id,
      taskId,
    );
    assert.equal(
      (
        await db.query(
          'SELECT submit_calls FROM mock_video_tasks WHERE id=$1',
          [taskId],
        )
      ).rows[0].submit_calls,
      1,
    );
    console.log(
      'Restart acceptance passed: SIGKILL/restart resumes the same task with exactly one submit.',
    );
    forced = await request(`/spaces/${id}/nodes/${video.id}/run`, 'POST', {
      force: true,
    });
    taskId = await checkpoint(forced.runId);
  }
  await request(`/runs/${forced.runId}/cancel`, 'POST', {});
  await delay(500);
  assert.equal((await finished(forced.runId)).status, 'canceled');
  assert.equal(
    (
      await db.query('SELECT canceled FROM mock_video_tasks WHERE id=$1', [
        taskId,
      ])
    ).rows[0].canceled,
    true,
  );
  // Six video requests must not occupy the fast worker queue or mock-image provider slots.
  const videos = Array.from({ length: 6 }, (_, index) =>
    node('video_generator', { prompt: `Independent video ${index}` }),
  );
  const image = node('image_generator', {
    prompt: 'Image must finish while video tasks are active',
  });
  graph.nodes = [...videos, image];
  graph.edges = [];
  await save();
  const pending = [];
  for (const value of videos)
    pending.push(
      (await request(`/spaces/${id}/nodes/${value.id}/run`, 'POST', {})).runId,
    );
  await until(
    async () =>
      Number(
        (
          await db.query(
            "SELECT count(*) FROM node_runs WHERE id=ANY($1::uuid[]) AND status='running'",
            [pending],
          )
        ).rows[0].count,
      ) === 2,
  );
  const imageStart = Date.now();
  const imageRun = await request(
    `/spaces/${id}/nodes/${image.id}/run`,
    'POST',
    {},
  );
  const imageResult = await until(async () => {
    const run = (await request(`/spaces/${id}/runs?nodeId=${image.id}`)).find(
      (run) => run.runId === imageRun.runId,
    );
    return run?.status === 'succeeded' && run;
  }, 12000);
  assert(imageResult.output.image.length);
  assert(Date.now() - imageStart < 12000);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM node_runs WHERE id=ANY($1::uuid[]) AND status='succeeded'",
        [pending],
      )
    ).rows[0].count,
    '0',
  );
  for (const runId of pending)
    await request(`/runs/${runId}/cancel`, 'POST', {});
  console.log(
    'Video integration passed: Assistant/start-image workflow, progress, streamed MP4/hash/metadata, Range/416, cache, capability rejection, remote cancellation and six-video queue isolation.',
  );
} finally {
  if (id) {
    const active = (
      await db.query(
        "SELECT id FROM batches WHERE space_id=$1 AND status='running'",
        [id],
      )
    ).rows;
    for (const batch of active)
      await fetch(`${base}/batches/${batch.id}/cancel`, { method: 'POST' });
    const pending = (
      await db.query(
        "SELECT id FROM node_runs WHERE space_id=$1 AND status IN ('queued','running')",
        [id],
      )
    ).rows;
    for (const run of pending)
      await fetch(`${base}/runs/${run.id}/cancel`, { method: 'POST' });
    for (const row of (
      await db.query('SELECT storage_key FROM assets WHERE space_id=$1', [id])
    ).rows)
      await storage.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: row.storage_key,
        }),
      );
    await db.query(
      'DELETE FROM usage_ledger WHERE run_id IN (SELECT id FROM node_runs WHERE space_id=$1)',
      [id],
    );
    await db.query('DELETE FROM spaces WHERE id=$1', [id]);
  }
  storage.destroy();
  await db.end();
}
