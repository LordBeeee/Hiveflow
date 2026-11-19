import { ProviderHttp, redactHeaders } from './provider-http';
import { ProviderError } from './provider-error';
const mapError = (status: number) =>
  new ProviderError(
    status === 429 ? 'rate_limited' : 'invalid_request',
    status === 429,
    'Bearer secret https://private.example/key',
  );
const config = {
  baseUrl: 'https://provider.example',
  headers: { Authorization: 'Bearer secret' },
  mapError,
};
it('parses JSON and binary without logging secrets and maps errors even inside HTTP 200', async () => {
  const send = jest
    .fn()
    .mockResolvedValueOnce(new Response('{"ok":true}'))
    .mockResolvedValueOnce(
      new Response(Buffer.from([1, 2]), {
        headers: { 'content-type': 'audio/pcm' },
      }),
    )
    .mockResolvedValueOnce(new Response('{"error":{"code":429}}'));
  const http = new ProviderHttp(config, send);
  const signal = new AbortController().signal;
  expect((await http.post('/', {}, signal)).data).toEqual({ ok: true });
  expect((await http.post<Buffer>('/', {}, signal, true)).data).toEqual(
    Buffer.from([1, 2]),
  );
  await expect(http.post('/', {}, signal)).rejects.toMatchObject({
    userMessage: '[REDACTED] [URL omitted]',
  });
  expect(redactHeaders(config.headers)).toEqual({
    authorization: '[REDACTED]',
  });
});
it('bounds response bytes', async () => {
  const http = new ProviderHttp(
    { ...config, maxResponseBytes: 1 },
    jest.fn().mockResolvedValue(new Response('large')),
  );
  await expect(
    http.post('/', {}, new AbortController().signal),
  ).rejects.toThrow('size limit');
});
it('honors timeout and the run abort signal without retrying internally', async () => {
  const send = jest.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(init.signal?.reason),
          { once: true },
        );
      }),
  );
  const http = new ProviderHttp({ ...config, timeoutMs: 10 }, send);
  await expect(
    http.post('/', {}, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'timeout', retryable: false });
  const controller = new AbortController();
  const pending = http.post('/', {}, controller.signal);
  controller.abort(new Error('run canceled'));
  await expect(pending).rejects.toThrow('run canceled');
  expect(send).toHaveBeenCalledTimes(2);
});

it('maps non-JSON HTTP failures using their status', async () => {
  const mapper = jest.fn(
    () => new ProviderError('unavailable', true, 'upstream down'),
  );
  const http = new ProviderHttp(
    { ...config, mapError: mapper },
    jest.fn().mockResolvedValue(new Response('gateway down', { status: 502 })),
  );
  await expect(
    http.post('/', {}, new AbortController().signal),
  ).rejects.toMatchObject({ code: 'unavailable', retryable: true });
  expect(mapper).toHaveBeenCalledWith(502, {}, null, undefined);
});
