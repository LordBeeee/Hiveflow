import { createPrivateKey } from 'node:crypto';
import { JWT } from 'google-auth-library';
import { ProviderError } from './provider-error';
export function veoServiceAccount(raw: string) {
  try {
    if (Buffer.byteLength(raw) > 65536) throw new Error();
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (
      !data ||
      data.type !== 'service_account' ||
      typeof data.client_email !== 'string' ||
      !/^[^@\s]+@[^@\s]+\.gserviceaccount\.com$/.test(data.client_email) ||
      typeof data.private_key !== 'string' ||
      !data.private_key.startsWith('-----BEGIN PRIVATE KEY-----')
    )
      throw new Error();
    if (createPrivateKey(data.private_key).asymmetricKeyType !== 'rsa')
      throw new Error();
    // Pass only service-account key fields. Never accept external credential loaders,
    // token_uri, universe_domain, executable sources, or impersonation endpoints.
    return { client_email: data.client_email, private_key: data.private_key };
  } catch {
    throw new Error(
      'GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON must contain a valid RSA service-account JSON key.',
    );
  }
}
export function veoProjectId(value: string) {
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(value))
    throw new Error(
      'GOOGLE_CLOUD_PROJECT_ID must be a valid Google Cloud project ID.',
    );
  return value;
}
export function veoAuthClient(raw: string, timeoutMs: number) {
  const credentials = veoServiceAccount(raw);
  return new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    transporterOptions: { timeout: timeoutMs, retry: false, maxRedirects: 0 },
  });
}
export type VeoTokenSource = (signal: AbortSignal) => Promise<string>;
export function veoTokenSource(
  client: Pick<JWT, 'getAccessToken'>,
  timeoutMs: number,
): VeoTokenSource {
  return async (signal) => {
    signal.throwIfAborted();
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    let abort: () => void = () => {};
    try {
      const response = await Promise.race([
        client.getAccessToken(),
        new Promise<never>((_resolve, reject) => {
          abort = () => reject(combined.reason);
          combined.addEventListener('abort', abort, { once: true });
          if (combined.aborted) abort();
        }),
      ]);
      combined.throwIfAborted();
      if (!response.token || /\s/.test(response.token))
        throw new ProviderError(
          'unavailable',
          false,
          'Google returned no valid access token; contact the administrator.',
        );
      return response.token;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (timeout.aborted)
        throw new ProviderError(
          'timeout',
          false,
          'Google authentication timed out. Please retry.',
        );
      if (error instanceof ProviderError) throw error;
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      throw new ProviderError(
        'unavailable',
        status === undefined || status === 429 || status >= 500,
        'Google rejected or could not verify the service-account credentials; contact the administrator.',
      );
    } finally {
      combined.removeEventListener('abort', abort);
    }
  };
}
