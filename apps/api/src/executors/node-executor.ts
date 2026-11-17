import type { NodeType, RunOutput } from '@hiveflow/shared';
export interface ExecutionContext {
  spaceId: string;
  params: Record<string, unknown>;
  signal: AbortSignal;
}
export interface ExecutionResult {
  output: RunOutput;
  provider?: string;
}
export interface NodeExecutor {
  type: NodeType;
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
