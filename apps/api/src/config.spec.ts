import { validateEnvironment } from './config';
const env = { DATABASE_URL: 'postgresql://localhost/test' };
it('accepts zero budget limits and rejects negative limits', () => {
  const result = validateEnvironment({
    ...env,
    MAX_BATCH_PROVIDER_NODES: 0,
    MAX_BATCH_UNITS: 0,
    DAILY_UNITS_LIMIT: 0,
  });
  expect(result.MAX_BATCH_PROVIDER_NODES).toBe(0);
  expect(result.MAX_BATCH_UNITS).toBe(0);
  expect(result.DAILY_UNITS_LIMIT).toBe(0);
  for (const key of [
    'MAX_BATCH_PROVIDER_NODES',
    'MAX_BATCH_UNITS',
    'DAILY_UNITS_LIMIT',
  ])
    expect(() => validateEnvironment({ ...env, [key]: -1 })).toThrow(key);
});
it('uses per-kind deadlines and recovery above the largest timeout', () => {
  const result = validateEnvironment(env);
  expect(result.VIDEO_TIMEOUT_MS).toBe(900000);
  expect(result.IMAGE_TIMEOUT_MS).toBe(120000);
  expect(result.RUN_RECOVERY_TIMEOUT_MS).toBe(930000);
  expect(result.VIDEO_WORKER_CONCURRENCY).toBe(2);
  expect(() =>
    validateEnvironment({ ...env, RUN_RECOVERY_TIMEOUT_MS: 150000 }),
  ).toThrow('RUN_RECOVERY_TIMEOUT_MS');
  expect(
    validateEnvironment({ ...env, VIDEO_TIMEOUT_MS: 1800000 })
      .RUN_RECOVERY_TIMEOUT_MS,
  ).toBe(1830000);
  expect(
    validateEnvironment({ ...env, PROVIDER_TIMEOUT_MS: 3000 }).LLM_TIMEOUT_MS,
  ).toBe(3000);
});

it('validates optional provider config without requiring a key', () => {
  expect(
    validateEnvironment({
      ...env,
      OPENROUTER_API_KEY: '',
      OPENROUTER_BASE_URL: '',
      PROVIDER_CONCURRENCY_OPENROUTER: '',
      GOOGLE_CLOUD_PROJECT_ID: '',
      GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: '',
      PROVIDER_CONCURRENCY_VEO: '',
    }),
  ).toMatchObject({
    OPENROUTER_API_KEY: undefined,
    OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    PROVIDER_CONCURRENCY_OPENROUTER: 2,
    GOOGLE_CLOUD_PROJECT_ID: undefined,
    GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: undefined,
    PROVIDER_CONCURRENCY_VEO: 2,
  });
  for (const patch of [
    { ARK_API_KEY: 'bad\nkey' },
    { KLING_API_KEY: 'bad\nkey' },
    { GOOGLE_CLOUD_PROJECT_ID: '../project' },
    { GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: 'invalid-secret-json' },
    {
      GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: JSON.stringify({
        type: 'external_account',
      }),
    },
    { PROVIDER_CONCURRENCY_VEO: 0 },
    { KLING_BASE_URL: 'http://example.com' },
    { PROVIDER_CONCURRENCY_KLING: 0 },
    { ARK_BASE_URL: 'http://example.com' },
    { PROVIDER_CONCURRENCY_SEEDANCE: 0 },
    { OPENROUTER_API_KEY: 'bad\nkey' },
    { OPENROUTER_BASE_URL: 'http://example.com' },
    { OPENROUTER_BASE_URL: 'https://key@example.com' },
    { OPENROUTER_APP_URL: 'oops' },
    { HIVEFLOW_LIVE_CHECK: 'true' },
    { PROVIDER_CONCURRENCY_OPENROUTER: 0 },
  ])
    expect(() => validateEnvironment({ ...env, ...patch })).toThrow();
});
