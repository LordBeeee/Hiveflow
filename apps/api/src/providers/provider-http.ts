import { ProviderError } from './provider-error';
export type ErrorMapper = (
  status: number,
  body: unknown,
  retryAfter?: string | null,
  model?: string,
) => ProviderError;
export function redactHeaders(headers: HeadersInit) {
  return Object.fromEntries(
    [...new Headers(headers)].map(([key, value]) => [
      key,
      /authorization|api[-_]key|cookie/i.test(key) ? '[REDACTED]' : value,
    ]),
  );
}
export function sanitizeMessage(
  value: unknown,
  secrets: readonly string[] = [],
) {
  let message =
    typeof value === 'string' ? value : 'The provider rejected the request.';
  for (const secret of secrets)
    if (secret) message = message.split(secret).join('[REDACTED]');
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/(?:https?|gs):\/\/[^\s]+/gi, '[URL omitted]')
    .replace(/data:[^\s]+/gi, '[media omitted]')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char))
    .join('')
    .slice(0, 500);
}
export class ProviderHttp {
  constructor(
    private readonly config: {
      baseUrl: string;
      headers: Record<string, string>;
      mapError: ErrorMapper;
      timeoutMs?: number;
      maxResponseBytes?: number;
      embeddedErrors?: boolean;
    },
    private readonly transport: typeof fetch = fetch,
  ) {}
  error(
    status: number,
    body: unknown,
    retryAfter?: string | null,
    model?: string,
  ) {
    const error = this.config.mapError(status, body, retryAfter, model);
    const secrets = Object.entries(this.config.headers)
      .filter(([key]) => /authorization|key/i.test(key))
      .flatMap(([, value]) => [value, value.replace(/^Bearer /i, '')]);
    return new ProviderError(
      error.code,
      error.retryable,
      sanitizeMessage(error.userMessage, secrets),
      error.retryAfterMs,
    );
  }
  async post<T = unknown>(
    path: string,
    body: unknown,
    signal: AbortSignal,
    binary = false,
    model?: string,
  ) {
    return this.request<T>('POST', path, body, signal, binary, model);
  }
  get<T = unknown>(path: string, signal: AbortSignal, model?: string) {
    return this.request<T>('GET', path, undefined, signal, false, model);
  }
  delete<T = unknown>(path: string, signal: AbortSignal) {
    return this.request<T>('DELETE', path, undefined, signal);
  }
  private async request<T = unknown>(
    method: 'POST' | 'GET' | 'DELETE',
    path: string,
    body: unknown,
    signal: AbortSignal,
    binary = false,
    model?: string,
  ) {
    signal.throwIfAborted();
    const timeout = AbortSignal.timeout(this.config.timeoutMs ?? 120000);
    const combined = AbortSignal.any([signal, timeout]);
    try {
      const response = await this.transport(
        `${this.config.baseUrl.replace(/\/$/, '')}${path}`,
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...this.config.headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: combined,
          redirect: 'error',
        },
      );
      const limit = this.config.maxResponseBytes ?? 100 * 1024 * 1024;
      const reader = response.body?.getReader();
      const chunks: Buffer[] = [];
      let size = 0;
      if (reader)
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            combined.throwIfAborted();
            size += value.length;
            if (size > limit)
              throw new ProviderError(
                'unavailable',
                false,
                'The provider response exceeds the size limit.',
              );
            chunks.push(Buffer.from(value));
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
      const bytes = Buffer.concat(chunks);
      let json: unknown;
      const isJson =
        !binary ||
        !response.ok ||
        /json/i.test(response.headers.get('content-type') ?? '');
      if (isJson && bytes.length) {
        try {
          json = JSON.parse(bytes.toString('utf8')) as unknown;
        } catch {
          if (!response.ok)
            throw this.error(
              response.status,
              {},
              response.headers.get('retry-after'),
              model,
            );
          throw new ProviderError(
            'unavailable',
            false,
            'The provider returned an invalid JSON response.',
          );
        }
      }
      if (response.ok && isJson && !bytes.length && method !== 'DELETE')
        throw new ProviderError(
          'unavailable',
          false,
          'The provider returned an empty JSON response.',
        );
      const hasError =
        this.config.embeddedErrors !== false &&
        json !== null &&
        typeof json === 'object' &&
        'error' in json;
      if (!response.ok || hasError) {
        throw this.error(
          response.status,
          json,
          response.headers.get('retry-after'),
          typeof body === 'object' && body !== null && 'model' in body
            ? String(body.model)
            : model,
        );
      }
      return { data: (binary ? bytes : json) as T, headers: response.headers };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (timeout.aborted)
        throw new ProviderError(
          'timeout',
          false,
          'The provider request timed out. Please retry.',
        );
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        'unavailable',
        true,
        'The provider could not be reached. Please retry.',
      );
    }
  }
}
