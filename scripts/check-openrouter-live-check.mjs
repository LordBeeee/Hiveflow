// Offline CLI acceptance: the subprocess transport is replaced before the live-check starts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const preload = `
  import assert from 'node:assert/strict';
  import { readFile } from 'node:fs/promises';
  import { createRequire } from 'node:module';
  const require = createRequire(process.cwd() + '/package.json');
  const sharp = require('sharp');
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer();
  const audio = await readFile('apps/api/fixtures/silence.mp3');
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body) : {};
    const json = (value) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    if (path === '/api/v1/chat/completions') {
      assert(body.model.startsWith('openai/') || body.model.startsWith('google/'));
      assert.equal(body.stream, false);
      return json({ id: 'gen-offline-chat', choices: [{ message: { content: 'Hello' } }], usage: { cost: 0.001 } });
    }
    if (path === '/api/v1/images') {
      assert.equal(body.model, 'bytedance-seed/seedream-5-0-pro');
      return json({ id: 'gen-offline-image', data: [{ b64_json: image.toString('base64') }], usage: { cost: 0.01 } });
    }
    if (path === '/api/v1/audio/speech') {
      assert.equal(body.model, 'elevenlabs/eleven-v4');
      assert.equal(body.voice, 'george');
      return new Response(audio, { headers: { 'content-type': 'audio/mpeg', 'x-generation-id': 'gen-offline-speech' } });
    }
    if (path === '/api/v1/generation') return json({ data: { total_cost: 0.002 } });
    throw new Error('Unexpected request blocked by offline fixture');
  };
`;
const result = spawnSync(
  process.execPath,
  [
    '--import',
    `data:text/javascript,${encodeURIComponent(preload)}`,
    'scripts/live-check.mjs',
    'openrouter',
  ],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      HIVEFLOW_LIVE_CHECK: '1',
      OPENROUTER_API_KEY: 'offline-fixture',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      LIVE_CHECK_LLM_MODEL: '',
      LIVE_CHECK_IMAGE_MODEL: '',
      LIVE_CHECK_TTS_MODEL: '',
    },
  },
);
assert.equal(result.status, 0, result.stderr);
const rows = result.stdout
  .trim()
  .split('\n')
  .map((line) => JSON.parse(line));
assert.deepEqual(
  rows.map((row) => row.kind),
  ['llm', 'image', 'tts'],
);
assert.deepEqual(
  rows.map((row) => row.costUsd),
  [0.001, 0.01, 0.002],
);
assert(rows.every((row) => row.generationId.startsWith('gen-offline-')));
assert(!result.stdout.includes('offline-fixture'));
console.log(
  'Live-check CLI passed with three offline generation fixtures and a fixture cost lookup; no provider network.',
);
