// Test transport only: exercise production adapters with fixed wire responses.
// This module is never imported by the API and cannot access provider networks.
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { ProviderHttp } from '../dist/providers/provider-http.js';
import { openrouterError } from '../dist/providers/openrouter-error.js';
import { seedanceError } from '../dist/providers/seedance-error.js';
import {
  OpenRouterImageProvider,
  OpenRouterLlmProvider,
  OpenRouterTtsProvider,
} from '../dist/providers/openrouter.provider.js';
import { SeedanceProvider } from '../dist/providers/seedance.provider.js';

export const fixtureModels = {
  image: 'bytedance-seed/seedream-4.5',
  llm: 'google/gemini-4-neon',
  tts: 'elevenlabs/eleven-v4',
  video: 'seedance-2-0',
};
const json = (body) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });

export function registerOfflineFixtures(registry) {
  const http = new ProviderHttp(
    {
      baseUrl: 'https://offline.invalid',
      headers: {},
      mapError: openrouterError,
    },
    async (url, init) => {
      const body = JSON.parse(init.body);
      switch (new URL(url).pathname) {
        case '/images': {
          const bytes = await sharp({
            create: {
              width: 320,
              height: 320,
              channels: 3,
              background: '#8560ea',
            },
          })
            .png()
            .toBuffer();
          return json({
            data: Array.from({ length: body.n ?? 1 }, () => ({
              b64_json: bytes.toString('base64'),
            })),
          });
        }
        case '/chat/completions':
          return json({
            choices: [
              {
                message: { content: 'Offline narration fixture.' },
                finish_reason: 'stop',
              },
            ],
          });
        case '/audio/speech':
          return new Response(
            await readFile(new URL('../fixtures/silence.mp3', import.meta.url)),
            { headers: { 'content-type': 'audio/mpeg' } },
          );
        default:
          throw new Error(`Unexpected offline request: ${url}`);
      }
    },
  );
  registry.register('image', 'openrouter', new OpenRouterImageProvider(http));
  registry.register('llm', 'openrouter', new OpenRouterLlmProvider(http));
  registry.register('tts', 'openrouter', new OpenRouterTtsProvider(http));
  const videoHttp = new ProviderHttp(
    {
      baseUrl: 'https://offline.invalid',
      headers: {},
      mapError: seedanceError,
      embeddedErrors: false,
    },
    async (_url, init) =>
      json(
        init.method === 'POST'
          ? { id: crypto.randomUUID() }
          : {
              status: 'succeeded',
              content: { video_url: 'https://offline.invalid/sample.mp4' },
              duration: 2,
            },
      ),
  );
  registry.register(
    'video',
    'seedance',
    new SeedanceProvider(videoHttp, 1024 * 1024, async () => ({
      stream: Readable.from([
        await readFile(
          new URL('../fixtures/sample-video.mp4', import.meta.url),
        ),
      ]),
      mime: 'video/mp4',
      width: 320,
      height: 180,
    })),
  );
}
