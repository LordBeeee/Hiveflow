import https from 'node:https';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { isPublicAddress, safeDownload } from './safe-download';
const signal = new AbortController().signal;
afterEach(() => jest.restoreAllMocks());
it.each([
  '127.0.0.1',
  '10.1.2.3',
  '172.16.1.2',
  '192.168.1.2',
  '169.254.169.254',
  '100.64.0.1',
  '::1',
  'fc00::1',
  'fe80::1',
  '::ffff:127.0.0.1',
  '2001:db8::1',
  '2002:7f00:1::',
])('rejects nonpublic address %s', (address) =>
  expect(isPublicAddress(address)).toBe(false),
);
it('accepts public addresses', () => {
  expect(isPublicAddress('8.8.8.8')).toBe(true);
  expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
});
it('rejects HTTP and private DNS before opening a socket', async () => {
  await expect(
    safeDownload('http://example.com', { signal, maxBytes: 10 }),
  ).rejects.toThrow('HTTPS');
  await expect(
    safeDownload('https://127.0.0.1', { signal, maxBytes: 10 }),
  ).rejects.toThrow('not public');
});
function respond(headers: Record<string, string>, statusCode = 200) {
  const response = Object.assign(Readable.from([Buffer.from('oversized')]), {
    headers,
    statusCode,
  });
  jest.spyOn(https, 'request').mockImplementation(((
    _url: unknown,
    _options: unknown,
    callback: (value: unknown) => void,
  ) => {
    const req = Object.assign(new EventEmitter(), {
      end: () => callback(response),
    });
    return req;
  }) as typeof https.request);
}
it('rejects redirects to HTTP or private addresses', async () => {
  respond({ location: 'http://example.com/file' }, 302);
  await expect(
    safeDownload('https://8.8.8.8/file', { signal, maxBytes: 10 }),
  ).rejects.toThrow('HTTPS');
});
it('enforces content-length and streaming limits', async () => {
  respond({ 'content-length': '100' });
  await expect(
    safeDownload('https://8.8.8.8/file', { signal, maxBytes: 2 }),
  ).rejects.toThrow('size limit');
  jest.restoreAllMocks();
  respond({ 'content-type': 'video/mp4' });
  const { stream } = await safeDownload('https://8.8.8.8/file', {
    signal,
    maxBytes: 2,
  });
  await expect(
    (async () => {
      for await (const chunk of stream) void chunk;
    })(),
  ).rejects.toThrow('size limit');
});
