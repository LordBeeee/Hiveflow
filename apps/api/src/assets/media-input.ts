import { Readable } from 'node:stream';
import type { MediaKind } from '@hiveflow/shared';
export interface StoreInput {
  signal?: AbortSignal;
  kind: MediaKind;
  bytes?: Buffer;
  stream?: Readable;
  mime: string;
  meta?: { width?: number; height?: number; durationMs?: number };
}
export const mediaExtensions: Record<string, string> = {
  'image/png': 'png',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};
export function sniffMedia(kind: MediaKind, mime: string, bytes: Buffer) {
  const supported =
    kind === 'audio'
      ? ['audio/mpeg', 'audio/wav', 'audio/mp4']
      : ['video/mp4', 'video/webm'];
  if (!supported.includes(mime)) throw new Error('Unsupported media MIME type');
  const valid = mime.endsWith('/mp4')
    ? bytes.length >= 12 &&
      bytes.toString('ascii', 4, 8) === 'ftyp' &&
      bytes.readUInt32BE(0) >= 12 &&
      bytes.readUInt32BE(0) <= bytes.length
    : mime === 'audio/wav'
      ? bytes.length >= 44 &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WAVE'
      : mime === 'audio/mpeg'
        ? bytes.length >= 4 &&
          (bytes.toString('ascii', 0, 3) === 'ID3' ||
            (bytes[0] === 255 &&
              (bytes[1] & 224) === 224 &&
              (bytes[1] & 6) !== 0))
        : bytes.length >= 4 &&
          bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!valid)
    throw new Error('Media content does not match its declared MIME type');
}
export async function readBounded(input: StoreInput, limit: number) {
  if (!!input.bytes === !!input.stream)
    throw new Error('Provide exactly one of bytes or stream');
  if (input.bytes) {
    if (input.bytes.length > limit)
      throw new Error('Media exceeds the configured size limit');
    return input.bytes;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of input.stream!) {
    const bytes = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > limit) {
      input.stream!.destroy();
      throw new Error('Media exceeds the configured size limit');
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}
