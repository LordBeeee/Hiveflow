// Isolated PostgreSQL schema + in-memory storage + registered mock providers only.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import pg from 'pg';
import sharp from 'sharp';
import shared from '@hiveflow/shared';

const require = createRequire(import.meta.url);
const load = (path, key) => require(`../dist/${path}.js`)[key];
const { databaseOptions } = require('../dist/database/options.js');
const Space = load('spaces/space.entity', 'SpaceEntity');
const Asset = load('assets/asset.entity', 'AssetEntity');
const Run = load('runs/node-run.entity', 'NodeRunEntity');
const SpacesService = load('spaces/spaces.service', 'SpacesService');
const AssetsService = load('assets/assets.service', 'AssetsService');
const RunsService = load('runs/runs.service', 'RunsService');
const ModelsService = load('providers/models.service', 'ModelsService');
const CostsService = load('runs/costs.service', 'CostsService');
const ProviderRegistry = load(
  'providers/provider-registry',
  'ProviderRegistry',
);
const CreationsController = load(
  'runs/creations.controller',
  'CreationsController',
);
const AssetsController = load('assets/assets.controller', 'AssetsController');
const ExecutionController = load(
  'runs/execution.controller',
  'ExecutionController',
);
const BatchesService = load('runs/batches.service', 'BatchesService');
const ModelsController = load('providers/models.service', 'ModelsController');
const RunsController = load('runs/runs.controller', 'RunsController');
const SpacesController = load('spaces/spaces.controller', 'SpacesController');
const user = { id: load('auth/current-user', 'DEV_USER_ID') };
await ConfigModule.forRoot({
  envFilePath: fileURLToPath(new URL('../../../.env', import.meta.url)),
});
const schema = `creations_test_${randomUUID().replaceAll('-', '')}`;
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
let db, app;
try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const migrationDir = fileURLToPath(
    new URL('../dist/database/migrations/', import.meta.url),
  );
  const migrations = readdirSync(migrationDir)
    .filter((name) => name.endsWith('.js'))
    .sort()
    .flatMap((name) =>
      Object.values(require(migrationDir + name)).filter(
        (value) => typeof value === 'function',
      ),
    );
  const options = {
    ...databaseOptions(process.env.DATABASE_URL),
    schema,
    extra: { options: `-c search_path=${schema},public` },
  };
  db = await new DataSource({
    ...options,
    migrations: migrations.slice(0, -1),
  }).initialize();
  await db.runMigrations();
  const legacy = await db.getRepository(Space).save({
    userId: user.id,
    name: 'Legacy workflow',
    graph: shared.emptyGraph(),
    schemaVersion: 1,
    version: 1,
  });
  await db.destroy();
  db = await new DataSource({ ...options, migrations }).initialize();
  await db.runMigrations();
  assert.equal(
    (
      await db.query('SELECT kind FROM execution_contexts WHERE id=$1', [
        legacy.id,
      ])
    )[0].kind,
    'space',
  );
  const config = new ConfigService({
    MOCK_FAILURE_RATE: 0,
    PROVIDER_MAX_RETRIES: 0,
    PROVIDER_TIMEOUT_MS: 60000,
    VIDEO_TIMEOUT_MS: 60000,
    SPACE_RUN_CONCURRENCY: 3,
    MAX_BATCH_PROVIDER_NODES: 100,
    MAX_BATCH_UNITS: 1000,
    DAILY_UNITS_LIMIT: 10000,
    RUN_RECOVERY_TIMEOUT_MS: 90000,
  });
  const objects = new Map();
  const storage = {
    put: async (key, bytes) => objects.set(key, Buffer.from(bytes)),
    get: async (key, range) => {
      const bytes = objects.get(key);
      if (!bytes) throw Error('Missing fixture object');
      const match = range && /bytes=(\d+)-(\d+)/.exec(range);
      return Readable.from([
        match ? bytes.subarray(Number(match[1]), Number(match[2]) + 1) : bytes,
      ]);
    },
    putStream: async (key, stream) => {
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
    },
    remove: async (key) => objects.delete(key),
    signedUrl: async (key) =>
      `data:image/png;base64,${objects.get(key).toString('base64')}`,
  };
  const spaces = new SpacesService(db.getRepository(Space));
  const assets = new AssetsService(
    db.getRepository(Asset),
    storage,
    spaces,
    config,
  );
  const providers = new ProviderRegistry();
  providers.register(
    'image',
    'mock',
    new (load('providers/mock-image.provider', 'MockImageProvider'))(
      config,
      async () => {},
    ),
  );
  providers.register(
    'tts',
    'mock',
    new (load('providers/mock-tts.provider', 'MockTtsProvider'))(
      config,
      async () => {},
    ),
  );
  const videoProvider = new (load(
    'providers/mock-video.provider',
    'MockVideoProvider',
  ))(config, db);
  const originalSubmit = videoProvider.submit.bind(videoProvider);
  videoProvider.submit = async (...args) => {
    const task = await originalSubmit(...args);
    await db.query(
      "UPDATE mock_video_tasks SET created_at=now()-interval '1 minute' WHERE id=$1",
      [task.taskId],
    );
    return task;
  };
  providers.register('video', 'mock-video', videoProvider);
  const models = new ModelsService(config, providers);
  const resolver = new (load('executors/input-resolver', 'InputResolver'))(
    db.getRepository(Run),
    assets,
  );
  const cache = new (load('runs/run-cache', 'RunCache'))(
    db.getRepository(Run),
    assets,
  );
  const costs = new CostsService(db, config, models, resolver, cache);
  const executors = [
    new (load('executors/image-generator.executor', 'ImageGeneratorExecutor'))(
      assets,
      providers,
      config,
    ),
    new (load('executors/voiceover.executor', 'VoiceoverExecutor'))(
      assets,
      providers,
      config,
    ),
    new (load('executors/video-generator.executor', 'VideoGeneratorExecutor'))(
      assets,
      providers,
      config,
    ),
  ];
  const queued = [];
  const events = new (load('runs/run-events', 'RunEvents'))();
  const runs = new RunsService(
    db.getRepository(Run),
    spaces,
    { enqueue: async (id) => queued.push(id), remove: async () => {} },
    events,
    config,
    { get: (type) => executors.find((executor) => executor.type === type) },
    resolver,
    cache,
    models,
    costs,
  );
  const batches = new BatchesService(
    db.getRepository(load('runs/batch.entity', 'BatchEntity')),
    db.getRepository(Run),
    spaces,
    runs,
    events,
    costs,
  );
  class Harness {}
  Module({
    imports: [
      ThrottlerModule.forRoot(load('runs/run-rate-limit', 'runRateLimit')),
    ],
    controllers: [
      CreationsController,
      AssetsController,
      ExecutionController,
      ModelsController,
      RunsController,
      SpacesController,
    ],
    providers: [
      { provide: DataSource, useValue: db },
      ...[
        [RunsService, runs],
        [AssetsService, assets],
        [ModelsService, models],
        [CostsService, costs],
        [SpacesService, spaces],
        [BatchesService, batches],
        [load('runs/run-events', 'RunEvents'), events],
      ].map(([provide, useValue]) => ({ provide, useValue })),
    ],
  })(Harness);
  app = await NestFactory.create(Harness, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function request(path, body, expected = 200) {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  }
  const contextsBefore = (
    await db.query('SELECT count(*)::int AS n FROM execution_contexts')
  )[0].n;
  for (const kind of shared.creationKinds)
    assert.equal((await request(`/creations/${kind}/runs`)).sessionId, null);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM execution_contexts'))[0].n,
    contextsBefore,
  );
  await request('/creations/unknown/runs', undefined, 400);
  const records = [];
  for (const kind of shared.creationKinds) {
    const params = structuredClone(
      shared.nodeRegistry[shared.creationNodeTypes[kind]].defaultParams,
    );
    params[kind === 'audio' ? 'script' : 'prompt'] = 'A quiet lake at sunrise';
    const input = { params };
    const quote = await request(`/creations/${kind}/estimate`, input, 201);
    await request(`/creations/${kind}/runs`, input, 409);
    const body = {
      ...input,
      approval: { fingerprint: quote.fingerprint, maxUnits: quote.units },
    };
    const { runId } = await request(`/creations/${kind}/runs`, body, 201);
    assert.equal(
      (await request(`/creations/${kind}/runs`, body, 201)).runId,
      runId,
    );
    await runs.process(runId);
    const history = shared.creationHistorySchema.parse(
      await request(`/creations/${kind}/runs`),
    );
    assert.equal(
      history.runs[0].status,
      'succeeded',
      history.runs[0].error ?? '',
    );
    assert.equal(history.runs[0].output[kind].length, 1);
    assert(!('spaceId' in history.runs[0]));
    assert.equal(
      await db.getRepository(Space).count(),
      1,
      'Standalone generation created a Space',
    );
    const output = history.runs[0].output[kind][0];
    const download = await fetch(`${base}/assets/${output.assetId}?download=1`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /^attachment;/);
    assert((await download.arrayBuffer()).byteLength > 0);
    const library = await request(`/assets?spaceId=${history.sessionId}`);
    assert.equal(library.items[0].sourceKind, kind);
    const cached = await request(`/creations/${kind}/runs`, body, 201);
    const cacheRow = await db
      .getRepository(Run)
      .findOneByOrFail({ id: cached.runId });
    assert.equal(cacheRow.cacheHit, true);
    const fresh = await request(
      `/creations/${kind}/runs`,
      { ...body, force: true },
      201,
    );
    await request(`/runs/${fresh.runId}/cancel`, {}, 201);
    assert.equal(
      (await db.getRepository(Run).findOneByOrFail({ id: fresh.runId })).status,
      'canceled',
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM usage_ledger WHERE run_id=$1 AND entry_type='refund'",
          [fresh.runId],
        )
      )[0].n,
      1,
    );
    await request(
      `/creations/${kind}/runs`,
      {
        ...body,
        params: {
          ...params,
          [kind === 'audio' ? 'script' : 'prompt']: 'Changed content',
        },
      },
      409,
    );
    records.push({ kind, sessionId: history.sessionId, body, output });
  }
  const image = records[0];
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#7260c2' },
  })
    .png()
    .toBuffer();
  const uploaded = await assets.upload(
    user,
    image.sessionId,
    bytes,
    'image/png',
  );
  const refQuote = await request(
    '/creations/image/estimate',
    { params: image.body.params, references: [uploaded.id] },
    201,
  );
  const refRun = await request(
    '/creations/image/runs',
    {
      params: image.body.params,
      references: [uploaded.id],
      approval: { fingerprint: refQuote.fingerprint, maxUnits: refQuote.units },
    },
    201,
  );
  await runs.process(refRun.runId);
  assert.equal(
    (await db.getRepository(Run).findOneByOrFail({ id: refRun.runId })).status,
    'succeeded',
  );
  const foreignUser = { id: randomUUID() };
  const foreignSession = await new CreationsController(
    db,
    runs,
    models,
    costs,
    assets,
  ).session(foreignUser, 'image');
  const foreignAsset = await assets.upload(
    foreignUser,
    foreignSession.sessionId,
    bytes,
    'image/png',
  );
  await request(
    '/creations/image/estimate',
    { params: image.body.params, references: [foreignAsset.id] },
    404,
  );
  assert.equal((await fetch(`${base}/assets/${foreignAsset.id}`)).status, 404);
  assert(
    !(await request('/assets?limit=100')).items.some(
      (item) => item.asset.id === foreignAsset.id,
    ),
  );
  const workflowNode = {
    id: randomUUID(),
    type: 'image_generator',
    position: { x: 0, y: 0 },
    params: image.body.params,
  };
  await db.getRepository(Space).update(legacy.id, {
    graph: { ...shared.emptyGraph(), nodes: [workflowNode] },
  });
  const workflow = await runs.start(user, legacy.id, workflowNode.id);
  await runs.process(workflow.runId);
  assert.equal((await runs.history(user, legacy.id))[0].status, 'succeeded');
  await db.getRepository(Space).delete(legacy.id);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM execution_contexts WHERE id=$1',
        [legacy.id],
      )
    )[0].n,
    0,
  );
  assert.equal((await request('/assets?spaceId=' + legacy.id)).total, 0);
  console.log(
    'PASS: isolated migration/backfill, read-only page entry, all three real mock executors, no hidden Spaces, dedup/cache, cost approval/refund, reference upload, ownership, Library/downloads and existing workflow execution/deletion.',
  );
  if (process.argv.includes('--serve')) {
    const running = new Set();
    const timer = setInterval(() => {
      for (const id of queued.splice(0)) {
        if (running.has(id)) continue;
        running.add(id);
        void runs.process(id).finally(() => running.delete(id));
      }
    }, 100);
    console.log(`CREATIONS_TEST_API=${base}`);
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    clearInterval(timer);
  }
} finally {
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy();
  await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await admin.end();
}
