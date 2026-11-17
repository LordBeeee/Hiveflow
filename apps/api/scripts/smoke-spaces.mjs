import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { ConfigModule } from '@nestjs/config';
import shared from '@hiveflow/shared';

await ConfigModule.forRoot({
  envFilePath: fileURLToPath(new URL('../../../.env', import.meta.url)),
});
const base = process.env.API_BASE_URL ?? 'http://127.0.0.1:3000';
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const owned = [];
const foreignId = randomUUID();
const ownerId = 'b5b48f38-1fb2-4a65-965d-f15253ec8b26';
async function request(path, method = 'GET', body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}
try {
  const graph = shared.emptyGraph();
  graph.nodes = [
    {
      id: randomUUID(),
      type: 'text',
      position: { x: 20, y: 30 },
      params: { value: 'integration prompt' },
    },
    ...[1, 2].map(() => ({
      id: randomUUID(),
      type: 'image_generator',
      position: { x: 500, y: 150 },
      params: { ...shared.nodeRegistry.image_generator.defaultParams },
    })),
  ];
  graph.edges = [
    {
      id: randomUUID(),
      source: graph.nodes[0].id,
      sourceHandle: 'text',
      target: graph.nodes[1].id,
      targetHandle: 'prompt',
    },
  ];
  graph.viewport = { x: -34, y: 21, zoom: 0.75 };
  const created = await request('/spaces', 'POST', {
    name: 'Phase 2 integration fixture',
    graph,
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  owned.push(id);
  assert.equal(created.body.version, 1);
  assert.deepEqual((await request(`/spaces/${id}`)).body.graph, graph);
  assert((await request('/spaces')).body.some((space) => space.id === id));
  const renamed = await request(`/spaces/${id}`, 'PATCH', {
    name: 'Renamed fixture',
    version: 1,
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.version, 2);
  assert.equal(
    (
      await request(`/spaces/${id}`, 'PATCH', {
        name: 'Stale edit',
        version: 1,
      })
    ).status,
    409,
  );
  const invalid = structuredClone(graph);
  invalid.nodes[1].params.count = 99;
  const rejected = await request(`/spaces/${id}`, 'PATCH', {
    graph: invalid,
    version: 2,
  });
  assert.equal(rejected.status, 400);
  assert(
    rejected.body.errors.some(
      (issue) => issue.path === 'graph.nodes.1.params.count',
    ),
  );
  const orphan = structuredClone(graph);
  orphan.edges[0].target = randomUUID();
  assert.equal(
    (await request(`/spaces/${id}`, 'PATCH', { graph: orphan, version: 2 }))
      .status,
    400,
  );
  const mismatch = structuredClone(graph);
  mismatch.edges[0].targetHandle = 'references';
  assert.equal(
    (await request(`/spaces/${id}`, 'PATCH', { graph: mismatch, version: 2 }))
      .status,
    400,
  );
  const cycle = structuredClone(graph);
  const [, a, b] = cycle.nodes;
  cycle.edges.push(
    {
      id: randomUUID(),
      source: a.id,
      sourceHandle: 'image',
      target: b.id,
      targetHandle: 'references',
    },
    {
      id: randomUUID(),
      source: b.id,
      sourceHandle: 'image',
      target: a.id,
      targetHandle: 'references',
    },
  );
  assert.equal(
    (await request(`/spaces/${id}`, 'PATCH', { graph: cycle, version: 2 }))
      .status,
    400,
  );
  assert.equal(
    (await request(`/spaces/${id}`, 'PATCH', { version: 2 })).status,
    400,
  );
  assert.equal(
    (
      await request('/spaces', 'POST', {
        graph: { ...graph, schemaVersion: 2 },
      })
    ).status,
    400,
  );
  const race = await Promise.all(
    ['A', 'B'].map((name) =>
      request(`/spaces/${id}`, 'PATCH', { name: `Race ${name}`, version: 2 }),
    ),
  );
  assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
  const winner = race.find((result) => result.status === 200).body;
  assert.equal(winner.version, 3);
  const reloaded = (await request(`/spaces/${id}`)).body;
  assert.equal(reloaded.name, winner.name);
  assert.equal(reloaded.version, 3);
  assert.deepEqual(reloaded.graph, graph);
  await client.query(
    'INSERT INTO spaces (id, user_id, name, graph) VALUES ($1, $2, $3, $4)',
    [
      foreignId,
      randomUUID(),
      'Foreign ownership fixture',
      JSON.stringify(shared.emptyGraph()),
    ],
  );
  assert.equal((await request(`/spaces/${foreignId}`)).status, 404);
  assert.equal(
    (
      await request(`/spaces/${foreignId}`, 'PATCH', {
        name: 'Forbidden',
        version: 1,
      })
    ).status,
    404,
  );
  assert.equal((await request(`/spaces/${foreignId}`, 'DELETE')).status, 404);
  assert(
    !(await request('/spaces')).body.some((space) => space.id === foreignId),
  );
  assert.equal((await request(`/spaces/${id}`, 'DELETE')).status, 204);
  assert.equal((await request(`/spaces/${id}`)).status, 404);
  console.log(
    'Spaces integration passed: CRUD, graph/viewport roundtrip, field errors, cycles, atomic 409 race, ownership.',
  );
} finally {
  // Delete only IDs generated by this smoke check, never existing workspace records.
  for (const id of owned)
    await client.query('DELETE FROM spaces WHERE id = $1 AND user_id = $2', [
      id,
      ownerId,
    ]);
  await client.query('DELETE FROM spaces WHERE id = $1', [foreignId]);
  await client.end();
}
