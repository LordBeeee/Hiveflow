import { CostButton } from '../../api/costs';
import { useEffect, useState } from 'react';
import {
  modelCatalog,
  nodeRegistry,
  selectModel,
  type NodeDef,
  type AvailableModel,
} from '@hiveflow/shared';
import type { NodeProps } from '@xyflow/react';
import { ModelControls, useModels } from '../../api/models';
import { useExecution } from '../../api/execution';
import { useGraphStore } from '../../store/graph';
import { useRunStore } from '../../store/runs';
import { NodeFrame, type CanvasNode } from '../NodeFrame';
import { Icon } from '../../canvas/Icons';
export function VideoGeneratorNode({
  id,
  data,
  selected,
}: NodeProps<CanvasNode>) {
  const { runNode, cancelNode } = useExecution();
  const run = useRunStore((state) => state.nodes[id]);
  const video = useRunStore((state) => state.outputs[id]?.video?.[0]);
  const requesting = useRunStore((state) => state.requesting[id]);
  const requestError = useRunStore((state) => state.requestErrors[id]);
  const stale = useRunStore((state) => state.stale[id]);
  const edges = useGraphStore((state) => state.edges);
  const nodes = useGraphStore((state) => state.nodes);
  const promptEdge = edges.find(
    (edge) => edge.target === id && edge.targetHandle === 'prompt',
  );
  const source = nodes.find((node) => node.id === promptEdge?.source);
  const sourceOutput = useRunStore((state) =>
    source ? state.outputs[source.id]?.text : undefined,
  );
  const sourceLabel = source
    ? `${nodeRegistry[source.type].label} #${nodes.filter((node) => node.type === source.type).findIndex((node) => node.id === source.id) + 1}`
    : 'connected node';
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now());
  const params = nodeRegistry.video_generator.paramsSchema.parse(
    data.graphNode.params,
  );
  const models = useModels('video');
  let model: AvailableModel | undefined;
  try {
    model = selectModel(params.model, 'video', models.data ?? []);
  } catch {
    /* ModelControls explains availability. */
  }
  const busy =
    requesting || run?.status === 'queued' || run?.status === 'running';
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const endConnected = edges.some(
    (edge) => edge.target === id && edge.targetHandle === 'end_image',
  );
  const startConnected = edges.some(
    (edge) => edge.target === id && edge.targetHandle === 'start_image',
  );
  const adaptiveRatio =
    startConnected && model?.capabilities.imageToVideoRatio === 'adaptive';
  const warning =
    model?.capabilities.requiresStartImage && !startConnected
      ? `${model.label} requires a start image.`
      : endConnected && model && !model.capabilities.supportsEndImage
        ? `${model.label} does not support an end image. Disconnect it or choose another model.`
        : undefined;
  const error =
    warning ?? requestError ?? (run?.status === 'failed' ? run.error : null);
  const update = (patch: Record<string, unknown>) =>
    useGraphStore.getState().updateParams(id, patch);
  const label = `Video Generator #${data.number}`;
  const prompt = source
    ? ((nodeRegistry[source.type] as NodeDef).staticOutput?.(source.params)
        ?.text ??
      sourceOutput ??
      '')
    : promptEdge
      ? ''
      : params.prompt;
  const videoModels = modelCatalog.filter((entry) => entry.kind === 'video');
  const durations = [
    ...new Set(
      videoModels.flatMap((entry) => entry.capabilities.durations ?? []),
    ),
  ].sort((a, b) => a - b);
  const elapsed = run?.startedAt
    ? Math.max(0, Math.floor((now - new Date(run.startedAt).getTime()) / 1000))
    : 0;
  return (
    <NodeFrame
      icon="video"
      node={data.graphNode}
      number={data.number}
      selected={!!selected}
      portWarnings={warning ? { end_image: warning } : {}}
      runDisabledReason={warning}
    >
      <div className="assistant-card video-generator-card nodrag nopan">
        {video ? (
          <video
            key={video.assetId}
            controls
            preload="metadata"
            playsInline
            aria-label={`${label} video`}
            src={video.url ?? `/api/assets/${video.assetId}`}
          />
        ) : (
          <div className="video-placeholder">
            <Icon name="video" size={28} />
            <span>Bring your idea into motion.</span>
          </div>
        )}
        <div className="text-card-label">VIDEO GENERATOR</div>
        {promptEdge && (
          <div className="connected-inputs">
            <span>Prompt from {sourceLabel} · local prompt overridden</span>
          </div>
        )}
        <textarea
          className="assistant-message nowheel"
          aria-label={`${label} prompt`}
          maxLength={model?.capabilities.maxPromptChars}
          placeholder="Describe the scene you want to animate…"
          value={prompt}
          disabled={!!promptEdge}
          onChange={(event) => update({ prompt: event.target.value })}
        />
        <div className="connected-inputs">
          {['start_image', 'end_image'].map((port) =>
            edges.some(
              (edge) => edge.target === id && edge.targetHandle === port,
            ) ? (
              <span key={port}>
                {port === 'start_image' ? 'Start image' : 'End image'} connected
              </span>
            ) : null,
          )}
        </div>
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
        <div className="video-settings">
          <label>
            Duration
            <select
              aria-label={`${label} duration`}
              value={params.duration}
              onChange={(event) =>
                update({ duration: Number(event.target.value) })
              }
            >
              {[...new Set([...durations, params.duration])]
                .sort((a, b) => a - b)
                .map((value) => (
                  <option
                    key={value}
                    value={value}
                    disabled={
                      !!model && !model.capabilities.durations?.includes(value)
                    }
                  >
                    {value} s
                  </option>
                ))}
            </select>
          </label>
          <label>
            Aspect ratio
            <select
              aria-label={`${label} aspect ratio`}
              disabled={adaptiveRatio}
              title={
                adaptiveRatio
                  ? 'Aspect ratio follows the start image'
                  : undefined
              }
              value={adaptiveRatio ? 'adaptive' : params.aspectRatio}
              onChange={(event) => update({ aspectRatio: event.target.value })}
            >
              {adaptiveRatio && (
                <option value="adaptive">Auto (start image)</option>
              )}
              {['16:9', '9:16', '1:1'].map((value) => (
                <option
                  key={value}
                  disabled={
                    !!model && !model.capabilities.aspectRatios?.includes(value)
                  }
                >
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            Resolution
            <select
              aria-label={`${label} resolution`}
              value={params.resolution}
              onChange={(event) => update({ resolution: event.target.value })}
            >
              {['720p', '1080p'].map((value) => (
                <option
                  key={value}
                  disabled={
                    !!model && !model.capabilities.resolutions?.includes(value)
                  }
                >
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        {(model?.capabilities.audio === 'toggle' ||
          (!model?.capabilities.audio &&
            model?.capabilities.supportsAudio)) && (
          <label className="video-audio">
            <input
              type="checkbox"
              aria-label={`${label} generate audio`}
              checked={params.generateAudio}
              onChange={(event) =>
                update({ generateAudio: event.target.checked })
              }
            />
            Generate audio
          </label>
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
        </div>
        {busy && (
          <div className="video-progress" role="status">
            <span>
              {run?.waiting
                ? 'Waiting for inputs…'
                : run?.status === 'running'
                  ? `Generating video · ${elapsed}s`
                  : 'Queued…'}
            </span>
            <progress
              aria-label={`${label} progress`}
              max={100}
              value={run?.progress ?? 0}
            />
            <span>{run?.progress ?? 0}%</span>
          </div>
        )}
        {error && (
          <div className="run-error" role="alert">
            <span>{error}</span>
            {!warning && (
              <CostButton
                nodeId={id}
                aria-label={`Retry ${label}`}
                disabled={!!busy}
                onClick={() => void runNode(id)}
              >
                Retry
              </CostButton>
            )}
          </div>
        )}
        {video && (
          <p className="voiceover-mock">
            Mock fixture · 2 s, 320×180, silent. Settings and references
            exercise the workflow; no AI video synthesis.
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
              disabled={!!warning}
              title={warning}
              onClick={() => void runNode(id, true)}
            >
              Force rerun
            </CostButton>
          )}
          <CostButton
            nodeId={id}
            className="run-button"
            aria-label={`Run ${label}`}
            disabled={!!busy || !!warning}
            title={warning}
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
  type: nodeRegistry.video_generator.type,
  component: VideoGeneratorNode,
  icon: 'video' as const,
};
