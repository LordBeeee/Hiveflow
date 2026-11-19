import sharp, { type Metadata } from 'sharp';
import type { ModelCapabilities } from '@hiveflow/shared';
import type { MediaInput } from './media-input';
import { ProviderError } from './provider-error';
export function invalid(message: string): never {
  throw new ProviderError('invalid_request', false, message);
}
export async function imageDataUri(
  input: MediaInput,
  caps: ModelCapabilities,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const bytes = await input.read();
  signal.throwIfAborted();
  if (caps.maxImageMb && bytes.length > caps.maxImageMb * 1024 * 1024)
    invalid(`Reference image exceeds ${caps.maxImageMb} MB.`);
  if (caps.imageFormats && !caps.imageFormats.includes(input.mime))
    invalid('Reference image format is unsupported by this model.');
  let meta: Metadata;
  try {
    meta = await sharp(bytes, { limitInputPixels: 16777216 }).metadata();
  } catch {
    return invalid('Reference image is not a valid raster image.');
  }
  const formats: Record<string, string> = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    tiff: 'image/tiff',
  };
  const mime = formats[meta.format ?? ''];
  if (!mime || mime !== input.mime || !meta.width || !meta.height)
    invalid('Reference image does not match its declared format.');
  if (
    (caps.minImagePixels &&
      Math.min(meta.width!, meta.height!) < caps.minImagePixels) ||
    (caps.maxImagePixels &&
      Math.max(meta.width!, meta.height!) > caps.maxImagePixels)
  )
    invalid('Reference image dimensions are outside this model limits.');
  const ratio = meta.width! / meta.height!;
  if (
    caps.imageAspectRatio &&
    (ratio < caps.imageAspectRatio.min || ratio > caps.imageAspectRatio.max)
  )
    invalid('Reference image aspect ratio is outside this model limits.');
  return `data:${input.mime};base64,${bytes.toString('base64')}`;
}
export function validateRequestSize(body: unknown, caps: ModelCapabilities) {
  if (
    caps.maxRequestMb &&
    Buffer.byteLength(JSON.stringify(body)) > caps.maxRequestMb * 1024 * 1024
  )
    invalid(
      `Encoded request exceeds ${caps.maxRequestMb} MB, including base64 overhead.`,
    );
}
