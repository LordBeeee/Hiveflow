import { useState } from 'react';
import { executionApi } from './execution';
import { useRunStore } from '../store/runs';
import { useUIStore } from '../store/ui';
export function RunControls({
  spaceId,
  prepare,
}: {
  spaceId: string;
  prepare: () => Promise<void>;
}) {
  const batch = useRunStore((state) => state.batch);
  const [pending, setPending] = useState(false);
  const [force, setForce] = useState(false);
  const busy = batch?.status === 'running';
  async function run() {
    if (pending || busy) return;
    setPending(true);
    try {
      await prepare();
      await executionApi.runAll(spaceId, force);
      const [runs, batches] = await Promise.all([
        executionApi.history(spaceId),
        executionApi.batches(spaceId),
      ]);
      runs.forEach((run) => useRunStore.getState().merge(run));
      if (batches[0]) useRunStore.getState().setBatch(batches[0]);
    } catch (error) {
      useUIStore
        .getState()
        .notify(error instanceof Error ? error.message : 'Could not run graph');
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    if (!batch) return;
    try {
      useRunStore
        .getState()
        .setBatch(await executionApi.cancelBatch(batch.batchId));
    } catch (error) {
      useUIStore
        .getState()
        .notify(
          error instanceof Error ? error.message : 'Could not cancel batch',
        );
    }
  }
  return (
    <div className="run-controls">
      {batch && (
        <span role="status" aria-label="Batch status">
          {batch.status === 'running' ? 'Running' : batch.status} ·{' '}
          {batch.completed}/{batch.total}
        </span>
      )}
      <label>
        <input
          type="checkbox"
          checked={force}
          disabled={pending || busy}
          onChange={(event) => setForce(event.target.checked)}
        />
        Force rerun
      </label>
      {busy ? (
        <button className="header-button" onClick={() => void cancel()}>
          Cancel batch
        </button>
      ) : (
        <button
          className="header-button run-all"
          disabled={pending}
          onClick={() => void run()}
        >
          {pending ? 'Preparing…' : 'Run all'}
        </button>
      )}
    </div>
  );
}
