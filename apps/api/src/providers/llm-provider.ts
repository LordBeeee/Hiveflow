export interface LlmRequest {
  system: string;
  messages: {
    role: 'user' | 'assistant';
    text: string;
    images?: { url: string }[];
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
    usage?: { inputTokens?: number; outputTokens?: number };
  }>;
}
