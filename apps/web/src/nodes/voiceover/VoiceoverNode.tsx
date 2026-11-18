import { CostButton } from '../../api/costs';
import { useState } from 'react';
import { nodeRegistry, selectModel, type NodeDef } from '@hiveflow/shared';
import type { NodeProps } from '@xyflow/react';
import { ModelControls, useModels } from '../../api/models';
import { useExecution } from '../../api/execution';
import { useGraphStore } from '../../store/graph';
import { useRunStore } from '../../store/runs';
import { NodeFrame, type CanvasNode } from '../NodeFrame';
import { Icon } from '../../canvas/Icons';
function durationLabel(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function VoiceoverNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { runNode, cancelNode } = useExecution();
  const run = useRunStore((state) => state.nodes[id]);
  const audio = useRunStore((state) => state.outputs[id]?.audio?.[0]);
  const previewProvider = useRunStore((state) => state.successes[id]?.provider);
  const requesting = useRunStore((state) => state.requesting[id]);
  const requestError = useRunStore((state) => state.requestErrors[id]);
  const stale = useRunStore((state) => state.stale[id]);
  const edges = useGraphStore((state) => state.edges);
  const nodes = useGraphStore((state) => state.nodes);
  const scriptEdge = edges.find(
    (edge) => edge.target === id && edge.targetHandle === 'script',
  );
  const source = nodes.find((node) => node.id === scriptEdge?.source);
  const sourceOutput = useRunStore((state) =>
    source ? state.outputs[source.id]?.text : undefined,
  );
  const sourceLabel = source
    ? `${nodeRegistry[source.type].label} #${nodes.filter((node) => node.type === source.type).findIndex((node) => node.id === source.id) + 1}`
    : 'connected node';
  const [notice, setNotice] = useState('');
  const params = nodeRegistry.voiceover.paramsSchema.parse(
    data.graphNode.params,
  );
  const models = useModels('tts');
  let model;
  try {
    model = selectModel(params.model, 'tts', models.data ?? []);
  } catch {
    /* ModelControls shows the availability warning. */
  }
  const voices = model?.capabilities.voices ?? [];
  const languages = model?.capabilities.languages ?? [];
  const busy =
    requesting || run?.status === 'queued' || run?.status === 'running';
  const error = requestError ?? (run?.status === 'failed' ? run.error : null);
  const update = (patch: Record<string, unknown>) =>
    useGraphStore.getState().updateParams(id, patch);
  const label = `Voiceover #${data.number}`;
  const script = source
    ? ((nodeRegistry[source.type] as NodeDef).staticOutput?.(source.params)
        ?.text ??
      sourceOutput ??
      '')
    : scriptEdge
      ? ''
      : params.script;
  return (
    <NodeFrame
      icon="audio"
      node={data.graphNode}
      number={data.number}
      selected={!!selected}
    >
      <div className="assistant-card voiceover-card nodrag nopan">
        <div className="text-card-label">SCRIPT / VOICEOVER</div>
        {scriptEdge && (
          <div className="connected-inputs">
            <span title="Disconnect the text edge to restore the local script.">
              Script from {sourceLabel} · local script overridden
            </span>
          </div>
        )}
        <textarea
          className="assistant-message nowheel"
          aria-label={`${label} script`}
          maxLength={5000}
          placeholder="Write the script you want to narrate…"
          value={script}
          disabled={!!scriptEdge}
          title={
            scriptEdge
              ? `Using ${sourceLabel}; disconnect to edit the local script.`
              : undefined
          }
          onChange={(event) => update({ script: event.target.value })}
        />
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
        <label className="assistant-preset">
          Voice
          <select
            aria-label={`${label} voice`}
            value={params.voice}
            onChange={(event) => update({ voice: event.target.value })}
          >
            {!voices.includes(params.voice) && (
              <option value={params.voice}>{params.voice} · unavailable</option>
            )}
            {voices.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </select>
        </label>
        <label className="assistant-preset">
          Language
          <select
            aria-label={`${label} language`}
            value={params.language}
            onChange={(event) => update({ language: event.target.value })}
          >
            {!languages.includes(params.language) && (
              <option value={params.language}>
                {params.language} · unavailable
              </option>
            )}
            {languages.map((language) => (
              <option key={language} value={language}>
                {language === 'auto'
                  ? 'Auto'
                  : language === 'en'
                    ? 'English'
                    : language === 'vi'
                      ? 'Vietnamese'
                      : language}
              </option>
            ))}
          </select>
        </label>
        <label className="voiceover-speed">
          Speed <span>{params.speed.toFixed(2)}×</span>
          <input
            className="nodrag"
            aria-label={`${label} speed`}
            type="range"
            min={model?.capabilities.speed?.min ?? 0.75}
            max={model?.capabilities.speed?.max ?? 1.5}
            step={0.05}
            value={params.speed}
            onChange={(event) => update({ speed: Number(event.target.value) })}
          />
        </label>
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
                  : 'Creating audio…'}
            </span>
          )}
        </div>
        {error && (
          <div className="run-error" role="alert">
            <span>{error}</span>
            <CostButton
              nodeId={id}
              aria-label={`Retry ${label}`}
              disabled={!!busy}
              onClick={() => void runNode(id)}
            >
              Retry
            </CostButton>
          </div>
        )}
        {audio ? (
          <div className="voiceover-result">
            <audio
              key={audio.assetId}
              controls
              preload="metadata"
              aria-label={`${label} audio`}
              src={audio.url ?? `/api/assets/${audio.assetId}`}
            />
            <div className="assistant-result-header">
              <span aria-label={`${label} duration`}>
                Duration{' '}
                {audio.durationMs == null
                  ? 'unknown'
                  : durationLabel(audio.durationMs)}
              </span>
              <a
                href={audio.url ?? `/api/assets/${audio.assetId}`}
                download
                aria-label={`Download ${label} audio`}
              >
                Download audio
              </a>
            </div>
            {previewProvider === 'mock' && (
              <p className="voiceover-mock">
                Mock tone preview · not spoken narration
              </p>
            )}
          </div>
        ) : (
          <p className="voiceover-placeholder">
            Your audio will appear here. Connect the audio output to continue
            your workflow.
          </p>
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
            <CostButton
              nodeId={id}
              force
              aria-label={`Force rerun ${label}`}
              onClick={() => void runNode(id, true)}
            >
              Force rerun
            </CostButton>
          )}
          <CostButton
            nodeId={id}
            className="run-button"
            aria-label={`Run ${label}`}
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
  type: nodeRegistry.voiceover.type,
  component: VoiceoverNode,
  icon: 'audio' as const,
};
