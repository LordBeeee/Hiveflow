import { ProviderError } from './provider-error';
export function pcmToWav(bytes: Buffer, contentType: string) {
  const parts = contentType
    .toLowerCase()
    .split(';')
    .map((part) => part.trim());
  if (parts[0] !== 'audio/pcm')
    throw new ProviderError(
      'unavailable',
      false,
      'Expected a PCM audio response.',
    );
  const parameter = (name: string, fallback: number) => {
    const values = parts
      .slice(1)
      .filter((part) => part.split('=')[0].trim() === name);
    if (!values.length) return fallback;
    if (
      values.length !== 1 ||
      !/^\d+$/.test(values[0].split('=')[1]?.trim() ?? '')
    )
      return NaN;
    return Number(values[0].split('=')[1]);
  };
  const rate = parameter('rate', 24000),
    channels = parameter('channels', 1);
  if (
    !Number.isInteger(rate) ||
    rate < 8000 ||
    rate > 192000 ||
    ![1, 2].includes(channels) ||
    !bytes.length ||
    bytes.length % (channels * 2) ||
    bytes.length > 0xffffffff - 36
  )
    throw new ProviderError(
      'unavailable',
      false,
      'The provider returned invalid PCM rate, channels or sample bytes.',
    );
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + bytes.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(bytes.length, 40);
  return {
    bytes: Buffer.concat([header, bytes]),
    mime: 'audio/wav',
    durationMs: Math.round((bytes.length / (rate * channels * 2)) * 1000),
  };
}
// Preserve native import in this CommonJS build, including on Node 20.
const loadMetadata = new Function(
  'return import("music-metadata")',
) as () => Promise<typeof import('music-metadata')>;
export async function mp3Duration(bytes: Buffer) {
  const { parseBuffer } = await loadMetadata();
  const metadata = await parseBuffer(
    bytes,
    { mimeType: 'audio/mpeg', size: bytes.length },
    { duration: true },
  ).catch(() => {
    throw new ProviderError(
      'unavailable',
      false,
      'The provider returned an invalid MP3 response.',
    );
  });
  const seconds = metadata.format.duration;
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0)
    throw new ProviderError(
      'unavailable',
      false,
      'The provider returned audio with an invalid duration.',
    );
  return Math.round(seconds * 1000);
}
