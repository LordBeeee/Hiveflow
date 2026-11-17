import type { NodeType, RunOutput } from '@hiveflow/shared';
import type { ResolvedInputs } from './resolved-inputs';
export interface ExecutionContext {
  runId?: string;
  providerTaskId?: string | null;
  checkpointTask?: (taskId: string) => Promise<void>;
  reportProgress?: (progress: number) => void;
  spaceId: string;
  params: Record<string, unknown>;
  inputs?: ResolvedInputs;
  signal: AbortSignal;
}
export interface ExecutionResult {
  output: RunOutput;
  provider?: string;
}
export interface NodeExecutor {
  cancelTask?(taskId: string, params: Record<string, unknown>): Promise<void>;
  type: NodeType;
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
