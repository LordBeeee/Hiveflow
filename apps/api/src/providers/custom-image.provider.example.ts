import type { ImageProvider, ImageRequest } from './image-provider';

// Implement and register in RunsModule before selecting IMAGE_PROVIDER=custom.
export class CustomImageProvider implements ImageProvider {
  readonly id = 'custom';
  async generate(
    _request: ImageRequest,
    signal: AbortSignal,
  ): ReturnType<ImageProvider['generate']> {
    signal.throwIfAborted();
    throw new Error('Custom image provider is not implemented');
  }
}
