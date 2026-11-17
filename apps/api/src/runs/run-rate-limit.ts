import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { DEV_USER_ID } from '../auth/current-user';
export const runRateLimit = {
  throttlers: [{ ttl: 60000, limit: 120 }],
  // Same fixed user identity as CurrentUser; replace both when introducing authentication.
  getTracker: () => DEV_USER_ID,
  generateKey: (_context, tracker, name) => `execution:${name}:${tracker}`,
} satisfies ThrottlerModuleOptions;
