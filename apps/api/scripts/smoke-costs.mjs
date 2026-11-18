import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import costsModule from '../dist/runs/costs.service.js';
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
const fixtures = [];
const runIds = [];
const savedKeys = [];
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

const node = (type, params = {}) => ({
  id: randomUUID(),
  type,
  params: { ...shared.nodeRegistry[type].defaultParams, ...params },
  position: { x: 0, y: 0 },
});
const edge = (source, target, targetHandle) => ({
  id: randomUUID(),
  source: source.id,
  sourceHandle: 'text',
  target: target.id,
  targetHandle,
});
async function create(nodes, edges = []) {
  const space = await request('/spaces', 'POST', {
    name: 'Phase 11 cost fixture',
    graph: { ...shared.emptyGraph(), nodes, edges },
  });
  fixtures.push(space.id);
  return space;
}
async function until(check) {
  const end = Date.now() + 65000;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(100);
  }
  throw new Error('Cost integration timed out');
}
async function run(space, nodeId, force = false) {
  const start = await request(
    `/spaces/${space.id}/nodes/${nodeId}/run`,
    'POST',
    { force },
  );
  runIds.push(start.runId);
  return until(async () => {
    const result = (
      await request(`/spaces/${space.id}/runs?nodeId=${nodeId}`)
    ).find((row) => row.runId === start.runId);
    return (
      result &&
      ['succeeded', 'failed', 'canceled'].includes(result.status) &&
      result
    );
  });
}
const ledger = async (ids) =>
  Number(
    (
      await db.query(
        'SELECT COALESCE(sum(units),0)::text AS units FROM usage_ledger WHERE run_id=ANY($1::uuid[])',
        [ids],
      )
    ).rows[0].units,
  );
