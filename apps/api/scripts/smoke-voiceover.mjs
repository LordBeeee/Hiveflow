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
  const node = (type, params) => ({
    id: randomUUID(),
    type,
    params: { ...shared.nodeRegistry[type].defaultParams, ...params },
    position: { x: 0, y: 0 },
  });
  const text = node('text', {
    value: 'A calm lake at sunrise. Take a deep breath.',
  });
  const assistant = node('assistant', {
    message: 'Write a short narration',
    preset: 'script_writer',
  });
  const voiceover = node('voiceover', { script: 'Preserved local narration' });
  const edge = (source, target, targetHandle) => ({
    id: randomUUID(),
    source: source.id,
    target: target.id,
    sourceHandle: 'text',
    targetHandle,
  });
  const graph = {
    ...shared.emptyGraph(),
    nodes: [text, assistant, voiceover],
    edges: [
      edge(text, assistant, 'context'),
      edge(assistant, voiceover, 'script'),
    ],
  };
  id = (
    await request('/spaces', 'POST', {
      name: 'Phase 9 integration fixture',
      graph,
    })
  ).id;
  async function until(check) {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      const value = await check();
      if (value) return value;
      await delay(80);
    }
    throw new Error('Voiceover integration timed out');
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
      `/spaces/${id}/nodes/${voiceover.id}/run`,
      'POST',
      {},
    );
    return until(async () => {
      const row = (
        await request(`/spaces/${id}/runs?nodeId=${voiceover.id}`)
      ).find((row) => row.runId === runId);
      return row && ['succeeded', 'failed'].includes(row.status) && row;
    });
  }
  const first = await batch();
  assert.equal(first.status, 'succeeded');
  const llm = first.rows.find((row) => row.node_id === assistant.id);
  const generated = first.rows.find((row) => row.node_id === voiceover.id);
  assert.match(llm.output.text, /^Narration script:/);
  assert.equal(generated.inputs.ports.script[0].value, llm.output.text);
  assert.equal(generated.model, 'mock-tts');
  assert.equal(generated.provider_kind, 'tts');
  assert(new Date(generated.started_at) >= new Date(llm.finished_at));
  const ref = generated.output.audio[0];
  const asset = await request(`/assets/${ref.assetId}/metadata`);
  assert.equal(asset.kind, 'audio');
  assert.equal(asset.width, null);
  assert.equal(asset.height, null);
  assert.equal(asset.mime, 'audio/wav');
  assert.equal(asset.durationMs, ref.durationMs);
  const response = await fetch(`${base}/assets/${ref.assetId}`);
  assert(response.ok);
  assert.equal(response.headers.get('content-type'), 'audio/wav');
  assert.match(response.headers.get('content-disposition'), /\.wav"$/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.length, 44 + ref.durationMs * 32);
  assert.equal(Number(response.headers.get('content-length')), bytes.length);
  const cached = await batch();
  assert(
    cached.rows
      .filter((row) => [assistant.id, voiceover.id].includes(row.node_id))
      .every((row) => row.cache_hit),
  );
  assert.equal(
    cached.rows.find((row) => row.node_id === voiceover.id).output.audio[0]
      .assetId,
    ref.assetId,
  );
  const forced = await batch(true);
  assert.equal(forced.status, 'succeeded');
  assert(forced.rows.every((row) => !row.cache_hit));
  assert.notEqual(
    forced.rows.find((row) => row.node_id === voiceover.id).output.audio[0]
      .assetId,
    ref.assetId,
  );
  graph.edges = [edge(text, voiceover, 'script')];
  await save();
  const textRun = await run();
  assert.equal(textRun.status, 'succeeded', textRun.error);
  assert.equal(
    (
      await db.query('SELECT inputs FROM node_runs WHERE id=$1', [
        textRun.runId,
      ])
    ).rows[0].inputs.ports.script[0].value,
    text.params.value,
  );
  text.params.value = '';
  await save();
  assert.match((await run()).error, /no output|Enter some text/);
  text.params.value = 'x'.repeat(5001);
  await save();
  assert.match((await run()).error, /5,000/);
  graph.edges = [];
  await save();
  const local = await run();
  assert.equal(local.status, 'succeeded', local.error);
  voiceover.params.voice = 'unsupported';
  await save();
  assert.match((await run()).error, /does not support voice/);
  voiceover.params.voice = 'calm';
  voiceover.params.language = 'unsupported';
  await save();
  assert.match((await run()).error, /does not support language/);
  voiceover.params.language = 'auto';
  await save();
  const start = await request(`/spaces/${id}/run`, 'POST', { force: true });
  await until(
    async () =>
      (
        await db.query(
          "SELECT id FROM node_runs WHERE batch_id=$1 AND node_id=$2 AND status='running'",
          [start.batchId, voiceover.id],
        )
      ).rows.length,
  );
  await request(`/batches/${start.batchId}/cancel`, 'POST', {});
  await delay(1600);
  const canceled = (
    await db.query(
      'SELECT status,output FROM node_runs WHERE batch_id=$1 AND node_id=$2',
      [start.batchId, voiceover.id],
    )
  ).rows[0];
  assert.equal(canceled.status, 'canceled');
  assert.equal(canceled.output, null);
  console.log(
    'Voiceover integration passed: Assistant/Text/local script dataflow, PCM WAV/metadata/download headers, model provenance, cache/force, empty/oversized script and capability errors, active cancellation.',
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
    await db.query(
      'DELETE FROM usage_ledger WHERE run_id IN (SELECT id FROM node_runs WHERE space_id=$1)',
      [id],
    );
    await db.query('DELETE FROM spaces WHERE id=$1', [id]);
  }
  storage.destroy();
  await db.end();
}
