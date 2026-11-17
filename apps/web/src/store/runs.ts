import { create } from 'zustand';
import type { NodeRun, RunOutput } from '@hiveflow/shared';

const ranks: Record<NodeRun['status'], number> = {
  queued: 0,
  running: 1,
  succeeded: 2,
  failed: 2,
  canceled: 2,
  skipped: 2,
};
export function shouldAcceptRun(
  current: NodeRun | undefined,
  incoming: NodeRun,
): boolean {
  if (!current) return true;
  if (BigInt(incoming.sequence) !== BigInt(current.sequence))
    return BigInt(incoming.sequence) > BigInt(current.sequence);
  return (
    incoming.runId === current.runId &&
    (incoming.status === current.status ||
      ranks[incoming.status] > ranks[current.status])
  );
}
interface RunState {
  spaceId: string | null;
  nodes: Record<string, NodeRun>;
  outputs: Record<string, RunOutput>;
  requesting: Record<string, boolean>;
  requestErrors: Record<string, string | undefined>;
  uploads: Record<
    string,
    { status: 'uploading' | 'failed'; error?: string } | undefined
  >;
  reset: (spaceId: string) => void;
  merge: (run: NodeRun) => void;
  setRequest: (nodeId: string, pending: boolean, error?: string) => void;
  setUpload: (nodeId: string, state: RunState['uploads'][string]) => void;
}
export const useRunStore = create<RunState>((set) => ({
  spaceId: null,
  nodes: {},
  outputs: {},
  requesting: {},
  requestErrors: {},
  uploads: {},
  reset: (spaceId) =>
    set({
      spaceId,
      nodes: {},
      outputs: {},
      requesting: {},
      requestErrors: {},
      uploads: {},
    }),
  merge: (run) =>
    set((state) => {
      if (
        run.spaceId !== state.spaceId ||
        !shouldAcceptRun(state.nodes[run.nodeId], run)
      )
        return state;
      return {
        nodes: { ...state.nodes, [run.nodeId]: run },
        ...(!state.nodes[run.nodeId] ||
        state.nodes[run.nodeId].runId !== run.runId ||
        state.nodes[run.nodeId].status !== run.status
          ? {
              requestErrors: {
                ...state.requestErrors,
                [run.nodeId]: undefined,
              },
            }
          : {}),
        ...(run.status === 'succeeded' && run.output
          ? { outputs: { ...state.outputs, [run.nodeId]: run.output } }
          : {}),
      };
    }),
  setRequest: (nodeId, pending, error) =>
    set((state) => ({
      requesting: { ...state.requesting, [nodeId]: pending },
      requestErrors: { ...state.requestErrors, [nodeId]: error },
    })),
  setUpload: (nodeId, upload) =>
    set((state) => ({ uploads: { ...state.uploads, [nodeId]: upload } })),
}));