try {
  const text = node('text', { value: 'Hello lake' }),
    image = node('image_generator', { count: 2, resolution: '2K' }),
    llm = node('assistant', { message: 'A scene' }),
    voice = node('voiceover'),
    video = node('video_generator');
  const space = await create(
    [text, image, llm, voice, video],
    [
      edge(text, image, 'prompt'),
      edge(text, llm, 'context'),
      edge(text, voice, 'script'),
      edge(text, video, 'prompt'),
    ],
  );
  id = space.id;
  const quote = await request(`/spaces/${id}/run/estimate`, 'POST', {});
  assert.equal(quote.providerNodes, 4);
  assert.equal(quote.units, 15.01);
  assert.equal(quote.upperBound, false);
  assert.equal(quote.allowed, true);
  const started = await request(`/spaces/${id}/run`, 'POST', {
    version: quote.version,
    maxUnits: quote.units,
    maxProviderNodes: quote.providerNodes,
  });
  runIds.push(...started.runIds);
  await until(async () => {
    const batch = (await request(`/spaces/${id}/batches`)).find(
      (row) => row.batchId === started.batchId,
    );
    if (batch.status === 'failed') throw new Error('Mixed cost batch failed');
    return batch.status === 'succeeded';
  });
  assert.equal(
    await ledger(started.runIds),
    quote.units,
    'Exact mixed-graph estimate must equal its ledger charge',
  );
  const cached = await request(`/spaces/${id}/run/estimate`, 'POST', {});
  assert.equal(cached.units, 0);
  assert.equal(cached.cachedNodes, 4);
  assert.equal(cached.providerNodes, 0);
  const camera = await request(`/spaces/${id}`);
  camera.graph.viewport.x += 20;
  await request(`/spaces/${id}`, 'PATCH', {
    version: camera.version,
    graph: camera.graph,
  });
  const again = await request(`/spaces/${id}/run`, 'POST', {
    version: cached.version,
    graphHash: cached.graphHash,
    maxUnits: 0,
    maxProviderNodes: 0,
  });
  runIds.push(...again.runIds);
  await until(
    async () =>
      (await request(`/spaces/${id}/batches`)).find(
        (row) => row.batchId === again.batchId,
      ).status === 'succeeded',
  );
  assert.equal(await ledger(again.runIds), 0);
  const force = await request(`/spaces/${id}/run/estimate`, 'POST', {
    force: true,
  });
  assert.equal(force.units, 15.01);
  // Confirmation cannot silently approve a changed graph or a larger estimate.
  const fresh = await request(`/spaces/${id}`);
  await request(`/spaces/${id}`, 'PATCH', {
    version: fresh.version,
    name: 'Phase 11 reviewed fixture',
  });
  let response = await fetch(`${base}/spaces/${id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: quote.version, force: true }),
  });
  assert.equal(response.status, 409);
  const edited = await request(`/spaces/${id}`);
  edited.graph.nodes.find((value) => value.id === text.id).params.value =
    'Different reviewed content';
  await request(`/spaces/${id}`, 'PATCH', {
    version: edited.version,
    graph: edited.graph,
  });
  const changed = await fetch(`${base}/spaces/${id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graphHash: cached.graphHash,
      force: true,
      maxUnits: 1000,
      maxProviderNodes: 100,
    }),
  });
  assert.equal(changed.status, 409);
  response = await fetch(`${base}/spaces/${id}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ force: true, maxUnits: 0 }),
  });
  assert.equal(response.status, 409);
  // Unknown generated scripts get a bound, then settle down to their actual length.
  const assistant = node('assistant', {
      message: 'Write a short narration',
      preset: 'script_writer',
    }),
    tts = node('voiceover');
  const pipeline = await create(
    [assistant, tts],
    [edge(assistant, tts, 'script')],
  );
  const bound = await request(
    `/spaces/${pipeline.id}/run/estimate`,
    'POST',
    {},
  );
  assert.equal(bound.upperBound, true);
  assert.equal(bound.units, 6);
  const pipelineRun = await request(`/spaces/${pipeline.id}/run`, 'POST', {});
  runIds.push(...pipelineRun.runIds);
  await until(
    async () =>
      (await request(`/spaces/${pipeline.id}/batches`)).find(
        (row) => row.batchId === pipelineRun.batchId,
      ).status === 'succeeded',
  );
  const actual = (
    await request(`/spaces/${pipeline.id}/runs?nodeId=${assistant.id}`)
  )[0].output.text;
  assert.equal(await ledger(pipelineRun.runIds), 1 + actual.length / 1000);
  assert((await ledger(pipelineRun.runIds)) < bound.units);
  const bad = node('image_generator', { prompt: '' });
  const failure = await create([bad]);
  const failed = await run(failure, bad.id);
  assert.equal(failed.status, 'failed');
  assert.equal(await ledger([failed.runId]), 0);
  assert.equal(
    (
      await db.query(
        "SELECT count(*) FROM usage_ledger WHERE run_id=$1 AND entry_type='refund'",
        [failed.runId],
      )
    ).rows[0].count,
    '1',
  );
  // Limit admission is atomic: no batch or node records survive a rejected request.
  for (const [count, params, reason] of [
    [101, { prompt: 'limit' }, 'provider nodes'],
    [65, { prompt: 'limit', count: 4, resolution: '4K' }, 'estimated credits'],
  ]) {
    const limited = await create(
      Array.from({ length: count }, () => node('image_generator', params)),
    );
    const estimate = await request(
      `/spaces/${limited.id}/run/estimate`,
      'POST',
      { force: true },
    );
    assert.equal(estimate.allowed, false);
    assert.match(estimate.limitMessage, new RegExp(reason));
    const denied = await fetch(`${base}/spaces/${limited.id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"force":true}',
    });
    assert.equal(denied.status, 422);
    assert.match((await denied.json()).message, new RegExp(reason));
    assert.equal(
      (
        await db.query('SELECT count(*) FROM node_runs WHERE space_id=$1', [
          limited.id,
        ])
      ).rows[0].count,
      '0',
    );
  }
  // Concurrent daily reservations use the production ledger code and an isolated test user.
  const isolated = randomUUID();
  const finance = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
  });
  await finance.initialize();
  try {
    const accounting = new costsModule.CostsService(
      finance,
      new ConfigService({
        DAILY_UNITS_LIMIT: 1,
        MAX_BATCH_UNITS: 1000,
        MAX_BATCH_PROVIDER_NODES: 100,
      }),
      {},
      {},
      {},
    );
    const testRuns = [];
    for (let index = 0; index < 2; index++) {
      const runId = randomUUID();
      await db.query(
        "INSERT INTO node_runs(id,space_id,node_id,node_type,status,input_hash,params) VALUES($1,$2,$3,'text','succeeded',$4,'{}')",
        [runId, id, randomUUID(), randomUUID()],
      );
      testRuns.push(runId);
      runIds.push(runId);
    }
    const attempts = await Promise.allSettled(
      testRuns.map((runId) =>
        finance.transaction((manager) =>
          accounting.reserve(manager, isolated, runId, 0.75),
        ),
      ),
    );
    assert.equal(
      attempts.filter((row) => row.status === 'fulfilled').length,
      1,
    );
    assert.equal(await ledger(testRuns), 0.75);
    const winner =
      testRuns[attempts.findIndex((row) => row.status === 'fulfilled')];
    await db.query(
      "UPDATE node_runs SET status='failed',budget_date=(now() AT TIME ZONE 'UTC')::date-1 WHERE id=$1",
      [winner],
    );
    await db.query(
      "UPDATE usage_ledger SET budget_date=(now() AT TIME ZONE 'UTC')::date-1 WHERE run_id=$1",
      [winner],
    );
    await accounting.refund(winner);
    await accounting.refund(winner);
    assert.equal(await ledger(testRuns), 0);
    assert.equal((await accounting.usage(isolated)).used, 0);
    assert.equal(
      (
        await db.query(
          "SELECT count(*) FROM usage_ledger WHERE run_id=$1 AND entry_type='refund'",
          [winner],
        )
      ).rows[0].count,
      '1',
    );
    await assert.rejects(
      () =>
        finance.transaction((manager) =>
          accounting.adjust(
            manager,
            testRuns[
              1 - attempts.findIndex((row) => row.status === 'fulfilled')
            ],
            1,
            true,
          ),
        ),
      /reserved estimate changed/,
    );
  } finally {
    await finance.destroy();
  }
  // Deleting a pending workflow refunds it; deleting completed work retains audit charges.
  const pendingVideo = node('video_generator', {
    prompt: 'Delete a pending video',
  });
  const deletion = await create([pendingVideo]);
  const pending = await request(
    `/spaces/${deletion.id}/nodes/${pendingVideo.id}/run`,
    'POST',
    {},
  );
  runIds.push(pending.runId);
  await until(
    async () =>
      (
        await db.query('SELECT provider_task_id FROM node_runs WHERE id=$1', [
          pending.runId,
        ])
      ).rows[0].provider_task_id,
  );
  assert.equal(await ledger([pending.runId]), 10);
  assert.equal(
    (await fetch(`${base}/spaces/${deletion.id}`, { method: 'DELETE' })).status,
    204,
  );
  assert.equal(await ledger([pending.runId]), 0);
  savedKeys.push(
    ...(
      await db.query('SELECT storage_key FROM assets WHERE space_id=$1', [id])
    ).rows.map((row) => row.storage_key),
  );
  assert.equal(
    (await fetch(`${base}/spaces/${id}`, { method: 'DELETE' })).status,
    204,
  );
  assert.equal(await ledger(started.runIds), quote.units);
  console.log(
    'Cost integration passed: exact mixed estimates/ledger, cached zero cost, upper-bound settlement, force/version guards, 422 admission rollback, failure/deletion refunds, concurrent daily quota and cross-day/idempotent refunds.',
  );
} finally {
  for (const spaceId of fixtures) {
    for (const row of (
      await db.query(
        "SELECT id FROM node_runs WHERE space_id=$1 AND status IN ('queued','running')",
        [spaceId],
      )
    ).rows)
      await fetch(`${base}/runs/${row.id}/cancel`, { method: 'POST' });
    savedKeys.push(
      ...(
        await db.query('SELECT storage_key FROM assets WHERE space_id=$1', [
          spaceId,
        ])
      ).rows.map((row) => row.storage_key),
    );
    runIds.push(
      ...(
        await db.query('SELECT id FROM node_runs WHERE space_id=$1', [spaceId])
      ).rows.map((row) => row.id),
    );
  }
  for (const key of new Set(savedKeys))
    await storage.send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
  if (runIds.length)
    await db.query('DELETE FROM usage_ledger WHERE run_id=ANY($1::uuid[])', [
      runIds,
    ]);
  for (const spaceId of fixtures)
    await db.query('DELETE FROM spaces WHERE id=$1', [spaceId]);
  storage.destroy();
  await db.end();
}
