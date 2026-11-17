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
  const first = node('text', { value: 'A quiet cabin' });
  const second = node('text', { value: 'At blue hour' });
  const assistant = node('assistant', {
    message: 'Make it cinematic',
    preset: 'prompt_improver',
  });
  const image = node('image_generator', { prompt: 'ignored local prompt' });
  const edge = (source, target, sourceHandle, targetHandle) => ({
    id: randomUUID(),
    source: source.id,
    target: target.id,
    sourceHandle,
    targetHandle,
  });
  graph.nodes = [first, second, assistant, image];
  graph.edges = [
    edge(first, assistant, 'text', 'context'),
    edge(second, assistant, 'text', 'context'),
    edge(assistant, image, 'text', 'prompt'),
  ];
  id = (
    await request('/spaces', 'POST', {
      name: 'Phase 8 integration fixture',
      graph,
    })
  ).id;
  async function until(check) {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      const value = await check();
      if (value) return value;
      await delay(100);
    }
    throw new Error('Assistant integration timed out');
  }
  async function save() {
    const current = await request(`/spaces/${id}`);
    await request(`/spaces/${id}`, 'PATCH', {
      version: current.version,
      graph,
    });
  }
  async function batch(force = false) {
    const start = await request(`/spaces/${id}/run`, 'POST', { force });
    const result = await until(async () => {
      const batch = (await request(`/spaces/${id}/batches`)).find(
        (batch) => batch.batchId === start.batchId,
      );
      return batch.status !== 'running' && batch;
    });
    const rows = (
      await db.query('SELECT * FROM node_runs WHERE batch_id=$1', [
        start.batchId,
      ])
    ).rows;
    return { ...result, rows };
  }
  async function run() {
    const { runId } = await request(
      `/spaces/${id}/nodes/${assistant.id}/run`,
      'POST',
      {},
    );
    return until(async () => {
      const row = (
        await request(`/spaces/${id}/runs?nodeId=${assistant.id}`)
      ).find((row) => row.runId === runId);
      return (
        row && ['succeeded', 'failed', 'canceled'].includes(row.status) && row
      );
    });
  }
  const firstRun = await batch();
  assert.equal(firstRun.status, 'succeeded');
  const llm = firstRun.rows.find((row) => row.node_id === assistant.id);
  const generated = firstRun.rows.find((row) => row.node_id === image.id);
  assert.match(
    llm.output.text,
    /^Improved prompt: A quiet cabin\n\nAt blue hour\n\nMake it cinematic/,
  );
  assert.equal(llm.model, 'mock-llm');
  assert.equal(generated.inputs.ports.prompt[0].value, llm.output.text);
  assert(new Date(generated.started_at) >= new Date(llm.finished_at));
  assert(!JSON.stringify(llm.inputs).includes('http'));
  const cached = await batch();
  assert.equal(cached.status, 'succeeded');
  assert(
    cached.rows
      .filter((row) => [assistant.id, image.id].includes(row.node_id))
      .every((row) => row.cache_hit),
  );
  const forced = await batch(true);
  assert.equal(forced.status, 'succeeded');
  assert(forced.rows.every((row) => !row.cache_hit));
  // Use an existing generated image as a vision reference, avoiding a cycle.
  const upload = node('image_upload', {
    assetId: generated.output.image[0].assetId,
  });
  graph.nodes.push(upload);
  graph.edges.push(edge(upload, assistant, 'image', 'images'));
  assistant.params.model = 'mock-llm-text';
  await save();
  assert.match((await run()).error, /does not support image input/);
  assistant.params.model = 'mock-llm';
  assistant.params.preset = 'image_to_prompt';
  await save();
  const vision = await run();
  assert.equal(vision.status, 'succeeded', vision.error);
  assert.match(vision.output.text, /Image references: [a-f0-9]{12}/);
  assert.match(vision.output.text, /^Image prompt:/);
  const stored = (
    await db.query('SELECT inputs,params FROM node_runs WHERE id=$1', [
      vision.runId,
    ])
  ).rows[0];
  assert(!JSON.stringify(stored).includes('X-Amz'));
  graph.edges = graph.edges.filter((item) => item.targetHandle !== 'images');
  first.params.value = 'x'.repeat(20000);
  await save();
  assert.match((await run()).error, /20,000 characters/);
  first.params.value = 'Changed upstream context';
  await save();
  const start = await request(`/spaces/${id}/run`, 'POST', { force: true });
  await until(
    async () =>
      (
        await db.query(
          "SELECT id FROM node_runs WHERE batch_id=$1 AND node_id=$2 AND status='running'",
          [start.batchId, assistant.id],
        )
      ).rows.length,
  );
  await request(`/batches/${start.batchId}/cancel`, 'POST', {});
  await delay(1600);
  const canceled = (
    await db.query(
      'SELECT node_id,status,output FROM node_runs WHERE batch_id=$1',
      [start.batchId],
    )
  ).rows;
  assert.equal(
    canceled.find((row) => row.node_id === assistant.id).status,
    'canceled',
  );
  assert.equal(
    canceled.find((row) => row.node_id === assistant.id).output,
    null,
  );
  assert.equal(
    canceled.find((row) => row.node_id === image.id).status,
    'canceled',
  );
  console.log(
    'Assistant integration passed: ordered context, presets, text-to-image batch dataflow, model provenance, cache/force, vision/reference signatures, context cap and cancellation.',
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
    for (const row of (
      await db.query('SELECT storage_key FROM assets WHERE space_id=$1', [id])
    ).rows)
      await storage.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: row.storage_key,
        }),
      );
    await db.query('DELETE FROM spaces WHERE id=$1', [id]);
  }
  storage.destroy();
  await db.end();
}
