import { ProviderError } from './provider-error';
import { sanitizeMessage } from './provider-http';
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function openrouterError(
  status: number,
  body: unknown,
  retryAfter?: string | null,
  model = 'selected model',
) {
  const error = record(record(body).error);
  const metadata = record(error.metadata);
  const code = typeof error.code === 'number' ? error.code : status;
  const type = metadata.error_type;
  const seconds =
    retryAfter === null || retryAfter === undefined ? NaN : Number(retryAfter);
  const retryMs = retryAfter
    ? Number.isFinite(seconds)
      ? Math.max(0, seconds * 1000)
      : Math.max(0, Date.parse(retryAfter) - Date.now())
    : undefined;
  const retry = Number.isFinite(retryMs) ? retryMs : undefined;
  if (
    status === 429 ||
    code === 429 ||
    type === 'rate_limit_exceeded' ||
    (code === 402 &&
      metadata.limit_source === 'openrouter_in_flight_budget' &&
      retry !== undefined)
  )
    return new ProviderError(
      'rate_limited',
      true,
      'The provider is rate limiting requests. Please retry shortly.',
      retry,
    );
  if (code === 401 || type === 'authentication')
    return new ProviderError(
      'unavailable',
      false,
      'The provider rejected the credentials; contact the administrator.',
    );
  if (
    code === 402 ||
    type === 'payment_required' ||
    [
      'openrouter_guardrail_budget',
      'openrouter_workspace_budget',
      'openrouter_key_limit',
    ].includes(String(metadata.limit_source))
  )
    return new ProviderError(
      'insufficient_quota',
      false,
      'The provider balance or quota is exhausted; contact the administrator.',
    );
  if (
    ['content_policy_violation', 'refusal'].includes(String(type)) ||
    Array.isArray(metadata.reasons) ||
    Array.isArray(metadata.patterns)
  )
    return new ProviderError(
      'content_blocked',
      false,
      'The provider blocked this content. Revise the prompt or media.',
    );
  if (
    code === 403 ||
    type === 'permission_denied' ||
    code === 404 ||
    type === 'not_found'
  )
    return new ProviderError(
      'unavailable',
      false,
      `${model} is unavailable to this account. Ask the administrator to check model access and provider routing at OpenRouter settings.`,
    );
  if (
    status >= 500 ||
    code >= 500 ||
    code === 408 ||
    [
      'provider_overloaded',
      'provider_unavailable',
      'server',
      'timeout',
    ].includes(String(type))
  )
    return new ProviderError(
      'unavailable',
      true,
      'The provider is temporarily unavailable. Please retry.',
      retry,
    );
  return new ProviderError(
    'invalid_request',
    false,
    sanitizeMessage(error.message),
  );
}
