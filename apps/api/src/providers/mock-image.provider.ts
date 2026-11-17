import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import type { ImageProvider, ImageRequest } from './image-provider';

const xml = (text: string) =>
  text.replace(
    /[<>&"']/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  );
export function mockDimensions(
  aspectRatio: string,
  resolution: ImageRequest['resolution'],
) {
  const [a, b] = aspectRatio.split(':').map(Number);
  const size = { '1K': 1024, '2K': 2048, '4K': 4096 }[resolution];
  return {
    width: Math.round((size * a) / Math.max(a, b)),
    height: Math.round((size * b) / Math.max(a, b)),
  };
}
export async function renderMockImage(request: ImageRequest, index: number) {
  const { width, height } = mockDimensions(
    request.aspectRatio,
    request.resolution,
  );
  const hash = createHash('sha256')
    .update(`${request.prompt}|${request.model}|${index}`)
    .digest('hex');
  const fontSize = Math.max(18, Math.round(Math.min(width, height) / 24));
  // eslint-disable-next-line no-control-regex -- Strip XML-invalid control characters from user text.
  const words = request.prompt.replace(/[\x00-\x1f]/g, ' ').slice(0, 110);
  const lineLength = Math.max(12, Math.floor(width / (fontSize * 0.65)) - 4);
  const lines = [
    words.slice(0, lineLength),
    words.slice(lineLength, lineLength * 2),
  ];
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#${hash.slice(0, 6)}"/><stop offset="1" stop-color="#${hash.slice(6, 12)}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width * 0.78}" cy="${height * 0.25}" r="${Math.min(width, height) * 0.24}" fill="#fff" opacity=".12"/><path d="M0 ${height * 0.8} Q${width * 0.5} ${height * 0.3} ${width} ${height * 0.82}V${height}H0Z" fill="#000" opacity=".16"/><rect y="${height * 0.68}" width="100%" height="${height * 0.32}" fill="#000" opacity=".22"/><g fill="white" font-family="DejaVu Sans, sans-serif"><text x="${width * 0.06}" y="${height * 0.76}" font-size="${fontSize * 0.55}" letter-spacing="2">HIVEFLOW / MOCK PREVIEW ${index + 1}</text>${lines.map((line, i) => `<text x="${width * 0.06}" y="${height * 0.83 + fontSize * i * 1.3}" font-size="${fontSize}">${xml(line)}</text>`).join('')}</g></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  return { bytes, mime: 'image/png', width, height };
}
export class MockImageProvider implements ImageProvider {
  readonly id = 'mock';
  constructor(
    private readonly config: ConfigService,
    private readonly wait: (
      ms: number,
      signal: AbortSignal,
    ) => Promise<unknown> = (ms, signal) => delay(ms, undefined, { signal }),
  ) {}
  async generate(request: ImageRequest, signal: AbortSignal) {
    signal.throwIfAborted();
    await this.wait(2000 + Math.floor(Math.random() * 2001), signal);
    signal.throwIfAborted();
    if (Math.random() < this.config.getOrThrow<number>('MOCK_FAILURE_RATE'))
      throw new Error('Mock provider failed. Please retry.');
    const images = [];
    for (let index = 0; index < request.count; index++) {
      signal.throwIfAborted();
      images.push(await renderMockImage(request, index));
    }
    signal.throwIfAborted();
    return { images };
  }
}
