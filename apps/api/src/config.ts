import { veoProjectId, veoServiceAccount } from './providers/veo-auth';
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
    providerLimits[key] = env[key] === '' ? 2 : integer(key, 2, 1, 32);
  const optionalText = (key: string) => {
    const value = env[key];
    if (value === undefined || value === '') return undefined;
    if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value))
      throw new Error(`${key} must be a nonempty single-line string`);
    return value.trim();
  };
  const httpUrl = (key: string, fallback?: string) => {
    const value = optionalText(key) ?? fallback;
    if (!value) return undefined;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${key} must be an HTTPS URL`);
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        `${key} must be an HTTPS URL without credentials, query or fragment`,
      );
    return value.replace(/\/$/, '');
  };
  const liveCheck = optionalText('HIVEFLOW_LIVE_CHECK');
  const googleProject = optionalText('GOOGLE_CLOUD_PROJECT_ID');
  if (googleProject) veoProjectId(googleProject);
  const googleCredentials = env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON;
  if (googleCredentials !== undefined && googleCredentials !== '') {
    if (typeof googleCredentials !== 'string')
      throw new Error(
        'GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON must be a service-account JSON string.',
      );
    veoServiceAccount(googleCredentials);
  }
  if (liveCheck !== undefined && liveCheck !== '0' && liveCheck !== '1')
    throw new Error('HIVEFLOW_LIVE_CHECK must be 0 or 1');
  return {
    ...env,
    HIVEFLOW_LIVE_CHECK: liveCheck ?? '0',
    GOOGLE_CLOUD_PROJECT_ID: googleProject,
    GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON: googleCredentials || undefined,
    ARK_API_KEY: optionalText('ARK_API_KEY'),
    KLING_API_KEY: optionalText('KLING_API_KEY'),
    KLING_BASE_URL: httpUrl(
      'KLING_BASE_URL',
      'https://api-singapore.klingai.com',
    ),
    ARK_BASE_URL: httpUrl(
      'ARK_BASE_URL',
      'https://ark.ap-southeast.bytepluses.com/api/v3',
    ),
    OPENROUTER_API_KEY: optionalText('OPENROUTER_API_KEY'),
    OPENROUTER_APP_NAME: optionalText('OPENROUTER_APP_NAME'),
    OPENROUTER_APP_URL: httpUrl('OPENROUTER_APP_URL'),
    OPENROUTER_BASE_URL: httpUrl(
      'OPENROUTER_BASE_URL',
      'https://openrouter.ai/api/v1',
    ),
    API_PORT: port,
    WEB_ORIGIN: env.WEB_ORIGIN ?? 'http://localhost:5173',
    REDIS_URL: redis,
    PROVIDER_TIMEOUT_MS: timeout,
    ...kindTimeouts,
    VIDEO_WORKER_CONCURRENCY: integer('VIDEO_WORKER_CONCURRENCY', 2, 1, 32),
    RUN_RECOVERY_TIMEOUT_MS: integer(
      'RUN_RECOVERY_TIMEOUT_MS',
      largestTimeout + 30000,
      largestTimeout + 5000,
      7200000,
    ),
    MAX_BATCH_PROVIDER_NODES: integer('MAX_BATCH_PROVIDER_NODES', 100, 0, 1000),
    MAX_BATCH_UNITS: integer('MAX_BATCH_UNITS', 1000, 0, 1000000000),
    DAILY_UNITS_LIMIT: integer('DAILY_UNITS_LIMIT', 10000, 0, 1000000000),
    MAX_UPLOAD_MB: integer('MAX_UPLOAD_MB', 20, 1, 100),
    WORKER_CONCURRENCY: integer('WORKER_CONCURRENCY', 6, 1, 32),
    SPACE_RUN_CONCURRENCY: integer('SPACE_RUN_CONCURRENCY', 3, 1, 32),
    PROVIDER_MAX_RETRIES: integer('PROVIDER_MAX_RETRIES', 2, 0, 5),
    ...providerLimits,
    KIND_CONCURRENCY_IMAGE: integer('KIND_CONCURRENCY_IMAGE', 6, 1, 32),
    KIND_CONCURRENCY_LLM: integer('KIND_CONCURRENCY_LLM', 6, 1, 32),
    KIND_CONCURRENCY_TTS: integer('KIND_CONCURRENCY_TTS', 6, 1, 32),
    KIND_CONCURRENCY_VIDEO: integer('KIND_CONCURRENCY_VIDEO', 2, 1, 32),
    MAX_AUDIO_MB: integer('MAX_AUDIO_MB', 25, 1, 1024),
    MAX_VIDEO_MB: integer('MAX_VIDEO_MB', 250, 1, 2048),
    S3_ENDPOINT: storage('S3_ENDPOINT', 'http://localhost:9000'),
    S3_REGION: storage('S3_REGION', 'us-east-1'),
    S3_BUCKET: storage('S3_BUCKET', 'hiveflow-assets'),
    S3_ACCESS_KEY: storage('S3_ACCESS_KEY', 'hiveflow'),
    S3_SECRET_KEY: storage('S3_SECRET_KEY', 'hiveflow-local-password'),
  };
}
