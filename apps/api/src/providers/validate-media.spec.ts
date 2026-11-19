import sharp from 'sharp';
import { imageDataUri, validateRequestSize } from './validate-media';
it('reads storage bytes as base64 and validates decoded bytes and encoded request size', async () => {
  const bytes = await sharp({
    create: { width: 4, height: 2, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  const input = {
    url: 'http://internal-storage/private',
    mime: 'image/png',
    read: async () => bytes,
  };
  const signal = new AbortController().signal;
  expect(
    await imageDataUri(
      input,
      { imageFormats: ['image/png'], maxImagePixels: 10 },
      signal,
    ),
  ).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
  await expect(
    imageDataUri(input, { minImagePixels: 300 }, signal),
  ).rejects.toMatchObject({ code: 'invalid_request' });
  await expect(
    imageDataUri(input, { maxImageMb: 0.000001 }, signal),
  ).rejects.toThrow('exceeds');
  await expect(
    imageDataUri({ ...input, mime: 'image/jpeg' }, {}, signal),
  ).rejects.toThrow('declared format');
  expect(() =>
    validateRequestSize(
      { image: bytes.toString('base64') },
      { maxRequestMb: 0.000001 },
    ),
  ).toThrow('base64 overhead');
});
