import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { MockImageProvider, mockDimensions } from './mock-image.provider';
const request = {
  prompt: 'A cabin <on a mountain> & warm light',
  references: [],
  count: 2,
  aspectRatio: '16:9',
  resolution: '1K' as const,
  model: 'auto',
};
describe('MockImageProvider', () => {
  afterEach(() => jest.restoreAllMocks());
  it('downloads signed references and hashes content instead of expiring URL signatures', async () => {
    const download = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('reference bytes'));
    const provider = new MockImageProvider(
      new ConfigService({ MOCK_FAILURE_RATE: 0 }),
      async () => {},
    );
    const signal = new AbortController().signal;
    const a = await provider.generate(
      {
        ...request,
        references: [{ url: 'https://storage.example/a?signature=1' }],
      },
      signal,
    );
    const b = await provider.generate(
      {
        ...request,
        references: [{ url: 'https://storage.example/a?signature=2' }],
      },
      signal,
    );
    expect(download).toHaveBeenCalledWith(
      'https://storage.example/a?signature=1',
      { signal },
    );
    expect(a.images[0].bytes.equals(b.images[0].bytes)).toBe(true);
    download.mockResolvedValue(new Response('different reference'));
    const c = await provider.generate(
      { ...request, references: [{ url: 'https://storage.example/a' }] },
      signal,
    );
    expect(a.images[0].bytes.equals(c.images[0].bytes)).toBe(false);
  });
  it('reports a failed signed reference download clearly', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 403 }));
    const provider = new MockImageProvider(
      new ConfigService({ MOCK_FAILURE_RATE: 0 }),
      async () => {},
    );
    await expect(
      provider.generate(
        {
          ...request,
          references: [{ url: 'https://storage.example/missing' }],
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('could not be downloaded');
  });
  it('returns deterministic valid PNG images with truthful dimensions and count', async () => {
    const provider = new MockImageProvider(
      new ConfigService({ MOCK_FAILURE_RATE: 0 }),
      async () => {},
    );
    const a = await provider.generate(request, new AbortController().signal);
    const b = await provider.generate(request, new AbortController().signal);
    expect(a.images).toHaveLength(2);
    expect(a.images[0].bytes.equals(b.images[0].bytes)).toBe(true);
    expect(a.images[0].bytes.equals(a.images[1].bytes)).toBe(false);
    const metadata = await sharp(a.images[0].bytes).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 1024, height: 576 });
  });
  it('honors aspect ratios and requested resolution bounds', () => {
    expect(mockDimensions('9:16', '4K')).toEqual({ width: 2304, height: 4096 });
    expect(mockDimensions('4:3', '2K')).toEqual({ width: 2048, height: 1536 });
  });
  it('supports failure injection and aborts without generating images', async () => {
    const provider = new MockImageProvider(
      new ConfigService({ MOCK_FAILURE_RATE: 1 }),
      async () => {},
    );
    await expect(
      provider.generate(request, new AbortController().signal),
    ).rejects.toThrow('Mock provider failed');
    await expect(
      provider.generate(request, AbortSignal.abort(new Error('canceled'))),
    ).rejects.toThrow('canceled');
  });
});
