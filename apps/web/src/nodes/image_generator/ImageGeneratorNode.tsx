import { CostButton } from '../../api/costs';
import { ModelControls } from '../../api/models';
import { useRef, useState } from 'react';
import { nodeRegistry } from '@hiveflow/shared';
import { Icon } from '../../canvas/Icons';
import { useExecution } from '../../api/execution';
import { useRunStore } from '../../store/runs';
import type { NodeProps } from '@xyflow/react';
import { useGraphStore } from '../../store/graph';
import { NodeFrame, type CanvasNode } from '../NodeFrame';
export function ImageGeneratorNode({
  id,
  data,
  selected,
}: NodeProps<CanvasNode>) {
  const [modelNotice, setModelNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { runNode, attachReference, cancelNode } = useExecution();
  const run = useRunStore((state) => state.nodes[id]);
  const output = useRunStore((state) => state.outputs[id]);
  const requesting = useRunStore((state) => state.requesting[id]);
  const requestError = useRunStore((state) => state.requestErrors[id]);
  const stale = useRunStore((state) => state.stale[id]);
  const previewProvider = useRunStore((state) => state.successes[id]?.provider);
  const edges = useGraphStore((state) => state.edges);
  const nodes = useGraphStore((state) => state.nodes);
  const promptEdge = edges.find(
    (edge) => edge.target === id && edge.targetHandle === 'prompt',
  );
  const promptSource = nodes.find((node) => node.id === promptEdge?.source);
  const sourceText = useRunStore((state) =>
    promptSource ? state.outputs[promptSource.id]?.text : undefined,
  );
  const sourceLabel = promptSource
    ? `${nodeRegistry[promptSource.type].label} #${nodes.filter((node) => node.type === promptSource.type).findIndex((node) => node.id === promptSource.id) + 1}`
    : 'connected Text';
  const referenceCount = edges.filter(
    (edge) => edge.target === id && edge.targetHandle === 'references',
  ).length;
  const busy =
    requesting || run?.status === 'queued' || run?.status === 'running';
  const images = output?.image ?? [];
  const error = requestError ?? (run?.status === 'failed' ? run.error : null);
  const { prompt, count, aspectRatio, resolution } =
    nodeRegistry.image_generator.paramsSchema.parse(data.graphNode.params);
  const update = (params: Record<string, unknown>) =>
    useGraphStore.getState().updateParams(id, params);
  return (
    <NodeFrame
      icon="sparkles"
      node={data.graphNode}
      number={data.number}
      selected={!!selected}
    >
      <div className="generator-preview">
        {images.length ? (
          <div className={`generated-images image-count-${images.length}`}>
            {images.map((image, index) => (
              <a
                className="nodrag nopan"
                key={image.assetId}
                href={image.url ?? `/api/assets/${image.assetId}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open generated image ${index + 1}`}
              >
                <img
                  src={image.url ?? `/api/assets/${image.assetId}`}
                  alt={`Generated image ${index + 1}`}
                  draggable={false}
                />
              </a>
            ))}
          </div>
        ) : (
          <>
            <div className="preview-grid" />
            <span className="preview-icon">
              <Icon name="sparkles" size={30} />
            </span>
            <p>
              A little imagination.
              <br />
              <span>Infinite possibilities.</span>
            </p>
            <span className="preview-tag">IMAGE GENERATOR</span>
          </>
        )}
        {busy && (
          <div className="run-progress" role="status">
            <span className="loading-spinner" />
            <span>
              {requesting
                ? 'Preparing your run…'
                : run?.status === 'queued'
                  ? run.waiting
                    ? 'Waiting for inputs…'
                    : 'Queued…'
                  : 'Generating…'}
            </span>
          </div>
        )}
        {!busy && images.length > 0 && (
          <span className="result-label">
            {previewProvider === 'mock' ? 'MOCK PREVIEW' : 'GENERATED IMAGE'}
          </span>
        )}
      </div>
      <div className="execution-status nodrag nopan">
        {stale && <span className="stale-badge">Stale · inputs changed</span>}
        {run?.cacheHit && <span className="cache-badge">Cache hit</span>}
        {(run?.status === 'canceled' || run?.status === 'skipped') && (
          <span>
            {run.status}
            {run.error ? ` · ${run.error}` : ''}
          </span>
        )}
        {busy && run && ['queued', 'running'].includes(run.status) && (
          <button
            aria-label={`Cancel Image Generator #${data.number}`}
            onClick={() => void cancelNode(id)}
          >
            Cancel run
          </button>
        )}
        {!busy && run && (
          <CostButton
            nodeId={id}
            force
            aria-label={`Force rerun Image Generator #${data.number}`}
            onClick={() => void runNode(id, true)}
          >
            Force rerun
          </CostButton>
        )}
      </div>
      {error && (
        <div className="run-error nodrag nopan" role="alert">
          <span>{error}</span>
          <CostButton
            nodeId={id}
            aria-label={`Retry Image Generator #${data.number}`}
            disabled={!!busy}
            onClick={() => void runNode(id)}
          >
            Retry
          </CostButton>
        </div>
      )}
      <div className="generator-composer nodrag nopan">
        {(promptEdge || referenceCount > 0) && (
          <div className="connected-inputs" aria-label="Connected inputs">
            {promptEdge && (
              <span
                className="connected-prompt"
                title="The connected text replaces the local prompt for this run. Disconnect it to edit the local prompt."
              >
                Prompt from {sourceLabel} · local prompt overridden
              </span>
            )}
            {referenceCount > 0 && (
              <span className="connected-references">
                {referenceCount} reference{' '}
                {referenceCount === 1 ? 'input' : 'inputs'} connected
              </span>
            )}
          </div>
        )}
        <div className="prompt-row">
          <button
            className="attach-button"
            title="Attach a reference image"
            aria-label={`Attach reference to Image Generator #${data.number}`}
            onClick={() => input.current?.click()}
          >
            <Icon name="plus" size={17} />
          </button>
          <input
            ref={input}
            className="hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void attachReference(id, file).catch(() => {});
              event.target.value = '';
            }}
          />
          <textarea
            className="nowheel"
            aria-label={`Image Generator #${data.number} prompt`}
            placeholder="Describe the image you want to generate…"
            value={
              promptSource?.type === 'text'
                ? String(promptSource.params.value ?? '')
                : promptEdge
                  ? (sourceText ?? '')
                  : prompt
            }
            readOnly={!!promptEdge}
            aria-describedby={promptEdge ? `prompt-source-${id}` : undefined}
            title={
              promptEdge
                ? `Using ${sourceLabel}; disconnect the purple edge to edit this local prompt.`
                : undefined
            }
            onChange={(event) => update({ prompt: event.target.value })}
          />
          {promptEdge && (
            <span id={`prompt-source-${id}`} className="sr-only">
              Using connected {sourceLabel}. Local prompt is preserved and
              overridden.
            </span>
          )}
        </div>
        <ModelControls
          type={data.graphNode.type}
          params={data.graphNode.params}
          onChange={update}
          onNotice={setModelNotice}
        />
        {modelNotice && (
          <p className="model-warning" role="status">
            {modelNotice}
          </p>
        )}
        {run?.model && (
          <p className="generated-model">Generated with {run.model}</p>
        )}
        <div className="generator-settings">
          <div className="count-control">
            <button
              aria-label="Decrease image count"
              disabled={count === 1}
              onClick={() => update({ count: count - 1 })}
            >
              −
            </button>
            <span aria-label="Image count">x{count}</span>
            <button
              aria-label="Increase image count"
              disabled={count === 4}
              onClick={() => update({ count: count + 1 })}
            >
              +
            </button>
          </div>
          <select
            aria-label="Aspect ratio"
            value={aspectRatio}
            onChange={(event) => update({ aspectRatio: event.target.value })}
          >
            {['1:1', '16:9', '9:16', '4:3', '3:4'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <select
            aria-label="Resolution"
            value={resolution}
            onChange={(event) => update({ resolution: event.target.value })}
          >
            {['1K', '2K', '4K'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          <CostButton
            nodeId={id}
            className="run-button"
            aria-label={`Run Image Generator #${data.number}`}
            disabled={!!busy}
            onClick={() => void runNode(id)}
          >
            <Icon name="play" size={12} />
            Run
          </CostButton>
        </div>
      </div>
    </NodeFrame>
  );
}

export const nodeUI = {
  type: nodeRegistry.image_generator.type,
  component: ImageGeneratorNode,
  icon: 'sparkles' as const,
};
