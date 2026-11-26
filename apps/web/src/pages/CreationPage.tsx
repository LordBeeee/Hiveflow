import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  creationHistorySchema,
  creationNodeTypes,
  creationQuoteSchema,
  creationRequestSchema,
  nodeRegistry,
  selectModel,
  coerceParamsForModel,
  type CreationKind,
  type CreationRun,
} from '@hiveflow/shared';
import { request } from '../api/spaces';
import { executionApi } from '../api/execution';
import { ModelControls, useModels } from '../api/models';
import { useCreateSpace } from '../api/useCreateSpace';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { GenerationSettings } from '../components/GenerationSettings';
import { creationTools } from '../components/workspaceTools';
import { Icon } from '../canvas/Icons';
import './CreationPage.css';

function loadDraft(kind: CreationKind) {
  try {
    const draft = creationRequestSchema.parse(
      JSON.parse(localStorage.getItem(`creation-draft:${kind}`) ?? 'null'),
    );
    draft.params = nodeRegistry[creationNodeTypes[kind]].paramsSchema.parse(
      draft.params,
    );
    return draft;
  } catch {
    return creationRequestSchema.parse({
      params: structuredClone(
        nodeRegistry[creationNodeTypes[kind]].defaultParams,
      ),
    });
  }
}

function Results({ run, kind }: { run?: CreationRun; kind: CreationKind }) {
  const media = run?.output?.[kind];
  if (!run || !media?.length)
    return (
      <div className="creation-empty">
        <Icon name={kind === 'audio' ? 'audio' : kind} size={40} />
        <h2>
          {run?.status === 'queued'
            ? 'In the queue'
            : run?.status === 'running'
              ? 'Creating your result…'
              : run?.status === 'failed'
                ? 'Generation failed'
                : run?.status === 'canceled'
                  ? 'Generation canceled'
                  : 'Ready when you are'}
        </h2>
        <p>{run?.error ?? 'Choose a model, add your content and generate.'}</p>
        {run?.status === 'running' && (
          <progress
            aria-label="Generation progress"
            max={100}
            value={run.progress}
          />
        )}
      </div>
    );
  return (
    <div className={`creation-results creation-results-${kind}`}>
      <div className="creation-result-info">
        <span className="creation-status" data-status={run.status}>
          {run.status}
        </span>
        <strong>{run.model}</strong>
        <p>
          {String(run.params[kind === 'audio' ? 'script' : 'prompt'] ?? '')}
        </p>
        <small>{new Date(run.createdAt).toLocaleString()}</small>
      </div>
      {run.cacheHit && (
        <p className="creation-result-note">
          Reused cached result · no provider call
        </p>
      )}
      <div className="creation-media-grid">
        {media.map((asset) => (
          <div className="creation-output" key={asset.assetId}>
            {kind === 'image' ? (
              <img
                src={asset.url ?? `/api/assets/${asset.assetId}`}
                alt="Generated image"
              />
            ) : kind === 'video' ? (
              <video
                src={asset.url ?? `/api/assets/${asset.assetId}`}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <audio
                src={asset.url ?? `/api/assets/${asset.assetId}`}
                controls
                preload="metadata"
              />
            )}
            <a href={`/api/assets/${asset.assetId}?download=1`}>
              <Icon name="download" size={15} />
              Download
            </a>
          </div>
        ))}
      </div>
      <p className="creation-result-note">Saved to Library</p>
    </div>
  );
}

