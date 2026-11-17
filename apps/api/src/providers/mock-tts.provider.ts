import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import {
  setTimeout as delay,
  setImmediate as yieldTurn,
} from 'node:timers/promises';
import { ProviderError } from './provider-error';
import type { TtsProvider, TtsRequest } from './tts-provider';
// Pure Node PCM: mock tones let playback and downstream audio workflows run without a TTS service.
export async function renderMockWav(request: TtsRequest, signal: AbortSignal) {
  signal.throwIfAborted();
  if (
    !request.text.trim() ||
    !Number.isFinite(request.speed) ||
    request.speed <= 0
  )
    throw new Error('Provide a script and a positive speed');
  const words = request.text.trim().split(/\s+/u).length;
  const durationMs = Math.min(
    300000,
    Math.max(200, Math.round((words / 2.5 / request.speed) * 1000)),
  );
  const sampleRate = 16000;
  const samples = Math.round((sampleRate * durationMs) / 1000);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(samples * 2, 40);
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        request.text,
        request.voice,
        request.language,
        request.model,
      ]),
    )
    .digest();
  let phase = 0;
  const { sin, min, floor, round, PI } = Math;
  const voiceScale = request.voice === 'bright' ? 1.8 : 1.1;
  const beatRate = 4 * request.speed;
  const phaseScale = (2 * PI) / sampleRate;
  const durationSeconds = durationMs / 1000;
  for (let offset = 0; offset < samples; offset += sampleRate) {
    signal.throwIfAborted();
    const end = min(samples, offset + sampleRate);
    for (let index = offset; index < end; index++) {
      const t = index / sampleRate;
      const beat = floor(t * beatRate);
      const frequency = 170 + hash[beat % hash.length] * voiceScale;
      phase += phaseScale * frequency;
      const envelope =
        min(1, t * 20, (durationSeconds - t) * 20) *
        sin(PI * ((t * beatRate) % 1)) ** 2;
      bytes.writeInt16LE(round(sin(phase) * envelope * 2200), 44 + index * 2);
    }
    await yieldTurn(undefined, { signal });
  }
  return { bytes, mime: 'audio/wav', durationMs };
}
export class MockTtsProvider implements TtsProvider {
  readonly id = 'mock';
  constructor(
    private readonly config: ConfigService,
    private readonly wait: (
      ms: number,
      signal: AbortSignal,
    ) => Promise<unknown> = (ms, signal) => delay(ms, undefined, { signal }),
  ) {}
  async synthesize(request: TtsRequest, signal: AbortSignal) {
    signal.throwIfAborted();
    await this.wait(1200, signal);
    signal.throwIfAborted();
    if (Math.random() < this.config.getOrThrow<number>('MOCK_FAILURE_RATE'))
      throw new ProviderError(
        'invalid_request',
        false,
        'Mock voiceover failed. Please retry.',
      );
    return renderMockWav(request, signal);
  }
}
