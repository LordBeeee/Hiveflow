import { validateEnvironment } from './config';
const env = { DATABASE_URL: 'postgresql://localhost/test' };
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