export function CreationPage({ kind }: { kind: CreationKind }) {
  const type = creationNodeTypes[kind];
  const tool = creationTools.find((tool) => tool.type === type)!;
  const [draft, setDraft] = useState(() => loadDraft(kind));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const sessionPromise = useRef<Promise<string> | null>(null);
  const createSpace = useCreateSpace();
  const queryClient = useQueryClient();
  const history = useQuery({
    queryKey: ['creations', kind],
    queryFn: async () =>
      creationHistorySchema.parse(await request(`/creations/${kind}/runs`)),
    refetchInterval: 2000,
  });
  const models = useModels(kind === 'audio' ? 'tts' : kind);
  let model: ReturnType<typeof selectModel> | undefined;
  try {
    model = selectModel(
      String(draft.params.model),
      kind === 'audio' ? 'tts' : kind,
      models.data ?? [],
    );
  } catch {
    /* ModelControls shows availability. */
  }
  useEffect(() => {
    if (!model) return;
    const selectedModel = model;
    setDraft((current) => {
      const coerced = coerceParamsForModel(type, current.params, selectedModel);
      coerced.params.model = current.params.model;
      return JSON.stringify(coerced.params) === JSON.stringify(current.params)
        ? current
        : { ...current, params: coerced.params };
    });
    // Apply model defaults on catalog/selection changes without overwriting prompt edits.
  }, [model, type]);
  const update = (patch: Record<string, unknown>) =>
    setDraft((current) => ({
      ...current,
      params: { ...current.params, ...patch },
    }));
  const signature = JSON.stringify({ ...draft, approval: undefined });
  const [quoteSignature, setQuoteSignature] = useState('');
  const text = String(
    draft.params[kind === 'audio' ? 'script' : 'prompt'] ?? '',
  );
  useEffect(() => {
    const timer = setTimeout(() => setQuoteSignature(signature), 400);
    return () => clearTimeout(timer);
  }, [signature]);
  useEffect(() => {
    try {
      localStorage.setItem(`creation-draft:${kind}`, signature);
    } catch {
      /* Draft storage may be unavailable. */
    }
  }, [kind, signature]);
  const quote = useQuery({
    queryKey: ['creation-quote', kind, quoteSignature],
    queryFn: async ({ signal }) =>
      creationQuoteSchema.parse(
        await request(`/creations/${kind}/estimate`, {
          method: 'POST',
          body: quoteSignature,
          signal,
        }),
      ),
    enabled:
      !!quoteSignature &&
      !!model &&
      !!text.trim() &&
      quoteSignature === signature &&
      !uploading,
    retry: false,
  });
  const active = history.data?.runs.find(
    (run) => run.status === 'queued' || run.status === 'running',
  );
  const selected = selectedId
    ? history.data?.runs.find((run) => run.runId === selectedId)
    : history.data?.runs[0];
  const generate = useMutation({
    mutationFn: async () => {
      if (!quote.data || quoteSignature !== signature)
        throw new Error('Wait for the current cost estimate.');
      return (await request(`/creations/${kind}/runs`, {
        method: 'POST',
        body: JSON.stringify({
          ...draft,
          approval: {
            fingerprint: quote.data.fingerprint,
            maxUnits: quote.data.units,
          },
        }),
      })) as { runId: string };
    },
    onSuccess: async (result) => {
      await history.refetch();
      setSelectedId(result.runId);
      await queryClient.invalidateQueries({ queryKey: ['library'] });
    },
    onError: () => {
      void quote.refetch();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => executionApi.cancel(id),
    onSuccess: () => {
      void history.refetch();
    },
  });
  const busy = generate.isPending || !!active || uploading;
  const settingsSummary = (
    kind === 'audio'
      ? [draft.params.voice, draft.params.language, `${draft.params.speed}×`]
      : [
          draft.params.aspectRatio,
          draft.params.resolution,
          kind === 'video'
            ? `${draft.params.duration}s`
            : `${draft.params.count} images`,
        ]
  )
    .filter(Boolean)
    .join(' · ');
  async function session() {
    if (history.data?.sessionId) return history.data.sessionId;
    sessionPromise.current ??= request(`/creations/${kind}/session`, {
      method: 'POST',
    })
      .then((value) => (value as { sessionId: string }).sessionId)
      .catch((error) => {
        sessionPromise.current = null;
        throw error;
      });
    return sessionPromise.current;
  }
  async function upload(
    files: FileList | null,
    port: 'references' | 'startImage' | 'endImage',
  ) {
    if (!files?.length || uploading) return;
    // FileList is live and the input is cleared immediately after this handler.
    const chosenFiles = Array.from(files);
    if (
      port === 'references' &&
      draft.references.length + chosenFiles.length >
        Math.min(10, model?.capabilities.maxReferences ?? 10)
    ) {
      setNotice('Too many reference images for this model.');
      return;
    }
    setUploading(true);
    setNotice('');
    try {
      const id = await session();
      for (const file of chosenFiles) {
        if (
          model?.capabilities.maxImageMb &&
          file.size > model.capabilities.maxImageMb * 1024 * 1024
        )
          throw new Error(`Image exceeds ${model.capabilities.maxImageMb} MB.`);
        const asset = await executionApi.upload(id, file);
        setDraft((current) =>
          port === 'references'
            ? { ...current, references: [...current.references, asset.id] }
            : { ...current, [port]: asset.id },
        );
        if (port !== 'references') break;
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }
  function referenceInput(
    port: 'references' | 'startImage' | 'endImage',
    label: string,
    disabled = false,
  ) {
    const ids =
      port === 'references'
        ? draft.references
        : draft[port]
          ? [draft[port]!]
          : [];
    return (
      <div className="creation-reference">
        <label>
          {label}
          <input
            aria-label={label}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
            disabled={
              busy ||
              disabled ||
              (port === 'references' &&
                ids.length >= (model?.capabilities.maxReferences ?? 10))
            }
            multiple={port === 'references'}
            onChange={(event) => {
              void upload(event.target.files, port);
              event.target.value = '';
            }}
          />
        </label>
        <div className="creation-reference-list">
          {ids.map((id) => (
            <div key={id}>
              <img src={`/api/assets/${id}`} alt={label} />
              <button
                type="button"
                aria-label={`Remove ${label} ${id}`}
                disabled={busy}
                onClick={() =>
                  setDraft((current) =>
                    port === 'references'
                      ? {
                          ...current,
                          references: current.references.filter(
                            (value) => value !== id,
                          ),
                        }
                      : { ...current, [port]: undefined },
                  )
                }
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <WorkspaceLayout
      active={kind}
      creating={createSpace.isPending}
      onCreate={() => {
        if (!createSpace.isPending) createSpace.mutate();
      }}
    >
      <div className="creation-studio">
        <div className="creation-heading">
          <div>
            <h1>Create {kind === 'audio' ? 'voice' : kind}</h1>
            <p>Choose your model. Bring your idea to life.</p>
          </div>
          <nav aria-label="Creation tools">
            {creationTools.map((entry) => (
              <a
                key={entry.label}
                href={entry.href}
                aria-current={entry.type === type ? 'page' : undefined}
              >
                <Icon name={entry.icon} size={16} />
                {entry.label}
              </a>
            ))}
          </nav>
        </div>
        {createSpace.error && (
          <p className="page-error" role="alert">
            {createSpace.error.message}
          </p>
        )}
        <div className="creation-workbench">
          <form
            className="creation-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !busy &&
                model &&
                quote.data &&
                quoteSignature === signature &&
                !quote.isFetching
              )
                generate.mutate();
            }}
          >
            <fieldset className="creation-form-body" disabled={busy}>
              <section>
                <h2>Model</h2>
                <ModelControls
                  variant="panel"
                  type={type}
                  params={draft.params}
                  onChange={update}
                  onNotice={setNotice}
                />
              </section>
              {kind === 'image' &&
                referenceInput(
                  'references',
                  'Reference images',
                  model?.capabilities.supportsImageInput === false,
                )}
              {kind === 'video' && (
                <section>
                  <h2>Frames</h2>
                  {referenceInput(
                    'startImage',
                    model?.capabilities.requiresStartImage
                      ? 'Start image (required)'
                      : 'Start image',
                  )}
                  {referenceInput(
                    'endImage',
                    'End image',
                    !model?.capabilities.supportsEndImage,
                  )}
                </section>
              )}
              <section>
                <label className="creation-text-label" htmlFor="creation-text">
                  {kind === 'audio' ? 'Script' : 'Prompt'}
                  <span>
                    {text.length}
                    {model?.capabilities.maxPromptChars
                      ? ` / ${model.capabilities.maxPromptChars}`
                      : kind === 'audio'
                        ? ' / 5000'
                        : ''}
                  </span>
                </label>
                <textarea
                  id="creation-text"
                  aria-label={kind === 'audio' ? 'Script' : 'Prompt'}
                  value={text}
                  maxLength={
                    kind === 'audio'
                      ? 5000
                      : (model?.capabilities.maxPromptChars ?? 32000)
                  }
                  placeholder={
                    kind === 'audio'
                      ? 'Write what you want your voice to say…'
                      : 'Describe what you want to create…'
                  }
                  onChange={(event) =>
                    update({
                      [kind === 'audio' ? 'script' : 'prompt']:
                        event.target.value,
                    })
                  }
                  required
                />
              </section>
            </fieldset>
            <div className="creation-form-footer">
              <details className="creation-settings-panel">
                <summary>
                  <span>
                    <strong>Settings</strong>
                    <small>{settingsSummary}</small>
                  </span>
                  <span
                    className="creation-settings-chevron"
                    aria-hidden="true"
                  >
                    ⌄
                  </span>
                </summary>
                <fieldset disabled={busy}>
                  <GenerationSettings
                    kind={kind}
                    params={draft.params}
                    model={model}
                    onChange={update}
                    hasStartImage={!!draft.startImage}
                  />
                  <label className="creation-checkbox">
                    <input
                      type="checkbox"
                      checked={draft.force}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          force: event.target.checked,
                        }))
                      }
                    />
                    Generate fresh (ignore cache)
                  </label>
                </fieldset>
              </details>
              {notice && (
                <p className="creation-notice" role="status">
                  {notice}
                </p>
              )}
              {quote.error && quoteSignature === signature && (
                <p className="creation-notice" role="alert">
                  {quote.error.message}
                </p>
              )}
              {generate.error && (
                <p className="creation-notice" role="alert">
                  {generate.error.message}
                </p>
              )}
              {cancel.error && (
                <p className="creation-notice" role="alert">
                  {cancel.error.message}
                </p>
              )}
              {uploading && <p role="status">Uploading reference…</p>}
              <div className="creation-submit">
                <span>
                  Estimated cost
                  <strong>
                    {quote.data &&
                    quoteSignature === signature &&
                    !quote.isFetching
                      ? `Up to ${quote.data.units} credits`
                      : '—'}
                  </strong>
                </span>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    !model ||
                    !quote.data ||
                    quote.isFetching ||
                    quoteSignature !== signature ||
                    !!quote.error
                  }
                >
                  {generate.isPending
                    ? 'Submitting…'
                    : `Generate ${kind === 'audio' ? 'voice' : kind}`}
                </button>
              </div>
            </div>
          </form>
          <section className="creation-preview" aria-label="Generation result">
            <header className="creation-panel-heading">
              <h2>Preview</h2>
              <span>
                {selected ? 'Your creation' : 'Your next idea starts here'}
              </span>
            </header>
            <div className="creation-preview-body">
              <Results run={selected} kind={kind} />
            </div>
            {active && (
              <div className="creation-active" role="status">
                <span>
                  {active.status === 'queued' ? 'Queued' : 'Generating'}
                  {active.progress != null ? ` · ${active.progress}%` : ''}
                </span>
                <button
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(active.runId)}
                >
                  Cancel generation
                </button>
              </div>
            )}
          </section>
          <details
            className="creation-history"
            aria-label="Recent generations"
            open
          >
            <summary>
              <h2>Recent generations</h2>
              <span className="creation-history-count">
                {history.data?.runs.length ?? 0}
              </span>
            </summary>
            <div className="creation-history-toolbar">
              <span>Latest creations</span>
              <button
                aria-label="Refresh history"
                onClick={() => void history.refetch()}
              >
                <Icon name="redo" size={17} />
              </button>
            </div>
            <div className="creation-history-list">
              {history.isPending && <p role="status">Loading history…</p>}
              {history.error && (
                <p role="alert">
                  Could not load history.{' '}
                  <button onClick={() => void history.refetch()}>Retry</button>
                </p>
              )}
              {history.data?.runs.length === 0 && (
                <p>Your creations will appear here.</p>
              )}
              {history.data?.runs.map((run) => (
                <button
                  key={run.runId}
                  className={`creation-history-item ${selected?.runId === run.runId ? 'selected' : ''}`}
                  aria-pressed={selected?.runId === run.runId}
                  onClick={() => {
                    setSelectedId(run.runId);
                  }}
                >
                  <span className="creation-history-thumbnail">
                    {kind === 'image' && run.output?.image?.[0] ? (
                      <img
                        src={
                          run.output.image[0].url ??
                          `/api/assets/${run.output.image[0].assetId}`
                        }
                        alt=""
                        loading="lazy"
                      />
                    ) : kind === 'video' && run.output?.video?.[0] ? (
                      <video
                        src={
                          run.output.video[0].url ??
                          `/api/assets/${run.output.video[0].assetId}`
                        }
                        muted
                        playsInline
                        preload="metadata"
                        aria-hidden="true"
                      />
                    ) : (
                      <Icon name={tool.icon} size={20} />
                    )}
                    <span
                      className="creation-history-dot"
                      data-status={run.status}
                    />
                  </span>
                  <span className="creation-history-text">
                    <strong>
                      {String(
                        run.params[kind === 'audio' ? 'script' : 'prompt'] ??
                          '',
                      ).slice(0, 80)}
                    </strong>
                    <small>
                      {run.status} · {new Date(run.createdAt).toLocaleString()}
                    </small>
                    <small className="creation-history-model">
                      {run.model}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            {selected && (
              <button
                className="creation-reuse"
                disabled={busy}
                onClick={() => {
                  setDraft(
                    creationRequestSchema.parse({
                      params: selected.params,
                      references: selected.references,
                      startImage: selected.startImage,
                      endImage: selected.endImage,
                    }),
                  );
                  setNotice('Settings restored from this generation.');
                }}
              >
                Use selected settings
              </button>
            )}
          </details>
        </div>
      </div>
    </WorkspaceLayout>
  );
}
