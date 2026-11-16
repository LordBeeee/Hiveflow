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
  return {
    ...env,
    API_PORT: port,
    WEB_ORIGIN: env.WEB_ORIGIN ?? 'http://localhost:5173',
  };
}
