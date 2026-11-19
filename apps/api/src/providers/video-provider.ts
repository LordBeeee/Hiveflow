import type { MediaInput } from './media-input';
import type { Readable } from 'node:stream';
export interface VideoRequest {
  requestId: string;
  prompt: string;
  model: string;
  duration: number;
  aspectRatio: string;
  resolution: string;
  generateAudio: boolean;
  startImage?: MediaInput;
  endImage?: MediaInput;
  options?: Record<string, string | number | boolean>;
}
export interface VideoProvider {
  id: string;
  submit(
    request: VideoRequest,
    signal: AbortSignal,
  ): Promise<{ taskId: string }>;
  poll(
    taskId: string,
    signal: AbortSignal,
  ): Promise<{
    status: 'queued' | 'running' | 'succeeded' | 'failed';
    progress?: number;
    result?: {
      stream: Readable;
      mime: string;
      width?: number;
      height?: number;
      durationMs?: number;
    };
    error?: string;
    usage?: { outputTokens?: number };
    costUsd?: number;
  }>;
  cancel?(taskId: string): Promise<void | boolean>;
}
