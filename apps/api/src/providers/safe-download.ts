import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable } from 'node:stream';
import { ProviderError } from './provider-error';
const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) return !blocked.check(address, 'ipv4');
  // Accept only global unicast IPv6; reject transition/documentation ranges too.
  if (isIP(address) !== 6 || !/^[23][0-9a-f]{3}:/i.test(address)) return false;
  return !blocked.check(address, 'ipv6');
}
const failure = (message: string) =>
  new ProviderError('unavailable', false, message);
export async function safeDownload(
  url: string,
  options: {
    signal: AbortSignal;
    maxBytes: number;
    timeoutMs?: number;
    resolve?: typeof lookup;
  },
) {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 180000);
  const signal = AbortSignal.any([options.signal, timeout]);
  const resolve = options.resolve ?? lookup;
  const open = async (
    target: string,
    redirects: number,
  ): Promise<{ stream: Readable; mime: string }> => {
    signal.throwIfAborted();
    const parsed = new URL(target);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
      throw failure('Provider result must use HTTPS without credentials.');
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host)
      ? [{ address: host, family: isIP(host) }]
      : await resolve(host, { all: true });
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicAddress(address))
    )
      throw failure('Provider result address is not public.');
    // Pin the validated DNS result to the actual socket, preventing DNS rebinding.
    const address = addresses[0];
    const response = await new Promise<import('node:http').IncomingMessage>(
      (accept, reject) => {
        const req = request(
          parsed,
          {
            signal,
            lookup: (_hostname, lookupOptions, callback) => {
              if (lookupOptions.all) callback(null, [address]);
              else callback(null, address.address, address.family);
            },
          },
          accept,
        );
        req.on('error', () =>
          reject(
            failure(
              signal.aborted
                ? 'Provider download timed out or was canceled.'
                : 'Provider result download failed.',
            ),
          ),
        );
        req.end();
      },
    );
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      response.resume();
      if (redirects >= 3 || !response.headers.location)
        throw failure('Provider result has too many redirects.');
      return open(
        new URL(response.headers.location, parsed).href,
        redirects + 1,
      );
    }
    if (response.statusCode !== 200) {
      response.destroy();
      throw failure('Provider result download failed.');
    }
    if (Number(response.headers['content-length']) > options.maxBytes) {
      response.destroy();
      throw failure('Provider result exceeds the size limit.');
    }
    const stream = Readable.from(
      (async function* () {
        let size = 0;
        try {
          for await (const chunk of response) {
            signal.throwIfAborted();
            const bytes = Buffer.from(chunk as Uint8Array);
            size += bytes.length;
            if (size > options.maxBytes)
              throw failure('Provider result exceeds the size limit.');
            yield bytes;
          }
        } finally {
          response.destroy();
        }
      })(),
    );
    // Socket cancellation also covers an unread or stalled result body.
    return {
      stream,
      mime: (response.headers['content-type'] ?? '').split(';')[0].trim(),
    };
  };
  return open(url, 0);
}
