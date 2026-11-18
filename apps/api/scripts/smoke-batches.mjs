import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigModule } from '@nestjs/config';
import pg from 'pg';
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
async function request(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  const value = await response.json();
  assert(response.ok, `${response.status}: ${JSON.stringify(value)}`);
  return value;
}
async function until(check, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error('Batch integration condition timed out');
}
const generator = (prompt) => ({
  id: randomUUID(),
  type: 'image_generator',
  params: { ...shared.nodeRegistry.image_generator.defaultParams, prompt },
  position: { x: 0, y: 0 },
});
const edge = (source, target, targetHandle) => ({
  id: randomUUID(),
  source: source.id,
  sourceHandle: source.type === 'text' ? 'text' : 'image',
  target: target.id,
  targetHandle,
});
async function create(graph) {
  const space = await request('/spaces', {
    name: 'Phase 5 integration fixture',
    graph,
  });
  fixtures.push(space.id);
  return space.id;
}
const batchRows = async (batchId) =>
  (
    await db.query(
      'SELECT * FROM node_runs WHERE batch_id=$1 ORDER BY sequence',
      [batchId],
    )
  ).rows;
async function complete(spaceId, batchId) {
  return until(async () => {
    const batch = (await request(`/spaces/${spaceId}/batches`)).find(
      (batch) => batch.batchId === batchId,
    );
    return batch.status !== 'running' && batch;
  });
}
try {
  const graph = shared.emptyGraph();
  const text = {
    id: randomUUID(),
    type: 'text',
    params: { value: 'Batch alpine cabin prompt' },
    position: { x: 0, y: 0 },
  };
  const a = generator('local override');
  const b = generator('Chained reference');
  const roots = Array.from({ length: 4 }, (_, index) =>
    generator(`Independent root ${index}`),
  );
  graph.nodes = [text, ...roots, a, b];
  graph.edges = [edge(text, a, 'prompt'), edge(a, b, 'references')];
  const spaceId = await create(graph);
  const starts = await Promise.all([
    request(`/spaces/${spaceId}/run`, { force: true }),
    request(`/spaces/${spaceId}/run`, { force: true }),
  ]);
  assert.equal(starts[0].batchId, starts[1].batchId);
  assert.equal(starts[0].runIds.length, graph.nodes.length);
  let maxParallel = 0;
  await until(async () => {
    const rows = await batchRows(starts[0].batchId);
    const running = rows.filter((run) => run.status === 'running').length;
    maxParallel = Math.max(maxParallel, running);
    assert(running <= Number(process.env.SPACE_RUN_CONCURRENCY ?? 3));
    assert(running <= Number(process.env.WORKER_CONCURRENCY ?? 6));
    return rows.every((run) => !['queued', 'running'].includes(run.status));
  });
  assert(
    maxParallel >=
      Math.min(
        2,
        Number(process.env.SPACE_RUN_CONCURRENCY ?? 3),
        Number(process.env.WORKER_CONCURRENCY ?? 6),
      ),
    'Independent nodes should run concurrently within configured limits',
  );
  assert.equal(
    (await complete(spaceId, starts[0].batchId)).status,
    'succeeded',
  );
  const first = await batchRows(starts[0].batchId);
  assert(
    first.every((run) => run.status === 'succeeded'),
    JSON.stringify(first.map((run) => run.error)),
  );
  const aRun = first.find((run) => run.node_id === a.id);
  const bRun = first.find((run) => run.node_id === b.id);
  const levelZero = first.filter((run) => run.level === 0);
  assert(
    aRun.started_at >=
      new Date(Math.max(...levelZero.map((run) => run.finished_at.getTime()))),
  );
  assert(bRun.started_at >= aRun.finished_at);
  assert.equal(aRun.inputs.ports.prompt[0].value, text.params.value);
  assert.equal(
    bRun.inputs.ports.references[0].assetId,
    aRun.output.image[0].assetId,
  );
  const now = Date.now();
  const cached = await request(`/spaces/${spaceId}/run`, {});
  assert.equal((await complete(spaceId, cached.batchId)).status, 'succeeded');
  const cacheRows = await batchRows(cached.batchId);
  assert(cacheRows.every((run) => run.cache_hit && run.started_at === null));
  assert(
    Date.now() - now < 2500,
    'Cached batch should finish without provider delay',
  );
  assert.equal(
    cacheRows.find((run) => run.node_id === a.id).output.image[0].assetId,
    aRun.output.image[0].assetId,
  );
  const forced = await request(`/spaces/${spaceId}/nodes/${a.id}/run`, {
    force: true,
  });
  const forcedRow = await until(async () => {
    const row = (
      await db.query('SELECT * FROM node_runs WHERE id=$1', [forced.runId])
    ).rows[0];
    return row.status === 'succeeded' && row;
  });
  assert.equal(forcedRow.cache_hit, false);
  assert.notEqual(
    forcedRow.output.image[0].assetId,
    aRun.output.image[0].assetId,
  );
  const singleCache = await request(`/spaces/${spaceId}/nodes/${a.id}/run`, {});
  assert.equal(
    (await request(`/spaces/${spaceId}/runs?nodeId=${a.id}`))[0].runId,
    singleCache.runId,
  );
  assert.equal(
    (
      await db.query('SELECT cache_hit FROM node_runs WHERE id=$1', [
        singleCache.runId,
      ])
    ).rows[0].cache_hit,
    true,
  );
  const cancelOne = await request(`/spaces/${spaceId}/nodes/${a.id}/run`, {
    force: true,
  });
  await until(
    async () =>
      (
        await db.query('SELECT status FROM node_runs WHERE id=$1', [
          cancelOne.runId,
        ])
      ).rows[0].status === 'running',
  );
  const missingUpload = {
    id: randomUUID(),
    type: 'image_upload',
    params: { assetId: null },
    position: { x: 0, y: 0 },
  };
  graph.nodes.push(missingUpload);
  graph.edges.push(edge(missingUpload, a, 'references'));
  async function saveGraph() {
    const version = (await request(`/spaces/${spaceId}`)).version;
    const response = await fetch(`${base}/spaces/${spaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph, version }),
    });
    assert.equal(response.status, 200);
  }
  await saveGraph();
  const invalidInput = await request(
    `/spaces/${spaceId}/nodes/${a.id}/run`,
    {},
  );
  assert.notEqual(
    invalidInput.runId,
    cancelOne.runId,
    'Missing connected output must not deduplicate into valid active work',
  );
  await until(
    async () =>
      (
        await db.query('SELECT status FROM node_runs WHERE id=$1', [
          invalidInput.runId,
        ])
      ).rows[0].status === 'failed',
  );
  graph.nodes.pop();
  graph.edges.pop();
  await saveGraph();
  await request(`/runs/${cancelOne.runId}/cancel`, {});
  assert.equal(
    (
      await db.query('SELECT status FROM node_runs WHERE id=$1', [
        cancelOne.runId,
      ])
    ).rows[0].status,
    'canceled',
  );
  const canceled = await request(`/spaces/${spaceId}/run`, { force: true });
  await until(async () =>
    (await batchRows(canceled.batchId)).some((run) => run.status === 'running'),
  );
  await request(`/batches/${canceled.batchId}/cancel`, {});
  const canceledRows = await batchRows(canceled.batchId);
  assert(
    canceledRows.some((run) => run.status === 'canceled' && !run.prepared),
  );
  assert(
    canceledRows.every((run) => !['queued', 'running'].includes(run.status)),
  );
  await delay(4500);
  assert.equal((await complete(spaceId, canceled.batchId)).status, 'canceled');
  assert(
    (await batchRows(canceled.batchId))
      .filter((run) => run.status === 'canceled')
      .every((run) => run.output === null),
  );
  const broken = shared.emptyGraph();
  const bad = generator('');
  const child = generator('depends on failure');
  const independent = generator('independent success');
  broken.nodes = [bad, child, independent];
  broken.edges = [edge(bad, child, 'references')];
  const brokenId = await create(broken);
  const failedBatch = await request(`/spaces/${brokenId}/run`, { force: true });
  assert.equal(
    (await complete(brokenId, failedBatch.batchId)).status,
    'failed',
  );
  const failedRows = await batchRows(failedBatch.batchId);
  assert.equal(
    failedRows.find((run) => run.node_id === bad.id).status,
    'failed',
  );
  assert.equal(
    failedRows.find((run) => run.node_id === child.id).status,
    'skipped',
  );
  assert.equal(
    failedRows.find((run) => run.node_id === child.id).started_at,
    null,
  );
  assert.equal(
    failedRows.find((run) => run.node_id === independent.id).status,
    'succeeded',
  );
  const parallelGraph = shared.emptyGraph();
  parallelGraph.nodes = Array.from({ length: 4 }, (_, index) =>
    generator(`Across Space ${index}`),
  );
  const parallelSpaces = await Promise.all([
    create(parallelGraph),
    create(parallelGraph),
  ]);
  const parallelBatches = await Promise.all(
    parallelSpaces.map((id) => request(`/spaces/${id}/run`, { force: true })),
  );
  let globalPeak = 0;
  await until(async () => {
    const rows = (
      await db.query(
        'SELECT space_id,status FROM node_runs WHERE batch_id=ANY($1::uuid[])',
        [parallelBatches.map((batch) => batch.batchId)],
      )
    ).rows;
    const active = rows.filter((row) => row.status === 'running');
    globalPeak = Math.max(globalPeak, active.length);
    assert(active.length <= Number(process.env.WORKER_CONCURRENCY ?? 6));
    for (const id of parallelSpaces)
      assert(
        active.filter((row) => row.space_id === id).length <=
          Number(process.env.SPACE_RUN_CONCURRENCY ?? 3),
      );
    return rows.every((row) => !['queued', 'running'].includes(row.status));
  });
  assert(globalPeak > 0);
  for (const [index, batch] of parallelBatches.entries())
    assert.equal(
      (await complete(parallelSpaces[index], batch.batchId)).status,
      'succeeded',
    );
  // Simulate persisted work from a stopped API: no in-memory coordinator or queue enqueue.
  const recoveryGraph = shared.emptyGraph();
  const recoveredNode = generator('Recovered persisted batch');
  recoveryGraph.nodes = [recoveredNode];
  const recoverySpace = await create(recoveryGraph);
  await db.query('BEGIN');
  const recoveredBatch = (
    await db.query(
      "INSERT INTO batches(space_id,graph,levels,status) VALUES($1,$2,$3,'running') RETURNING id",
      [
        recoverySpace,
        JSON.stringify(recoveryGraph),
        JSON.stringify([[recoveredNode.id]]),
      ],
    )
  ).rows[0].id;
  const recoveredRun = await db.query(
    "INSERT INTO node_runs(space_id,batch_id,node_id,node_type,status,input_hash,params,prepared,level,cost_reserved,cost_provider,cost_units) VALUES($1,$2,$3,'image_generator','queued',$4,$5,false,0,true,true,$6) RETURNING id",
    [
      recoverySpace,
      recoveredBatch,
      recoveredNode.id,
      `pending:${recoveredBatch}`,
      JSON.stringify(recoveredNode.params),
      shared.estimateModelUnits(
        shared.findModel('mock-image'),
        recoveredNode.params,
        { ports: {} },
      ),
    ],
  );
  await db.query(
    "INSERT INTO usage_ledger(user_id,run_id,units,entry_type,budget_date) SELECT cost_user_id,id,cost_units,'reserve',budget_date FROM node_runs WHERE id=$1",
    [recoveredRun.rows[0].id],
  );
  await db.query('COMMIT');
  assert.equal(
    (await complete(recoverySpace, recoveredBatch)).status,
    'succeeded',
  );
  const foreignUser = randomUUID();
  await db.query('UPDATE spaces SET user_id=$1 WHERE id=$2', [
    foreignUser,
    brokenId,
  ]);
  for (const path of [
    `/spaces/${brokenId}/run`,
    `/batches/${failedBatch.batchId}/cancel`,
    `/runs/${failedRows[0].id}/cancel`,
  ]) {
    assert.equal(
      (
        await fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      404,
    );
  }
  console.log(
    'Batch integration passed: atomic batch deduplication, parallelism limits, level barriers, batch-local inputs, instant cache, force bypass, node/batch cancellation with discarded late output, failure propagation and ownership.',
  );
} finally {
  for (const id of fixtures) {
    const active = (
      await db.query(
        "SELECT id FROM batches WHERE space_id=$1 AND status='running'",
        [id],
      )
    ).rows;
    for (const batch of active)
      await fetch(`${base}/batches/${batch.id}/cancel`, { method: 'POST' });
    for (const asset of (
      await db.query('SELECT storage_key FROM assets WHERE space_id=$1', [id])
    ).rows)
      await storage.send(
        new DeleteObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: asset.storage_key,
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
