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
