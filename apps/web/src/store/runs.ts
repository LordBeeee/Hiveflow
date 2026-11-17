import { create } from 'zustand';
import type { Batch, NodeRun, RunOutput } from '@hiveflow/shared';

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
  if (
    current.status === 'queued' &&
    incoming.status === 'queued' &&
    !current.waiting &&
    incoming.waiting
  )
    return false;
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
  successes: Record<string, NodeRun>;
  batch: Batch | null;
  stale: Record<string, boolean>;
  requesting: Record<string, boolean>;
  requestErrors: Record<string, string | undefined>;
  uploads: Record<
    string,
    { status: 'uploading' | 'failed'; error?: string } | undefined
  >;
  reset: (spaceId: string) => void;
  merge: (run: NodeRun) => void;
  mergeSuccess: (run: NodeRun) => void;
  setBatch: (batch: Batch) => void;
  setStale: (stale: Record<string, boolean>) => void;
  setRequest: (nodeId: string, pending: boolean, error?: string) => void;
  setUpload: (nodeId: string, state: RunState['uploads'][string]) => void;
}
export const useRunStore = create<RunState>((set) => ({
  spaceId: null,
  nodes: {},
  outputs: {},
  successes: {},
  batch: null,
  stale: {},
  requesting: {},
  requestErrors: {},
  uploads: {},
  reset: (spaceId) =>
    set({
      spaceId,
      nodes: {},
      outputs: {},
      successes: {},
      batch: null,
      stale: {},
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
        nodes: {
          ...state.nodes,
          [run.nodeId]: {
            ...run,
            ...(run.progress === undefined &&
            run.status === 'running' &&
            state.nodes[run.nodeId]?.runId === run.runId
              ? { progress: state.nodes[run.nodeId]?.progress }
              : {}),
          },
        },
        ...(run.status === 'succeeded' &&
        shouldAcceptRun(state.successes[run.nodeId], run)
          ? { successes: { ...state.successes, [run.nodeId]: run } }
          : {}),
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
  mergeSuccess: (run) =>
    set((state) => {
      if (
        run.spaceId !== state.spaceId ||
        run.status !== 'succeeded' ||
        (state.nodes[run.nodeId]?.runId === run.runId &&
          !shouldAcceptRun(state.nodes[run.nodeId], run)) ||
        !shouldAcceptRun(state.successes[run.nodeId], run)
      )
        return state;
      return {
        successes: { ...state.successes, [run.nodeId]: run },
        ...(run.output
          ? { outputs: { ...state.outputs, [run.nodeId]: run.output } }
          : {}),
      };
    }),
  setBatch: (batch) =>
    set((state) => {
      if (
        batch.spaceId !== state.spaceId ||
        (state.batch &&
          (state.batch.createdAt > batch.createdAt ||
            (state.batch.batchId === batch.batchId &&
              (state.batch.completed > batch.completed ||
                (state.batch.status !== 'running' &&
                  state.batch.status !== batch.status)))))
      )
        return state;
      return { batch };
    }),
  setStale: (stale) => set({ stale }),
  setRequest: (nodeId, pending, error) =>
    set((state) => ({
      requesting: { ...state.requesting, [nodeId]: pending },
      requestErrors: { ...state.requestErrors, [nodeId]: error },
    })),
  setUpload: (nodeId, upload) =>
    set((state) => ({ uploads: { ...state.uploads, [nodeId]: upload } })),
}));
