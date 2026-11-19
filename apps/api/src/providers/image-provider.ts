import type { MediaInput } from './media-input';
export interface ImageRequest {
  prompt: string;
  references: MediaInput[];
  count: number;
  aspectRatio: string;
  resolution: '1K' | '2K' | '4K';
  model: string;
  options?: Record<string, string | number | boolean>;
}
export interface ImageProvider {
  id: string;
  generate(
    request: ImageRequest,
    signal: AbortSignal,
  ): Promise<{
    images: { bytes: Buffer; mime: string; width: number; height: number }[];
    costCredits?: number;
  }>;
}
