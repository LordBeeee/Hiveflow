import type { ProviderUsage } from './provider-usage';
export interface TtsRequest {
  text: string;
  voice: string;
  language: string;
  speed: number;
  model: string;
}
export interface TtsProvider {
  readonly id: string;
  synthesize(
    request: TtsRequest,
    signal: AbortSignal,
  ): Promise<{
    bytes: Buffer;
    mime: string;
    durationMs: number;
    usage?: ProviderUsage;
    generationId?: string;
  }>;
}
