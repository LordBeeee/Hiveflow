import { ProviderError } from './provider-error';
import { sanitizeMessage } from './provider-http';
// Official current API: /document-api/api/get-started/error-codes.
export function klingError(
  status: number,
  body: unknown,
  retryAfter?: string | null,
  model = 'Kling model',
) {
  const envelope =
    body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const code = Number(envelope.code);
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  const delay = retryAfter
    ? Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now()
    : NaN;
  const retryMs = Number.isFinite(delay) ? Math.max(0, delay) : undefined;
  if ([1000, 1001, 1002, 1003, 1004].includes(code) || status === 401)
    return new ProviderError(
      'unavailable',
      false,
      'The provider rejected the credentials; contact the administrator.',
    );
  if ([1101, 1102].includes(code))
    return new ProviderError(
      'insufficient_quota',
      false,
      'The provider balance or resource package is exhausted; contact the administrator.',
    );
  if (code === 1103 || code === 1203)
    return new ProviderError(
      'unavailable',
      false,
      `${model} is unavailable to this account. Check model/resource-package permissions in the Kling API developer console.`,
    );
  if (code === 1100 || code === 1304)
    return new ProviderError(
      'unavailable',
      false,
      code === 1304
        ? 'The provider rejected the server IP. Check the Kling API IP whitelist in the developer console.'
        : 'The provider account is unavailable; contact the administrator.',
    );
  if (code === 1301)
    return new ProviderError(
      'content_blocked',
      false,
      'The provider blocked this content. Revise the prompt or media.',
    );
  if (code === 1300)
    return new ProviderError(
      'invalid_request',
      false,
      'The request was blocked by provider policy. Check the request and account configuration.',
    );
  if (status === 429 || code === 1302 || code === 1303)
    return new ProviderError(
      'rate_limited',
      true,
      'The provider is rate limiting requests. Please retry shortly.',
      retryMs,
    );
  if (status >= 500 || [5000, 5001, 5002].includes(code))
    return new ProviderError(
      'unavailable',
      true,
      'The provider is temporarily unavailable. Please retry.',
      retryMs,
    );
  return new ProviderError(
    'invalid_request',
    false,
    sanitizeMessage(envelope.message),
  );
}
