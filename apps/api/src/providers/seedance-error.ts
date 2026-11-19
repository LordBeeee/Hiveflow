import { ProviderError } from './provider-error';
import { sanitizeMessage } from './provider-http';
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
// Exact inference codes documented at docs.byteplus.com/en/docs/modelark/error-codes.
const contentCodes = new Set([
  'SensitiveContentDetected',
  'InputTextSensitiveContentDetected',
  'InputImageSensitiveContentDetected',
  'InputVideoSensitiveContentDetected',
  'InputAudioSensitiveContentDetected',
  'OutputTextSensitiveContentDetected',
  'OutputImageSensitiveContentDetected',
  'OutputVideoSensitiveContentDetected',
  'OutputAudioSensitiveContentDetected',
  'InputTextSensitiveContentDetected.PolicyViolation',
  'InputImageSensitiveContentDetected.PolicyViolation',
  'InputVideoSensitiveContentDetected.PolicyViolation',
  'InputAudioSensitiveContentDetected.PolicyViolation',
  'OutputImageSensitiveContentDetected.PolicyViolation',
  'OutputVideoSensitiveContentDetected.PolicyViolation',
  'OutputAudioSensitiveContentDetected.PolicyViolation',
  'OutputImageSensitiveContentDetected.DeepFake',
]);
const rateCodes = new Set([
  'RateLimitExceeded.EndpointRPMExceeded',
  'RateLimitExceeded.EndpointTPMExceeded',
  'RateLimitExceeded.EndpointFlexTPMExceeded',
  'ModelAccountRpmRateLimitExceeded',
  'ModelAccountTpmRateLimitExceeded',
  'ModelAccountFlexTpmRateLimitExceeded',
  'APIAccountRpmRateLimitExceeded',
  'ModelAccountIpmRateLimitExceeded',
  'RequestBurstTooFast',
  'InflightBatchsizeExceeded',
  'AccountRateLimitExceeded',
]);
export function seedanceError(
  status: number,
  body: unknown,
  retryAfter?: string | null,
  model = 'Seedance model',
) {
  const error = record(record(body).error);
  const code = String(error.code ?? '');
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  const ms = retryAfter
    ? Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now()
    : undefined;
  const retryMs =
    ms !== undefined && Number.isFinite(ms) ? Math.max(0, ms) : undefined;
  if (
    code === 'InputImageSensitiveContentDetected.PrivacyInformation' ||
    code === 'InputVideoSensitiveContentDetected.PrivacyInformation'
  )
    return new ProviderError(
      'content_blocked',
      false,
      'This model does not accept images containing real people.',
    );
  if (contentCodes.has(code))
    return new ProviderError(
      'content_blocked',
      false,
      'The provider blocked this content. Revise the prompt or media.',
    );
  if (
    [
      'AccountOverdueError',
      'OperationDenied.ServiceOverdue',
      'SetLimitExceeded',
      'OperationDenied.FileQuotaExceeded',
    ].includes(code)
  )
    return new ProviderError(
      'insufficient_quota',
      false,
      'The provider balance or quota is exhausted; contact the administrator.',
    );
  // QuotaExceeded is documented for both trial exhaustion and a full task queue.
  // Never retry an ambiguous quota failure automatically and risk another billable submission.
  if (code === 'QuotaExceeded')
    return new ProviderError(
      'insufficient_quota',
      false,
      'The provider quota or queued-task limit is exhausted; contact the administrator.',
    );
  if (
    status === 401 ||
    code === 'AuthenticationError' ||
    code === 'InvalidAccountStatus'
  )
    return new ProviderError(
      'unavailable',
      false,
      'The provider rejected the credentials; contact the administrator.',
    );
  if (
    [
      'ModelNotOpen',
      'OperationDenied.ServiceNotOpen',
      'InvalidEndpointOrModel.NotFound',
      'InvalidEndpointOrModel.ModelIDAccessDisabled',
      'AccessDenied',
      'OperationDenied.PermissionDenied',
    ].includes(code)
  )
    return new ProviderError(
      'unavailable',
      false,
      `${model} is unavailable to this account. Enable the model in the ModelArk console Activation page and check project permissions.`,
    );
  if (status === 429 || rateCodes.has(code))
    return new ProviderError(
      'rate_limited',
      true,
      'The provider is rate limiting requests. Please retry shortly.',
      retryMs,
    );
  if (
    status >= 500 ||
    status === 408 ||
    code === 'InternalServiceError' ||
    code === 'ServerOverloaded'
  )
    return new ProviderError(
      'unavailable',
      true,
      'The provider is temporarily unavailable. Please retry.',
      retryMs,
    );
  return new ProviderError(
    'invalid_request',
    false,
    sanitizeMessage(error.message),
  );
}
