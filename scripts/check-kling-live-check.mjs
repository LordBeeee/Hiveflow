// Offline acceptance for the opt-in CLI, including byte-based image input and billing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
const directory = await mkdtemp(join(tmpdir(), 'hiveflow-kling-'));
const path = join(directory, 'image.png');
try {
  await sharp({
    create: { width: 300, height: 300, channels: 3, background: 'red' },
  })
    .png()
    .toFile(path);
  const preload = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { Readable } from 'node:stream';
    const require = createRequire(process.cwd() + '/package.json');
    require('./apps/api/dist/providers/safe-download.js').safeDownload = async (url, options) => {
      assert.equal(url, 'https://cdn.example/offline.mp4');
      assert.equal(options.maxBytes, 250 * 1024 * 1024);
      return { stream: Readable.from(['offline-mp4']), mime: 'video/mp4' };
    };
    let submitted = false;
    globalThis.fetch = async (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer offline-fixture');
      const path = new URL(url).pathname;
      const json = data => new Response(JSON.stringify({ code: 0, data }), { headers: { 'content-type': 'application/json' } });
      if (init.method === 'POST') {
        assert.equal(submitted, false); submitted = true;
        assert.equal(path, process.env.LIVE_CHECK_VIDEO_MODEL === 'kling-3-0' ? '/image-to-video/kling-3.0' : '/image-to-video/kling-3.0-turbo');
        const body = JSON.parse(init.body);
        assert.equal(body.settings.duration, 3);
        assert.equal(body.settings.resolution, '720p');
        assert.equal(body.contents[1].type, 'first_frame');
        assert(Buffer.from(body.contents[1].url, 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
        assert(!body.contents[1].url.includes('data:'));
        return json({ id: 'offline-task' });
      }
      assert.equal(init.method, 'GET'); assert(submitted);
      assert.equal(new URL(url).searchParams.get('task_ids'), 'offline-task');
      return json([{ id: 'offline-task', status: 'succeeded', outputs: [{ type: 'video', url: 'https://cdn.example/offline.mp4', duration: '3' }], billing: [{ charge_type: 'cash', amount: '0.1', currency: 'USD' }] }]);
    };
  `;
  for (const model of ['', 'kling-3-0']) {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(preload)}`,
        'scripts/live-check.mjs',
        'kling',
        path,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HIVEFLOW_LIVE_CHECK: '1',
          KLING_API_KEY: 'offline-fixture',
          KLING_BASE_URL: 'https://kling.example',
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
    assert.equal(rows[1].costUsd, 0.1);
    assert(!result.stdout.includes('offline-fixture'));
    assert(!result.stdout.includes('cdn.example'));
  }
  const env = { ...process.env };
  delete env.HIVEFLOW_LIVE_CHECK;
  delete env.KLING_API_KEY;
  const guard = spawnSync(
    process.execPath,
    ['scripts/live-check.mjs', 'kling', path],
    { env, encoding: 'utf8' },
  );
  assert.equal(guard.status, 1);
  assert.match(guard.stderr, /KLING_API_KEY/);
  const invalid = spawnSync(
    process.execPath,
    ['scripts/live-check.mjs', 'kling', join(directory, 'missing.png')],
    {
      encoding: 'utf8',
      env: {
        ...env,
        HIVEFLOW_LIVE_CHECK: '1',
        KLING_API_KEY: 'offline-fixture',
        LIVE_CHECK_VIDEO_MODEL: 'kling-3-0',
      },
    },
  );
  assert.equal(invalid.status, 1);
  assert(!invalid.stderr.includes('offline-fixture'));
  console.log(
    'Kling live-check CLI passed with offline submit/poll/download/billing fixtures and missing opt-in/key/file guards; no provider network.',
  );
} finally {
  await unlink(path).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await rmdir(directory);
}
