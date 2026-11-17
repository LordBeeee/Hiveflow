export interface ImageRequest {
  prompt: string;
  references: { url: string }[];
  count: number;
  aspectRatio: string;
  resolution: '1K' | '2K' | '4K';
  model: string;
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
export const IMAGE_PROVIDER = Symbol('IMAGE_PROVIDER');
