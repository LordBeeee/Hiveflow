import { pcmToWav } from './openrouter-audio';
it('writes RIFF PCM with correct duration from content-type or defaults', () => {
  const result = pcmToWav(
    Buffer.alloc(96000),
    'audio/pcm;rate=24000;channels=2',
  );
  expect(result.durationMs).toBe(1000);
  expect(result.mime).toBe('audio/wav');
  expect(result.bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(result.bytes.toString('ascii', 8, 16)).toBe('WAVEfmt ');
  expect(result.bytes.readUInt32LE(4)).toBe(96036);
  expect(result.bytes.readUInt32LE(24)).toBe(24000);
  expect(result.bytes.readUInt32LE(28)).toBe(96000);
  expect(result.bytes.readUInt32LE(40)).toBe(96000);
  expect(pcmToWav(Buffer.alloc(48000), 'audio/pcm').durationMs).toBe(1000);
});
it.each([
  'audio/mpeg',
  'audio/pcm;rate=0',
  'audio/pcm;rate=200000',
  'audio/pcm;rate=oops',
  'audio/pcm;rate=24000;rate=48000',
  'audio/pcm;channels=3',
  'audio/pcm;channels=0',
])('rejects invalid PCM content-type %s', (type) => {
  expect(() => pcmToWav(Buffer.alloc(4), type)).toThrow();
});
it('rejects empty or misaligned samples', () => {
  expect(() => pcmToWav(Buffer.alloc(0), 'audio/pcm')).toThrow();
  expect(() => pcmToWav(Buffer.alloc(3), 'audio/pcm')).toThrow();
  expect(() => pcmToWav(Buffer.alloc(2), 'audio/pcm;channels=2')).toThrow();
});
