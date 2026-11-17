import { setTimeout as delay } from 'node:timers/promises';
export type ProviderErrorCode =
  | 'rate_limited'
  | 'invalid_request'
  | 'content_blocked'
  | 'insufficient_quota'
  | 'unavailable'
  | 'timeout'
  | 'canceled';
export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    public readonly retryable: boolean,
    public readonly userMessage: string,
    public readonly retryAfterMs?: number,
    public readonly taskId?: string,
  ) {
    super(userMessage);
  }
}
export async function withProviderRetries<T>(
  action: () => Promise<T>,
  options: {
    maxRetries: number;
    signal: AbortSignal;
    accepted?: () => boolean;
    wait?: (ms: number, signal: AbortSignal) => Promise<unknown>;
  },
) {
  const wait =
    options.wait ?? ((ms, signal) => delay(ms, undefined, { signal }));
  for (let attempt = 0; ; attempt++) {
    options.signal.throwIfAborted();
    try {
      return await action();
    } catch (error) {
      const network =
        error instanceof TypeError && /fetch|network/i.test(error.message);
      const retryable =
        error instanceof ProviderError
          ? error.retryable &&
            ['rate_limited', 'unavailable'].includes(error.code) &&
            !error.taskId
          : network;
      if (
        !retryable ||
        attempt >= options.maxRetries ||
        options.accepted?.() ||
        options.signal.aborted
      )
        throw error;
      const retryAfter =
        error instanceof ProviderError ? (error.retryAfterMs ?? 0) : 0;
      await wait(
        Math.max(
          retryAfter,
          300 * 2 ** attempt + Math.floor(Math.random() * 150),
        ),
        options.signal,
      );
    }
  }
}
