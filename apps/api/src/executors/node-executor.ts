import type { NodeType, RunOutput } from '@hiveflow/shared';
import type { ResolvedInputs } from './resolved-inputs';
export interface ExecutionContext {
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
  type: NodeType;
  execute(context: ExecutionContext): Promise<ExecutionResult>;
}
