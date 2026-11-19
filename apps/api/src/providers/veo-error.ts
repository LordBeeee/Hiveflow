import { ProviderError } from './provider-error';
import { sanitizeMessage } from './provider-http';
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
// Google canonical Status codes plus the documented Veo safety support codes.
const safetyCodes = new Set([
  '58061214',
  '17301594',
  '29310472',
  '15236754',
  '64151117',
  '42237218',
  '62263041',
  '57734940',
  '22137204',
  '74803281',
  '29578790',
  '42876398',
  '89371032',
  '49114662',
  '63429089',
  '72817394',
  '60599140',
  '35561574',
  '35561575',
  '90789179',
  '43188360',
  '78610348',
  '61493863',
  '56562880',
  '32635315',
]);
export function veoError(
  status: number,
  body: unknown,
  retryAfter?: string | null,
  model = 'Veo model',
) {
  const error = record(record(body).error);
  const code = String(error.status ?? '');
  const numeric = Number(error.code);
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  const delay = retryAfter
    ? Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(retryAfter) - Date.now()
    : NaN;
  const retryMs = Number.isFinite(delay) ? Math.max(0, delay) : undefined;
  const billingDisabled =
    Array.isArray(error.details) &&
    error.details.some((value) => {
      const detail = record(value);
      return (
        detail['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' &&
        detail.domain === 'googleapis.com' &&
        detail.reason === 'BILLING_DISABLED'
      );
    });
  if (billingDisabled)
    return new ProviderError(
      'insufficient_quota',
      false,
      'Google Cloud billing is disabled; contact the administrator.',
    );
  if (
    typeof error.message === 'string' &&
    (error.message.match(/\b\d{8}\b/g) ?? []).some((value) =>
      safetyCodes.has(value),
    )
  )
    return new ProviderError(
      'content_blocked',
      false,
      'The provider blocked this content. Revise the prompt or media.',
    );
  if (code === 'UNAUTHENTICATED' || numeric === 16 || status === 401)
    return new ProviderError(
      'unavailable',
      false,
      'The provider rejected the credentials; contact the administrator.',
    );
  if (code === 'PERMISSION_DENIED' || numeric === 7 || status === 403)
    return new ProviderError(
      'unavailable',
      false,
      `${model} is unavailable to this project. Enable the Vertex AI API and check service-account IAM permissions, model access and project quota in Google Cloud console.`,
    );
  if (code === 'NOT_FOUND' || numeric === 5 || status === 404)
    return new ProviderError(
      'unavailable',
      false,
      `${model} or its operation was not found. Check the project, us-central1 model availability and operation history in Google Cloud console.`,
    );
  if (code === 'RESOURCE_EXHAUSTED' || numeric === 8 || status === 429)
    return new ProviderError(
      'rate_limited',
      true,
      'Google Cloud quota or capacity is exhausted. Retry later or request a quota increase.',
      retryMs,
    );
  if (code === 'CANCELLED' || numeric === 1 || status === 499)
    return new ProviderError(
      'canceled',
      false,
      'The provider operation was canceled.',
    );
  if (code === 'DEADLINE_EXCEEDED' || numeric === 4 || status === 504)
    return new ProviderError(
      'timeout',
      false,
      'The provider operation timed out. Please retry.',
    );
  if (
    ['UNKNOWN', 'INTERNAL', 'UNAVAILABLE'].includes(code) ||
    [2, 13, 14].includes(numeric) ||
    status >= 500
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
