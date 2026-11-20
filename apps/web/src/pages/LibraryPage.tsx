import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  libraryPageSchema,
  type LibraryItem,
  type MediaKind,
} from '@hiveflow/shared';
import { request, spacesApi } from '../api/spaces';
import { useCreateSpace } from '../api/useCreateSpace';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { Icon } from '../canvas/Icons';
import './LibraryPage.css';

const tabs = [
  { label: 'All', value: '' },
  { label: 'Images', value: 'image' },
  { label: 'Videos', value: 'video' },
  { label: 'Audio', value: 'audio' },
] as const;
const mediaLabels = { image: 'Image', video: 'Video', audio: 'Audio' };
const mediaIcons = { image: 'image', video: 'video', audio: 'audio' } as const;

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MediaThumbnail({ item }: { item: LibraryItem }) {
  const [failed, setFailed] = useState(false);
  const { asset } = item;
  return (
    <div className={`library-thumbnail library-${asset.kind}`}>
      {asset.kind === 'image' && !failed ? (
        <img
          src={asset.url}
          alt={`Image from ${item.spaceName}`}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name={mediaIcons[asset.kind]} size={36} />
      )}
      <span className="library-kind">
        <Icon name={mediaIcons[asset.kind]} size={13} />
        {mediaLabels[asset.kind]}
      </span>
    </div>
  );
}

function MediaPreview({
  item,
  onClose,
}: {
  item: LibraryItem;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { asset } = item;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="library-preview"
      aria-labelledby="preview-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      <div className="preview-shell">
        <header className="preview-header">
          <div>
            <h2 id="preview-title">{mediaLabels[asset.kind]} preview</h2>
            <p>{item.spaceName}</p>
          </div>
          <button
            aria-label="Close preview"
            onClick={() => dialog.current?.close()}
            autoFocus
          >
            <Icon name="close" size={21} />
          </button>
        </header>
        <div className={`preview-media preview-${asset.kind}`}>
          {asset.kind === 'image' ? (
            <img src={asset.url} alt={`Image from ${item.spaceName}`} />
          ) : asset.kind === 'video' ? (
            <video src={asset.url} controls playsInline preload="metadata" />
          ) : (
            <>
              <Icon name="audio" size={64} />
              <audio src={asset.url} controls preload="metadata" />
            </>
          )}
        </div>
        <footer className="preview-footer">
          <div className="preview-metadata">
            <span>
              {asset.mime} · {sizeLabel(asset.sizeBytes)}
            </span>
            {asset.width && asset.height ? (
              <span>
                {asset.width} × {asset.height}
              </span>
            ) : null}
            {asset.durationMs != null && (
              <span>{(asset.durationMs / 1000).toFixed(1)} seconds</span>
            )}
            <span>{new Date(asset.createdAt).toLocaleString()}</span>
          </div>
          <div className="preview-actions">
            <a href={`/spaces/${asset.spaceId}`}>Open source Space</a>
            <a className="library-download" href={`${asset.url}?download=1`}>
              <Icon name="download" size={16} />
              Download
            </a>
          </div>
        </footer>
      </div>
    </dialog>
  );
}

export function LibraryPage() {
  const [kind, setKind] = useState<MediaKind | ''>('');
  const [spaceId, setSpaceId] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const create = useCreateSpace();
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: spacesApi.list });
  const library = useQuery({
    queryKey: ['library', kind, spaceId, offset],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        limit: '24',
        offset: String(offset),
      });
      if (kind) params.set('kind', kind);
      if (spaceId) params.set('spaceId', spaceId);
      return libraryPageSchema.parse(
        await request(`/assets?${params}`, { signal }),
      );
    },
  });
  const data = library.data;
  return (
    <WorkspaceLayout
      active="library"
      creating={create.isPending}
      onCreate={(type) => {
        if (!create.isPending) create.mutate(type);
      }}
    >
      <div className="spaces-heading">
        <div>
          <div className="spaces-breadcrumb">Personal project /</div>
          <h1>
            Library{data && <span className="spaces-count">{data.total}</span>}
          </h1>
          <p>Your images, videos and audio, together in one place.</p>
        </div>
      </div>
      <div className="library-toolbar">
        <div className="library-filters" role="group" aria-label="Media type">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              aria-pressed={kind === tab.value}
              onClick={() => {
                setKind(tab.value);
                setOffset(0);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <label className="library-space-filter">
          <span>Space</span>
          <select
            aria-label="Filter by Space"
            value={spaceId}
            onChange={(event) => {
              setSpaceId(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">All spaces</option>
            {spaces.data?.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="spaces-section-heading">
        <span>
          {data
            ? `${data.total} ${data.total === 1 ? 'asset' : 'assets'}`
            : 'Media'}
        </span>
        <span>Newest first</span>
      </div>
      {create.error && (
        <p className="page-error" role="alert">
          {create.error.message}
        </p>
      )}
      {spaces.isError && (
        <p className="library-warning" role="alert">
          Space filters could not be loaded.{' '}
          <button onClick={() => void spaces.refetch()}>Retry</button>
        </p>
      )}
      {library.isPending && (
        <div className="library-loading" role="status">
          Loading your library…
        </div>
      )}
      {library.isError && (
        <div className="page-message" role="alert">
          <p>Could not load your library. {library.error.message}</p>
          <button
            className="secondary-button"
            onClick={() => void library.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {data && data.items.length === 0 && (
        <div className="spaces-empty">
          <div className="empty-space-art">
            <Icon name="library" size={38} />
          </div>
          <h2>
            {kind || spaceId
              ? 'No matching media yet.'
              : 'Your library starts here.'}
          </h2>
          <p>Media you upload or generate in a Space will appear here.</p>
          {(kind || spaceId) && (
            <button
              className="clear-search"
              onClick={() => {
                setKind('');
                setSpaceId('');
                setOffset(0);
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      <div className="spaces-grid library-grid">
        {data?.items.map((item) => (
          <button
            className="space-card library-card"
            key={item.asset.id}
            onClick={() => setSelected(item)}
            aria-label={`Preview ${mediaLabels[item.asset.kind].toLowerCase()} from ${item.spaceName}, ${item.asset.id}`}
          >
            <MediaThumbnail item={item} />
            <div className="space-card-details">
              <h2>{item.spaceName}</h2>
              <p>
                {new Date(item.asset.createdAt).toLocaleDateString()} ·{' '}
                {sizeLabel(item.asset.sizeBytes)}
              </p>
            </div>
          </button>
        ))}
      </div>
      {data && (data.total > data.limit || offset > 0) && (
        <nav className="library-pagination" aria-label="Library pages">
          <span>
            {data.total === 0 ? 0 : offset + 1}–{offset + data.items.length} of{' '}
            {data.total}
          </span>
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - data.limit))}
          >
            Previous
          </button>
          <button
            disabled={offset + data.items.length >= data.total}
            onClick={() => setOffset(offset + data.limit)}
          >
            Next
          </button>
        </nav>
      )}
      {selected && (
        <MediaPreview item={selected} onClose={() => setSelected(null)} />
      )}
    </WorkspaceLayout>
  );
}
