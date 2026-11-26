// Offline CLI acceptance: fake only OAuth and provider HTTP; the actual adapter decodes MP4.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
const credentials = JSON.stringify({
  type: 'service_account',
  client_email: 'fixture@offline-project.iam.gserviceaccount.com',
  private_key: generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString(),
});
const preload = `
  import assert from 'node:assert/strict';
  import { createRequire } from 'node:module';
  const require = createRequire(process.cwd() + '/package.json');
  require('google-auth-library').JWT.prototype.getAccessToken = async () => ({ token: 'offline-token' });
  let submitted = false;
  const model = process.env.LIVE_CHECK_VIDEO_MODEL === 'veo-3-1' ? 'veo-3.1-generate-001' : 'veo-3.1-fast-generate-001';
  const prefix = 'projects/offline-project/locations/us-central1/publishers/google/models/' + model;
  const name = prefix + '/operations/offline-task';
  globalThis.fetch = async (url, init) => {
    assert.equal(init.method,'POST');
    assert.equal(init.headers.Authorization,'Bearer offline-token');
    const body = JSON.parse(init.body);
    const json = data => new Response(JSON.stringify(data),{ headers: { 'content-type':'application/json' } });
    if (String(url).endsWith(':predictLongRunning')) {
      assert.equal(String(url),'https://us-central1-aiplatform.googleapis.com/v1/' + prefix + ':predictLongRunning');
      assert.equal(submitted,false); submitted = true;
      assert.deepEqual(body.parameters,{sampleCount:1,durationSeconds:4,aspectRatio:'16:9',resolution:'720p',generateAudio:false});
      assert.deepEqual(body.instances,[{prompt:'A still landscape with gently moving clouds.'}]);
      return json({name});
    }
    assert.equal(String(url),'https://us-central1-aiplatform.googleapis.com/v1/' + prefix + ':fetchPredictOperation');
    assert(submitted); assert.deepEqual(body,{operationName:name});
    return json({name,done:true,response:{videos:[process.env.OFFLINE_GCS_RESULT === '1' ? {gcsUri:'gs://private/video.mp4',mimeType:'video/mp4'} : {mimeType:'video/mp4',bytesBase64Encoded:'AAAAFGZ0eXBpc29tAAAAAGlzb20='}]}});
  };
`;
const env = {
  ...process.env,
  HIVEFLOW_LIVE_CHECK: '1',
  GOOGLE_CLOUD_PROJECT_ID: 'offline-project',
  GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: credentials,
  OFFLINE_GCS_RESULT: '0',
};
for (const model of ['', 'veo-3-1']) {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      `data:text/javascript,${encodeURIComponent(preload)}`,
      'scripts/live-check.mjs',
      'veo',
    ],
    { encoding: 'utf8', env: { ...env, LIVE_CHECK_VIDEO_MODEL: model } },
  );
  assert.equal(result.status, 0, result.stderr);
  const rows = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(rows[0].status, 'accepted');
  assert.equal(rows[1].status, 'succeeded');
  assert.equal(rows[1].bytes, 20);
  assert.equal(rows[1].costUsd, null);
  assert(!result.stdout.includes('offline-token'));
  assert(!result.stdout.includes('PRIVATE KEY'));
}
const guardedEnv = { ...env };
delete guardedEnv.HIVEFLOW_LIVE_CHECK;
delete guardedEnv.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON;
const guard = spawnSync(process.execPath, ['scripts/live-check.mjs', 'veo'], {
  encoding: 'utf8',
  env: guardedEnv,
});
assert.equal(guard.status, 1);
assert.match(guard.stderr, /GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON/);
const unsupported = spawnSync(
  process.execPath,
  [
    '--import',
    `data:text/javascript,${encodeURIComponent(preload)}`,
    'scripts/live-check.mjs',
    'veo',
  ],
  {
    encoding: 'utf8',
    env: { ...env, LIVE_CHECK_VIDEO_MODEL: 'veo-3-1', OFFLINE_GCS_RESULT: '1' },
  },
);
assert.equal(unsupported.status, 1);
assert.match(unsupported.stderr, /Unsupported response/);
assert(!unsupported.stderr.includes('gs://private'));
console.log(
  'Veo CLI passed offline OAuth/submit/poll/MP4 decoding, model fallback, opt-in guards and unsupported-GCS exit status; no provider network.',
);
