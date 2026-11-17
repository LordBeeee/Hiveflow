import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import sharp from 'sharp';
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
const fixtures = [];
const streamAbort = new AbortController();
let streamTask;
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, body: await response.json() };
}
async function until(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(150);
  }
  throw new Error('Integration condition timed out');
}
try {
  const graph = shared.emptyGraph();
  const nodeId = randomUUID();
  graph.nodes = [
    {
      id: nodeId,
      type: 'image_generator',
      position: { x: 0, y: 0 },
      params: {
        ...shared.nodeRegistry.image_generator.defaultParams,
        prompt: 'Phase 3 original prompt',
        count: 2,
        aspectRatio: '16:9',
      },
    },
  ];
  const created = await request('/spaces', 'POST', {
    name: 'Phase 3 integration fixture',
    graph,
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  fixtures.push(id);
  const png = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#559977' },
  })
    .png()
    .toBuffer();
  async function upload(bytes, mime = 'image/png', spaceId = id) {
    const data = new FormData();
    data.set('spaceId', spaceId);
    data.set('file', new Blob([bytes], { type: mime }), 'fixture.png');
    const response = await fetch(`${base}/assets`, {
      method: 'POST',
      body: data,
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json() };
  }
  const asset = await upload(png);
  assert.equal(asset.status, 201);
  assert.equal(asset.body.width, 64);
  assert.equal(asset.body.height, 48);
  const bytes = Buffer.from(
    await (await fetch(`${base}/assets/${asset.body.id}`)).arrayBuffer(),
  );
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    asset.body.sha256,
  );
  assert.equal(
    (await request(`/assets/${asset.body.id}/metadata`)).body.id,
    asset.body.id,
  );
  assert.equal((await upload(png, 'image/jpeg')).status, 400);
  assert.equal((await upload(Buffer.from('invalid'))).status, 400);
  assert.equal(
    (await upload(Buffer.from('<svg/>'), 'image/svg+xml')).status,
    400,
  );
  assert.equal(
    (
      await upload(
        Buffer.alloc(
          (Number(process.env.MAX_UPLOAD_MB ?? 20) + 1) * 1024 * 1024,
        ),
      )
    ).status,
    413,
  );
  const foreignId = randomUUID();
  fixtures.push(foreignId);
  await db.query(
    'INSERT INTO spaces (id,user_id,name,graph) VALUES ($1,$2,$3,$4)',
    [foreignId, randomUUID(), 'Foreign Phase 3 fixture', JSON.stringify(graph)],
  );
  assert.equal((await upload(png, 'image/png', foreignId)).status, 404);
  await db.query('UPDATE assets SET space_id=$1 WHERE id=$2', [
    foreignId,
    asset.body.id,
  ]);
  assert.equal((await request(`/assets/${asset.body.id}`)).status, 404);
  assert.equal(
    (await request(`/assets/${asset.body.id}/metadata`)).status,
    404,
  );
  await db.query('UPDATE assets SET space_id=$1 WHERE id=$2', [
    id,
    asset.body.id,
  ]);
  for (const path of ['runs', 'events'])
    assert.equal((await request(`/spaces/${foreignId}/${path}`)).status, 404);
  assert.equal(
    (await request(`/spaces/${foreignId}/nodes/${nodeId}/run`, 'POST', {}))
      .status,
    404,
  );
  const events = [];
  let heartbeat = false;
  const stream = await fetch(`${base}/spaces/${id}/events`, {
    signal: streamAbort.signal,
  });
  assert.equal(
    stream.headers.get('content-type').split(';')[0],
    'text/event-stream',
  );
  streamTask = (async () => {
    const decoder = new TextDecoder();
    let pending = '';
    for await (const chunk of stream.body) {
      pending += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (frame.includes(': heartbeat')) heartbeat = true;
        const data = frame
          .split('\n')
          .find((line) => line.startsWith('data: '));
        if (data)
          events.push(shared.runEventSchema.parse(JSON.parse(data.slice(6))));
      }
    }
  })().catch((error) => {
    if (!streamAbort.signal.aborted) throw error;
  });
  const starts = await Promise.all(
    Array.from({ length: 4 }, () =>
      request(`/spaces/${id}/nodes/${nodeId}/run`, 'POST', {}),
    ),
  );
  starts.forEach((run) => assert.equal(run.status, 201));
  assert.equal(new Set(starts.map((run) => run.body.runId)).size, 1);
  const runId = starts[0].body.runId;
  assert.equal((await request(`/spaces/${id}/runs`)).body[0].runId, runId);
  graph.nodes[0].params.prompt = 'Edited after the run started';
  assert.equal(
    (await request(`/spaces/${id}`, 'PATCH', { version: 1, graph })).status,
    200,
  );
  const completed = await until(async () => {
    const run = (
      await request(`/spaces/${id}/runs?nodeId=${nodeId}`)
    ).body.find((row) => row.runId === runId);
    if (run.status === 'failed') throw new Error(run.error);
    return run.status === 'succeeded' && run;
  });
  assert.equal(completed.output.image.length, 2);
  assert.equal(completed.cacheHit, false);
  assert.equal(
    (await db.query('SELECT params FROM node_runs WHERE id=$1', [runId]))
      .rows[0].params.prompt,
    'Phase 3 original prompt',
  );
  for (const image of completed.output.image) {
    assert.equal(image.width, 1024);
    assert.equal(image.height, 576);
    const output = await fetch(`${base}/assets/${image.assetId}`);
    assert.equal(output.status, 200);
    assert.equal(
      (await sharp(Buffer.from(await output.arrayBuffer())).metadata()).format,
      'png',
    );
  }
  const retried = await request(
    `/spaces/${id}/nodes/${nodeId}/run`,
    'POST',
    {},
  );
  assert.notEqual(retried.body.runId, runId);
  await until(
    async () =>
      (await request(`/spaces/${id}/runs`)).body[0].status === 'succeeded',
  );
  const recoveryId = randomUUID();
  await db.query(
    "INSERT INTO node_runs (id,space_id,node_id,node_type,status,input_hash,params) VALUES ($1,$2,$3,'text','queued',$4,$5)",
    [
      recoveryId,
      id,
      randomUUID(),
      randomUUID(),
      JSON.stringify({ value: 'recovered queue gap' }),
    ],
  );
  const lostId = randomUUID();
  await db.query(
    "INSERT INTO node_runs (id,space_id,node_id,node_type,status,input_hash,params,started_at) VALUES ($1,$2,$3,'text','running',$4,'{}',now()-interval '1 day')",
    [lostId, id, randomUUID(), randomUUID()],
  );
  await until(async () => {
    const rows = (
      await db.query(
        'SELECT id,status,error FROM node_runs WHERE id=ANY($1::uuid[])',
        [[recoveryId, lostId]],
      )
    ).rows;
    return (
      rows.some((row) => row.id === recoveryId && row.status === 'succeeded') &&
      rows.some(
        (row) =>
          row.id === lostId &&
          row.status === 'failed' &&
          row.error.startsWith('worker_lost'),
      )
    );
  });
  await until(() => heartbeat);
  assert(
    events.some((event) => event.runId === runId && event.status === 'queued'),
  );
  assert(
    events.some((event) => event.runId === runId && event.status === 'running'),
  );
  assert(
    events.some(
      (event) => event.runId === runId && event.status === 'succeeded',
    ),
  );
  console.log(
    'Runs integration passed: upload validation/limits, durable image metadata, ownership, concurrent deduplication, immutable saved params, generated PNGs, history recovery, SSE events/heartbeat, queue gap and lost worker recovery.',
  );
} finally {
  streamAbort.abort();
  await streamTask;
  for (const id of fixtures) {
    const assets = (
      await db.query('SELECT storage_key FROM assets WHERE space_id=$1', [id])
    ).rows;
    for (const asset of assets)
      await storage.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: asset.storage_key,
        }),
      );
    await db.query('DELETE FROM spaces WHERE id=$1', [id]);
  }
  storage.destroy();
  await db.end();
}
