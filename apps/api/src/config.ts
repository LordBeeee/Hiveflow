export function validateEnvironment(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const port = Number(env.API_PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  if (
    typeof env.DATABASE_URL !== 'string' ||
    !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)
  ) {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${key} must be an integer between ${min} and ${max}`);
    return value;
  };
  const timeout = integer('PROVIDER_TIMEOUT_MS', 120000, 1000, 900000);
  const kindTimeouts = Object.fromEntries(
    ['IMAGE', 'LLM', 'TTS', 'VIDEO'].map((kind) => [
      `${kind}_TIMEOUT_MS`,
      integer(
        `${kind}_TIMEOUT_MS`,
        kind === 'VIDEO' ? 900000 : timeout,
        1000,
        3600000,
      ),
    ]),
  );
  const largestTimeout = Math.max(...Object.values(kindTimeouts));
  const failureRate = Number(env.MOCK_FAILURE_RATE ?? 0);
  if (!Number.isFinite(failureRate) || failureRate < 0 || failureRate > 1)
    throw new Error('MOCK_FAILURE_RATE must be between 0 and 1');
  const redis = String(env.REDIS_URL ?? 'redis://localhost:6379');
  const redisUrl = new URL(redis);
  if (
    !['redis:', 'rediss:'].includes(redisUrl.protocol) ||
    !/^\/?\d*$/.test(redisUrl.pathname)
  )
    throw new Error('REDIS_URL must be a Redis connection URL');
  const storage = (key: string, fallback: string) => {
    const value =
      env[key] ?? (env.NODE_ENV === 'production' ? undefined : fallback);
    if (typeof value !== 'string' || !value.trim())
      throw new Error(`${key} is required`);
    return value;
  };
  const providerLimits: Record<string, number> = {};
  for (const key of Object.keys(env).filter((key) =>
    /^PROVIDER_CONCURRENCY_[A-Z0-9_]+$/.test(key),
  ))
    providerLimits[key] = integer(key, 2, 1, 32);
  return {
    ...env,
    API_PORT: port,
    WEB_ORIGIN: env.WEB_ORIGIN ?? 'http://localhost:5173',
    REDIS_URL: redis,
    IMAGE_PROVIDER: env.IMAGE_PROVIDER ?? 'mock',
    MOCK_FAILURE_RATE: failureRate,
    PROVIDER_TIMEOUT_MS: timeout,
    ...kindTimeouts,
    VIDEO_WORKER_CONCURRENCY: integer('VIDEO_WORKER_CONCURRENCY', 2, 1, 32),
    RUN_RECOVERY_TIMEOUT_MS: integer(
      'RUN_RECOVERY_TIMEOUT_MS',
      largestTimeout + 30000,
      largestTimeout + 5000,
      7200000,
    ),
    MAX_UPLOAD_MB: integer('MAX_UPLOAD_MB', 20, 1, 100),
    WORKER_CONCURRENCY: integer('WORKER_CONCURRENCY', 6, 1, 32),
    SPACE_RUN_CONCURRENCY: integer('SPACE_RUN_CONCURRENCY', 3, 1, 32),
    PROVIDER_MAX_RETRIES: integer('PROVIDER_MAX_RETRIES', 2, 0, 5),
    PROVIDER_CONCURRENCY_MOCK: integer('PROVIDER_CONCURRENCY_MOCK', 2, 1, 32),
    ...providerLimits,
    KIND_CONCURRENCY_IMAGE: integer('KIND_CONCURRENCY_IMAGE', 6, 1, 32),
    KIND_CONCURRENCY_LLM: integer('KIND_CONCURRENCY_LLM', 6, 1, 32),
    KIND_CONCURRENCY_TTS: integer('KIND_CONCURRENCY_TTS', 6, 1, 32),
    KIND_CONCURRENCY_VIDEO: integer('KIND_CONCURRENCY_VIDEO', 2, 1, 32),
    MAX_AUDIO_MB: integer('MAX_AUDIO_MB', 25, 1, 1024),
    MAX_VIDEO_MB: integer('MAX_VIDEO_MB', 250, 1, 2048),
    ...Object.fromEntries(
      ['IMAGE', 'LLM', 'TTS', 'VIDEO'].map((kind) => [
        `DEFAULT_${kind}_MODEL`,
        env[`DEFAULT_${kind}_MODEL`] ??
          `mock-${kind === 'IMAGE' ? 'image' : kind.toLowerCase()}`,
      ]),
    ),
    S3_ENDPOINT: storage('S3_ENDPOINT', 'http://localhost:9000'),
    S3_REGION: storage('S3_REGION', 'us-east-1'),
    S3_BUCKET: storage('S3_BUCKET', 'hiveflow-assets'),
    S3_ACCESS_KEY: storage('S3_ACCESS_KEY', 'hiveflow'),
    S3_SECRET_KEY: storage('S3_SECRET_KEY', 'hiveflow-local-password'),
  };
}
