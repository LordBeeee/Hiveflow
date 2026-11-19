import type { ProviderUsage } from './provider-usage';
import type { MediaInput } from './media-input';
export interface LlmRequest {
  system: string;
  messages: {
    role: 'user' | 'assistant';
    text: string;
    images?: MediaInput[];
  }[];
  model: string;
  maxTokens: number;
}
export interface LlmProvider {
  readonly id: string;
  complete(
    request: LlmRequest,
    signal: AbortSignal,
  ): Promise<{
    text: string;
    usage?: ProviderUsage;
    generationId?: string;
  }>;
}
