import { useEffect, useRef, useState } from 'react';
import { type CostEstimate } from '@hiveflow/shared';
import { estimateCost } from './costs';
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
  const [quote, setQuote] = useState<CostEstimate | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (quote && !dialog.current?.open) dialog.current?.showModal();
    if (!quote && dialog.current?.open) dialog.current.close();
  }, [quote]);
  const busy = batch?.status === 'running';
  async function run() {
    if (pending || busy) return;
    setPending(true);
    try {
      await prepare();
      setQuote(await estimateCost(spaceId, force));
    } catch (error) {
      useUIStore
        .getState()
        .notify(
          error instanceof Error
            ? error.message
            : 'Could not estimate this graph',
        );
    } finally {
      setPending(false);
    }
  }
  async function confirm() {
    if (!quote || pending || quote.allowed === false) return;
    setPending(true);
    try {
      await prepare();
      await executionApi.runAll(spaceId, force, {
        version: quote.version,
        graphHash: quote.graphHash,
        maxUnits: quote.units,
        maxProviderNodes: quote.providerNodes,
      });
      setQuote(null);
      const [runs, batches] = await Promise.all([
        executionApi.history(spaceId),
        executionApi.batches(spaceId),
      ]);
      runs.forEach((run) => useRunStore.getState().merge(run));
      if (batches[0]) useRunStore.getState().setBatch(batches[0]);
    } catch (error) {
      setQuote(null);
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
      <dialog
        ref={dialog}
        className="cost-dialog"
        aria-labelledby="cost-dialog-title"
        onCancel={(event) => {
          if (pending) event.preventDefault();
          else setQuote(null);
        }}
        onClose={() => setQuote(null)}
      >
        {quote && (
          <>
            <h2 id="cost-dialog-title">Review estimated cost</h2>
            <p>
              {quote.providerNodes} provider nodes ·{' '}
              {quote.upperBound ? 'up to' : 'about'}{' '}
              <strong>{quote.units} estimated credits</strong> ·{' '}
              {quote.cachedNodes} cached
            </p>
            {quote.upperBound && (
              <p>
                Some upstream outputs are not known yet. Unused reserved credits
                are released when inputs or cache hits are resolved.
              </p>
            )}
            <p>Abstract estimates; provider pricing may differ.</p>
            {quote.limitMessage && <p role="alert">{quote.limitMessage}</p>}
            <div className="cost-dialog-actions">
              <button disabled={pending} onClick={() => setQuote(null)}>
                Cancel
              </button>
              <button
                className="header-button"
                disabled={pending || quote.allowed === false}
                onClick={() => void confirm()}
              >
                {pending ? 'Starting…' : 'Confirm run'}
              </button>
            </div>
          </>
        )}
      </dialog>
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
