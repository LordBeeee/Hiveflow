import { useState } from 'react';
import { assistantPresets, nodeRegistry } from '@hiveflow/shared';
import type { NodeProps } from '@xyflow/react';
import { ModelControls } from '../../api/models';
import { useExecution } from '../../api/execution';
import { useGraphStore } from '../../store/graph';
import { useRunStore } from '../../store/runs';
import { NodeFrame, type CanvasNode } from '../NodeFrame';
import { Icon } from '../../canvas/Icons';
export function AssistantNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { runNode, cancelNode } = useExecution();
  const run = useRunStore((state) => state.nodes[id]);
  const text = useRunStore((state) => state.outputs[id]?.text);
  const requesting = useRunStore((state) => state.requesting[id]);
  const requestError = useRunStore((state) => state.requestErrors[id]);
  const stale = useRunStore((state) => state.stale[id]);
  const edges = useGraphStore((state) => state.edges);
  const [notice, setNotice] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const params = nodeRegistry.assistant.paramsSchema.parse(
    data.graphNode.params,
  );
  const busy =
    requesting || run?.status === 'queued' || run?.status === 'running';
  const error = requestError ?? (run?.status === 'failed' ? run.error : null);
  const update = (patch: Record<string, unknown>) =>
    useGraphStore.getState().updateParams(id, patch);
  const label = `Assistant #${data.number}`;
  const connected = edges.filter((edge) => edge.target === id);
  return (
    <NodeFrame
      icon="sparkles"
      node={data.graphNode}
      number={data.number}
      selected={!!selected}
    >
      <div className="assistant-card nodrag nopan">
        <div className="text-card-label">YOUR CREATIVE ASSISTANT</div>
        {connected.length > 0 && (
          <div className="connected-inputs">
            {['context', 'images'].map((port) => {
              const count = connected.filter(
                (edge) => edge.targetHandle === port,
              ).length;
              return count ? (
                <span key={port}>
                  {count} {port} input{count === 1 ? '' : 's'} connected
                </span>
              ) : null;
            })}
          </div>
        )}
        <textarea
          className="assistant-message nowheel"
          aria-label={`${label} message`}
          maxLength={8000}
          placeholder="What would you like to create? Add instructions to your connected context…"
          value={params.message}
          onChange={(event) => update({ message: event.target.value })}
        />
        <label className="assistant-preset">
          Preset
          <select
            aria-label={`${label} preset`}
            value={params.preset}
            onChange={(event) => update({ preset: event.target.value })}
          >
            {Object.entries(assistantPresets).map(([key, preset]) => (
              <option value={key} key={key}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <ModelControls
          type={data.graphNode.type}
          params={data.graphNode.params}
          onChange={update}
          onNotice={setNotice}
        />
        {notice && (
          <p className="model-warning" role="status">
            {notice}
          </p>
        )}
        <div className="execution-status">
          {stale && <span className="stale-badge">Stale · inputs changed</span>}
          {run?.cacheHit && <span className="cache-badge">Cache hit</span>}
          {(run?.status === 'canceled' || run?.status === 'skipped') && (
            <span>
              {run.status}
              {run.error ? ` · ${run.error}` : ''}
            </span>
          )}
          {busy && (
            <span role="status">
              {requesting
                ? 'Preparing your run…'
                : run?.status === 'queued'
                  ? run.waiting
                    ? 'Waiting for inputs…'
                    : 'Queued…'
                  : 'Writing…'}
            </span>
          )}
        </div>
        {error && (
          <div className="run-error" role="alert">
            <span>{error}</span>
            <button
              aria-label={`Retry ${label}`}
              disabled={!!busy}
              onClick={() => void runNode(id)}
            >
              Retry
            </button>
          </div>
        )}
        <div className="assistant-result-header">
          <span>RESULT · TEXT</span>
          <button
            aria-label={`Copy ${label} result`}
            disabled={!text}
            onClick={() => {
              if (text)
                void navigator.clipboard.writeText(text).then(
                  () => setCopyStatus('Copied'),
                  () =>
                    setCopyStatus(
                      'Copy failed. Select the result and copy it manually.',
                    ),
                );
            }}
          >
            Copy
          </button>
        </div>
        <pre
          className="assistant-result nowheel"
          aria-label={`${label} result`}
          tabIndex={0}
        >
          {text ??
            'Your result will appear here. Connect the text output to continue your workflow.'}
        </pre>
        {copyStatus && (
          <span role="status" className="assistant-copy-status">
            {copyStatus}
          </span>
        )}
        {run?.model && (
          <p className="generated-model">Generated with {run.model}</p>
        )}
        <div className="assistant-actions">
          {busy && run && (
            <button
              aria-label={`Cancel ${label}`}
              onClick={() => void cancelNode(id)}
            >
              Cancel run
            </button>
          )}
          {!busy && run && (
            <button
              aria-label={`Force rerun ${label}`}
              onClick={() => void runNode(id, true)}
            >
              Force rerun
            </button>
          )}
          <button
            className="run-button"
            aria-label={`Run ${label}`}
            disabled={!!busy}
            onClick={() => void runNode(id)}
          >
            <Icon name="play" size={12} />
            Run
          </button>
        </div>
      </div>
    </NodeFrame>
  );
}
export const nodeUI = {
  type: nodeRegistry.assistant.type,
  component: AssistantNode,
  icon: 'sparkles' as const,
};
