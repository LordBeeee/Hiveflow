import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assistantPresets } from '@hiveflow/shared';
import type { LlmProvider, LlmRequest } from './llm-provider';
import { ProviderError } from './provider-error';
export class MockLlmProvider implements LlmProvider {
  readonly id = 'mock';
  constructor(
    private readonly config: ConfigService,
    private readonly wait: (
      ms: number,
      signal: AbortSignal,
    ) => Promise<unknown> = (ms, signal) => delay(ms, undefined, { signal }),
  ) {}
  async complete(request: LlmRequest, signal: AbortSignal) {
    signal.throwIfAborted();
    await this.wait(1200, signal);
    signal.throwIfAborted();
    if (Math.random() < this.config.getOrThrow<number>('MOCK_FAILURE_RATE'))
      throw new ProviderError(
        'invalid_request',
        false,
        'Mock assistant failed. Please retry.',
      );
    const text = request.messages.map((message) => message.text).join('\n\n');
    const imageHashes: string[] = [];
    for (const image of request.messages.flatMap(
      (message) => message.images ?? [],
    )) {
      const response = await fetch(image.url, { signal });
      if (!response.ok)
        throw new ProviderError(
          'invalid_request',
          false,
          'A reference image could not be downloaded. Upload or run its source again.',
        );
      imageHashes.push(
        createHash('sha256')
          .update(Buffer.from(await response.arrayBuffer()))
          .digest('hex')
          .slice(0, 12),
      );
    }
    const references = imageHashes.length
      ? `\nImage references: ${imageHashes.join(', ')}.`
      : '';
    const body = text + references;
    const result =
      request.system === assistantPresets.prompt_improver.system
        ? `Improved prompt: ${body}\nVivid composition, expressive lighting, rich textures and a clear focal point.`
        : request.system === assistantPresets.image_to_prompt.system
          ? `Image prompt: ${body}\nA considered composition with soft directional light and detailed atmosphere. (Mock description, not visual analysis.)`
          : request.system === assistantPresets.script_writer.system
            ? `Narration script:\n${body}\nLet the scene unfold, one detail at a time.`
            : `Creative assistant:\n${body}`;
    signal.throwIfAborted();
    return { text: result };
  }
}
