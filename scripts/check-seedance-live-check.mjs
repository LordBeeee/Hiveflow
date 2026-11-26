// Offline subprocess acceptance; replace both provider HTTP and the video downloader.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const preload = `
  import assert from 'node:assert/strict';
  import { createRequire } from 'node:module';
  import { Readable } from 'node:stream';
  const require = createRequire(process.cwd() + '/package.json');
  const downloader = require('./apps/api/dist/providers/safe-download.js');
  downloader.safeDownload = async (url, options) => {
    assert.equal(url, 'https://cdn.example/offline.mp4');
    assert.equal(options.maxBytes, 250 * 1024 * 1024);
    return { stream: Readable.from(['offline-mp4']), mime: 'video/mp4' };
  };
  let submitted = false;
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer offline-fixture');
    const path = new URL(url).pathname;
    const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    if (init.method === 'POST' && path === '/api/v3/contents/generations/tasks') {
      assert.equal(submitted, false, 'must not resubmit');
      submitted = true;
      const body = JSON.parse(init.body);
      assert.equal(body.duration, 4);
      assert.equal(body.resolution, '480p');
      assert.equal(body.generate_audio, false);
      assert.equal(body.execution_expires_after, 3600);
      assert.equal(body.model, process.env.LIVE_CHECK_VIDEO_MODEL === 'seedance-2-5' ? 'dreamina-seedance-2-5-260628' : 'dreamina-seedance-2-0-260128');
      return json({ id: 'offline-task' });
    }
    assert.equal(init.method, 'GET');
    assert.equal(path, '/api/v3/contents/generations/tasks/offline-task');
    assert(submitted);
    return json({ status: 'succeeded', content: { video_url: 'https://cdn.example/offline.mp4' }, usage: { completion_tokens: 123 } });
  };
`;
for (const model of ['', 'seedance-2-5']) {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(preload)}`,
      'scripts/live-check.mjs',
      'seedance',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        HIVEFLOW_LIVE_CHECK: '1',
        ARK_API_KEY: 'offline-fixture',
        ARK_BASE_URL: 'https://ark.example/api/v3',
        LIVE_CHECK_VIDEO_MODEL: model,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(rows[0].status, 'accepted');
  assert.equal(rows[1].status, 'succeeded');
  assert.equal(rows[1].bytes, 11);
  assert.equal(rows[1].outputTokens, 123);
  assert.equal(rows[1].costUsd, null);
  assert(!result.stdout.includes('offline-fixture'));
  assert(!result.stdout.includes('cdn.example'));
}
console.log(
  'Seedance live-check CLI passed offline for unset-default fallback and explicit 2.5; no provider network.',
);
