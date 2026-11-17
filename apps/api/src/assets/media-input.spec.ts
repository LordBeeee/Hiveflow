import { Readable } from 'node:stream';
import { readBounded, sniffMedia } from './media-input';
it('validates audio/video signatures and rejects MIME spoofing', () => {
  const wav = Buffer.alloc(44);
  wav.write('RIFF');
  wav.write('WAVE', 8);
  expect(() => sniffMedia('audio', 'audio/wav', wav)).not.toThrow();
  expect(() =>
    sniffMedia('audio', 'audio/mpeg', Buffer.from('ID3\0')),
  ).not.toThrow();
  const mp4 = Buffer.alloc(16);
  mp4.writeUInt32BE(16);
  mp4.write('ftyp', 4);
  expect(() => sniffMedia('video', 'video/mp4', mp4)).not.toThrow();
  expect(() => sniffMedia('audio', 'audio/mp4', mp4)).not.toThrow();
  expect(() =>
    sniffMedia('video', 'video/webm', Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  ).not.toThrow();
  expect(() => sniffMedia('video', 'video/mp4', wav)).toThrow('does not match');
  expect(() => sniffMedia('audio', 'image/png', wav)).toThrow('Unsupported');
});
it('bounds buffers and streams without accepting two sources', async () => {
  await expect(
    readBounded(
      {
        kind: 'audio',
        mime: 'audio/wav',
        stream: Readable.from([Buffer.alloc(4), Buffer.alloc(8)]),
      },
      10,
    ),
  ).rejects.toThrow('size limit');
  await expect(
    readBounded(
      { kind: 'audio', mime: 'audio/wav', bytes: Buffer.alloc(11) },
      10,
    ),
  ).rejects.toThrow('size limit');
  await expect(
    readBounded(
      {
        kind: 'audio',
        mime: 'audio/wav',
        bytes: Buffer.alloc(1),
        stream: Readable.from([]),
      },
      10,
    ),
  ).rejects.toThrow('exactly one');
});
