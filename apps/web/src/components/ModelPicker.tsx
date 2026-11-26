import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AvailableModel, ModelKind } from '@hiveflow/shared';
import { Icon } from '../canvas/Icons';
import './ModelPicker.css';

function capabilityTags(model: AvailableModel) {
  const caps = model.capabilities;
  const tags: string[] = [];
  if (model.kind === 'image' || model.kind === 'video') {
    if (caps.resolutions?.length) tags.push(caps.resolutions.join(' · '));
    if (model.kind === 'image' && caps.supportsImageInput && caps.maxReferences)
      tags.push(`Up to ${caps.maxReferences} reference images`);
    if (model.kind === 'video') {
      if (caps.durations?.length)
        tags.push(`${caps.durations.join(' / ')} seconds`);
      if (caps.audio === 'included') tags.push('Audio included');
      else if (caps.audio === 'toggle' || caps.supportsAudio)
        tags.push('Optional audio');
    }
  } else if (model.kind === 'tts') {
    if (caps.voices?.length) tags.push(`${caps.voices.length} voices`);
    if (caps.languages?.length) tags.push(caps.languages.join(' · '));
    if (
      caps.supportsSpeed !== false &&
      (caps.speed || caps.speedValues?.length)
    )
      tags.push('Adjustable speed');
  }
  return tags.slice(0, 3);
}

export function ModelPicker({
  models,
  selected,
  kind,
  loading,
  onSelect,
}: {
  models: AvailableModel[];
  selected?: AvailableModel;
  kind?: ModelKind;
  loading: boolean;
  onSelect: (id: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const dialogId = useId();
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (model: AvailableModel) =>
    [model.label, model.id, model.provider, model.providerModelId]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalized);
  const filtered = models.filter(matches);
  const label = kind === 'tts' ? 'voice' : (kind ?? '');

  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    search.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  function close() {
    dialog.current?.close();
  }
  function choose(id: string) {
    if (onSelect(id)) close();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="model-picker-trigger"
        aria-label="Choose model"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        disabled={loading && !models.length}
        onClick={() => {
          setQuery('');
          setOpen(true);
        }}
      >
        <span>
          <small>
            {loading && !models.length
              ? 'Loading catalog…'
              : (selected?.provider ?? 'Model')}
          </small>
          <strong>{selected?.label ?? 'Choose a model'}</strong>
        </span>
        <Icon name="chevron" size={18} />
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          id={dialogId}
          className="model-picker-dialog"
          aria-labelledby={titleId}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Tab') return;
            const controls = event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled)',
            );
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              close();
          }}
        >
          <header className="model-picker-header">
            <div className="model-picker-heading">
              <div>
                <small>AI models</small>
                <h2 id={titleId}>Choose {label} model</h2>
                <p>
                  {models.filter((model) => model.available).length} available ·{' '}
                  {models.length} in catalog
                </p>
              </div>
              <button
                type="button"
                aria-label="Close model picker"
                onClick={close}
              >
                <Icon name="close" size={20} />
              </button>
            </div>
            <div className="model-picker-search">
              <Icon name="search" size={18} />
              <input
                ref={search}
                aria-label="Search models"
                placeholder="Search by model name, ID or provider…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear model search"
                  onClick={() => {
                    setQuery('');
                    search.current?.focus();
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          </header>
          <div className="model-picker-list">
            {filtered.map((model) => (
              <button
                key={model.id}
                type="button"
                className="model-picker-card"
                aria-pressed={selected?.id === model.id}
                disabled={!model.available}
                onClick={() => choose(model.id)}
              >
                <span className="model-picker-card-content">
                  <strong>
                    {model.label}
                    <span className="model-picker-badge">{model.provider}</span>
                  </strong>
                  <span className="model-picker-description">{model.id}</span>
                  <span className="model-picker-tags">
                    {capabilityTags(model).map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                    {model.status !== 'active' && <span>{model.status}</span>}
                  </span>
                  {!model.available && (
                    <span className="model-picker-unavailable">
                      {model.unavailableReason ?? 'Model unavailable'}
                    </span>
                  )}
                </span>
                <span className="model-picker-check" aria-hidden="true">
                  ✓
                </span>
              </button>
            ))}
            {!!models.length && !filtered.length && (
              <p className="model-picker-empty" role="status">
                No models found. Try another name or provider.
              </p>
            )}
            {!models.length && (
              <p className="model-picker-empty" role="status">
                {loading
                  ? 'Loading models…'
                  : 'No AI models are listed for this tool yet.'}
              </p>
            )}
          </div>
        </dialog>,
        document.body,
      )}
    </>
  );
}
