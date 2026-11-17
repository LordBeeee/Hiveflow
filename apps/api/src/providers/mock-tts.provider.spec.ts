import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { MockTtsProvider, renderMockWav } from './mock-tts.provider';
import { sniffMedia } from '../assets/media-input';
const request = {
  text: 'A calm voice beside the lake at the blue hour',
  voice: 'calm',
  language: 'en',
  speed: 1,
  model: 'mock-tts',
};
const signal = () => new AbortController().signal;
it('generates deterministic valid 16-bit mono PCM with duration and soft nonzero samples', async () => {
  const result = await renderMockWav(request, signal());
  const bytes = result.bytes;
  expect(result.mime).toBe('audio/wav');
  expect(() => sniffMedia('audio', result.mime, bytes)).not.toThrow();
  expect(bytes.toString('ascii', 12, 16)).toBe('fmt ');
  expect(bytes.readUInt16LE(20)).toBe(1);
  expect(bytes.readUInt16LE(22)).toBe(1);
  expect(bytes.readUInt32LE(24)).toBe(16000);
  expect(bytes.readUInt16LE(34)).toBe(16);
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8);
  expect(bytes.readUInt32LE(40)).toBe(bytes.length - 44);
  expect(bytes.length).toBe(44 + result.durationMs * 32);
  const samples = Array.from({ length: 2000 }, (_, index) =>
    bytes.readInt16LE(44 + index * 2),
  );
  expect(Math.max(...samples.map(Math.abs))).toBeLessThanOrEqual(2200);
  expect(samples.some((sample) => Math.abs(sample) > 100)).toBe(true);
  expect((await renderMockWav(request, signal())).bytes).toEqual(bytes);
  const changed = await renderMockWav(
    { ...request, text: 'A different scene and script' },
    signal(),
  );
  const hash = (value: Buffer) =>
    createHash('sha256').update(value).digest('hex');
  expect(hash(changed.bytes)).not.toBe(hash(bytes));
});
it('scales duration by word count/speed and caps synthesis at five minutes', async () => {
  const faster = await renderMockWav({ ...request, speed: 1.25 }, signal());
  expect(faster.durationMs).toBe(
    Math.round((request.text.split(' ').length / 2.5 / 1.25) * 1000),
  );
  const capped = await renderMockWav(
    { ...request, text: 'word '.repeat(1000), speed: 0.75 },
    signal(),
  );
  expect(capped.durationMs).toBe(300000);
  expect(capped.bytes.length).toBe(9600044);
});
it('honors cancellation during sample generation and injected provider failures', async () => {
  const controller = new AbortController();
  const pending = renderMockWav(
    { ...request, text: 'word '.repeat(1000) },
    controller.signal,
  );
  controller.abort(new Error('Canceled'));
  await expect(pending).rejects.toThrow();
  const provider = new MockTtsProvider(
    new ConfigService({ MOCK_FAILURE_RATE: 1 }),
    async () => {},
  );
  await expect(provider.synthesize(request, signal())).rejects.toThrow(
    'Mock voiceover failed',
  );
  await expect(provider.synthesize(request, controller.signal)).rejects.toThrow(
    'Canceled',
  );
});
