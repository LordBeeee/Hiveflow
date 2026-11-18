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
  const models = await request('/models');
  for (const name of ['mock-image', 'mock-llm', 'mock-tts', 'mock-video'])
    assert.equal(models.find((model) => model.id === name).available, true);
  assert.match(
    models.find((model) => model.id === 'image-studio').unavailableReason,
    /API key/,
  );
  assert(
    (await request('/models?kind=image')).every(
      (model) => model.kind === 'image',
    ),
  );
  const graph = shared.emptyGraph();
  const node = {
    id: randomUUID(),
    type: 'image_generator',
    position: { x: 0, y: 0 },
    params: {
      ...shared.nodeRegistry.image_generator.defaultParams,
      prompt: 'Phase 7 model fixture',
    },
  };
  graph.nodes = [node];
  const space = await request('/spaces', 'POST', {
    name: 'Phase 7 integration fixture',
    graph,
  });
  id = space.id;
  async function save(params) {
    node.params = params;
    const current = await request(`/spaces/${id}`);
    await request(`/spaces/${id}`, 'PATCH', {
      graph,
      version: current.version,
    });
  }
  async function run() {
    const { runId } = await request(
      `/spaces/${id}/nodes/${node.id}/run`,
      'POST',
      {},
    );
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      const value = (
        await request(`/spaces/${id}/runs?nodeId=${node.id}`)
      ).find((run) => run.runId === runId);
      if (['succeeded', 'failed'].includes(value.status)) return value;
      await delay(100);
    }
    throw new Error('Run timed out');
  }
  const generated = await run();
  assert.equal(generated.status, 'succeeded', generated.error);
  assert.equal(
    generated.model,
    models.find((model) => model.kind === 'image' && model.isDefault).id,
  );
  const cached = await run();
  assert.equal(cached.cacheHit, true);
  for (const model of ['missing-model', 'mock-image-legacy', 'image-studio']) {
    await save({ ...node.params, model });
    const failed = await run();
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /choose another model/i);
    assert.equal(failed.output, null);
  }
  await save({
    ...node.params,
    model: 'mock-image-compact',
    aspectRatio: '3:4',
    options: {},
  });
  assert.match((await run()).error, /does not support aspectRatio/);
  await save({
    ...node.params,
    aspectRatio: '1:1',
    options: { unknown: true },
  });
  assert.match((await run()).error, /Unknown model option/);
  const row = (
    await db.query(
      'SELECT model, params, provider_kind FROM node_runs WHERE id=$1',
      [generated.runId],
    )
  ).rows[0];
  assert.equal(row.model, row.params.model);
  assert.equal(row.provider_kind, 'image');
  console.log(
    'Model integration passed: catalog/availability, resolved auto model, cache, model-agnostic saves, removed/unknown/unconfigured model rejection, capability/options validation and stored model provenance.',
  );
} finally {
  if (id) {
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
