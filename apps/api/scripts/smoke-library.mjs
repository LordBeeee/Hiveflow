// Real PostgreSQL + isolated HTTP controller; no workers, providers or object writes.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import shared from '@hiveflow/shared';

const require = createRequire(import.meta.url);
const { AssetEntity } = require('../dist/assets/asset.entity.js');
const { SpaceEntity } = require('../dist/spaces/space.entity.js');
const { AssetsService } = require('../dist/assets/assets.service.js');
const { AssetsController } = require('../dist/assets/assets.controller.js');
const { SpacesService } = require('../dist/spaces/spaces.service.js');
const { DEV_USER_ID } = require('../dist/auth/current-user.js');
await ConfigModule.forRoot({
  envFilePath: fileURLToPath(new URL('../../../.env', import.meta.url)),
});
const db = await new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [SpaceEntity, AssetEntity],
  synchronize: false,
}).initialize();
const spaceIds = [randomUUID(), randomUUID(), randomUUID()];
let app;
try {
  const spaces = db.getRepository(SpaceEntity);
  const assets = db.getRepository(AssetEntity);
  await spaces.save(
    spaceIds.map((id, i) => ({
      id,
      name: `Library fixture ${i}`,
      userId: i === 2 ? randomUUID() : DEV_USER_ID,
      graph: shared.emptyGraph(),
      schemaVersion: 1,
      version: 1,
    })),
  );
  const bytes = Buffer.from('offline library download fixture');
  const fixtures = ['image', 'video', 'audio', 'image', 'image'].map(
    (kind, i) => ({
      id: randomUUID(),
      spaceId: spaceIds[i === 4 ? 2 : i === 3 ? 1 : 0],
      kind,
      storageKey: `library-fixture/${randomUUID()}`,
      url: '',
      mime: { image: 'image/png', video: 'video/mp4', audio: 'audio/wav' }[
        kind
      ],
      sizeBytes: bytes.length,
      width: kind === 'audio' ? null : 32,
      height: kind === 'audio' ? null : 32,
      durationMs: kind === 'image' ? null : 1000,
      sha256: 'a'.repeat(64),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    }),
  );
  for (const fixture of fixtures) fixture.url = `/api/assets/${fixture.id}`;
  await assets.save(fixtures);
  const storage = { get: async () => Readable.from([bytes]) };
  const service = new AssetsService(assets, storage, new SpacesService(spaces));
  class LibraryHarness {}
  Module({
    controllers: [AssetsController],
    providers: [{ provide: AssetsService, useValue: service }],
  })(LibraryHarness);
  app = await NestFactory.create(LibraryHarness, { logger: false });
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  async function list(query) {
    const response = await fetch(`${base}/assets?${query}`);
    assert.equal(response.status, 200);
    return shared.libraryPageSchema.parse(await response.json());
  }
  const owned = await list(`spaceId=${spaceIds[0]}&limit=2`);
  assert.equal(owned.total, 3);
  assert.equal(owned.items.length, 2);
  assert(owned.items.every((item) => item.spaceName === 'Library fixture 0'));
  const tail = await list(`spaceId=${spaceIds[0]}&limit=2&offset=2`);
  const ids = [...owned.items, ...tail.items].map((item) => item.asset.id);
  assert.deepEqual(
    ids,
    fixtures
      .slice(0, 3)
      .map((item) => item.id)
      .sort()
      .reverse(),
  );
  for (const kind of ['image', 'video', 'audio']) {
    const filtered = await list(`spaceId=${spaceIds[0]}&kind=${kind}`);
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].asset.kind, kind);
  }
  const global = await list('limit=100');
  assert(!global.items.some((item) => item.asset.id === fixtures[4].id));
  const foreign = await list(`spaceId=${spaceIds[2]}`);
  assert.equal(foreign.total, 0);
  assert.deepEqual(foreign.items, []);
  for (const invalid of [
    'limit=0',
    'limit=101',
    'offset=-1',
    'offset=1.5',
    'kind=text',
    'spaceId=invalid',
    'offset=NaN',
  ]) {
    assert.equal(
      (await fetch(`${base}/assets?${invalid}`)).status,
      400,
      invalid,
    );
  }
  const download = await fetch(`${base}/assets/${fixtures[0].id}?download=1`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /^attachment;/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const inline = await fetch(`${base}/assets/${fixtures[0].id}`);
  assert.match(inline.headers.get('content-disposition'), /^inline;/);
  await inline.arrayBuffer();
  assert.equal(
    (await fetch(`${base}/assets/${fixtures[4].id}?download=1`)).status,
    404,
  );
  await spaces.delete(spaceIds[0]);
  assert.equal((await list(`spaceId=${spaceIds[0]}`)).total, 0);
  console.log(
    'Library passed: real SQL ownership, kind/Space filters, stable pagination, validation, download headers/bytes, foreign access denied and deleted Space exclusion.',
  );
} finally {
  if (app) await app.close();
  await db.getRepository(SpaceEntity).delete(spaceIds);
  await db.destroy();
}
