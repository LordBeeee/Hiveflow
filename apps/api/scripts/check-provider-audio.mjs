import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mp3Duration, pcmToWav } from '../dist/providers/openrouter-audio.js';
const bytes = await readFile(
  new URL('../fixtures/silence.mp3', import.meta.url),
);
const duration = await mp3Duration(bytes);
assert(
  duration >= 200 && duration < 350,
  `Unexpected MP3 duration: ${duration}`,
);
await assert.rejects(mp3Duration(Buffer.from('invalid MP3')));
const wav = pcmToWav(Buffer.alloc(96000), 'audio/pcm;rate=24000;channels=2');
assert.equal(wav.durationMs, 1000);
assert.equal(wav.bytes.readUInt32LE(40), 96000);
console.log(`Provider audio check passed: MP3 ${duration}ms; PCM/WAV 1000ms.`);
