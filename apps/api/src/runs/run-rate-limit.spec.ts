import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ThrottlerGuard, ThrottlerStorageService } from '@nestjs/throttler';
import { runRateLimit } from './run-rate-limit';
it('shares a per-user creation quota across handlers and IP addresses, returning 429', async () => {
  const storage = new ThrottlerStorageService();
  const guard = new ThrottlerGuard(
    { ...runRateLimit, throttlers: [{ ttl: 60000, limit: 2 }] },
    storage,
    new Reflector(),
  );
  function single() {}
  function batch() {}
  function context(ip: string, handler: () => void) {
    return new ExecutionContextHost(
      [{ ip, headers: {} }, { header: jest.fn() }],
      class Controller {},
      handler,
    );
  }
  try {
    expect(await guard.canActivate(context('127.0.0.1', single))).toBe(true);
    expect(await guard.canActivate(context('192.0.2.1', batch))).toBe(true);
    await expect(
      guard.canActivate(context('192.0.2.2', single)),
    ).rejects.toMatchObject({ status: 429 });
  } finally {
    storage.onApplicationShutdown();
  }
});
