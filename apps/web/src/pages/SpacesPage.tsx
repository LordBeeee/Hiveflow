import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { spacesApi } from '../api/spaces';
import { initialGraph } from '../store/graph';
import { Icon } from '../canvas/Icons';
import { BrandLogo } from '../components/BrandLogo';

export function SpacesPage() {
  const queryClient = useQueryClient();
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: spacesApi.list });
  const [name, setName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      spacesApi.create({
        name: name.trim() || 'Untitled space',
        graph: structuredClone(initialGraph),
      }),
    onSuccess: (space) => {
      window.location.assign(`/spaces/${space.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: spacesApi.remove,
    onSuccess: async () => {
      setDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
    },
  });
  return (
    <div className="spaces-page">
      <header className="app-header">
        <BrandLogo />
        <span className="header-divider" />
        <span className="space-name">Spaces</span>
        <div className="header-end">
          <span className="local-indicator">
            <span />
            Your workspace
          </span>
          <span className="avatar">H</span>
        </div>
      </header>
      <main className="spaces-content">
        <div className="canvas-eyebrow">
          <span />
          YOUR CREATIVE WORKSPACE
        </div>
        <div className="spaces-heading">
          <div>
            <h1>A space for every idea.</h1>
            <p>Pick up where you left off, or start something new.</p>
          </div>
          <span className="spaces-count">
            {spaces.data?.length ?? 0} spaces
          </span>
        </div>
        <form
          className="create-space"
          onSubmit={(event) => {
            event.preventDefault();
            if (!create.isPending) create.mutate();
          }}
        >
          <input
            aria-label="New space name"
            maxLength={120}
            placeholder="Name your next space…"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" disabled={create.isPending}>
            <Icon name="plus" size={17} />
            {create.isPending ? 'Creating…' : 'New space'}
          </button>
        </form>
        {create.error && (
          <p className="page-error" role="alert">
            {create.error.message}
          </p>
        )}
        {remove.error && (
          <p className="page-error" role="alert">
            {remove.error.message}
          </p>
        )}
        {spaces.isPending && (
          <p className="page-message" role="status">
            Loading your spaces…
          </p>
        )}
        {spaces.isError && (
          <div className="page-message" role="alert">
            <p>Could not load your spaces. {spaces.error.message}</p>
            <button
              className="secondary-button"
              onClick={() => void spaces.refetch()}
            >
              Retry
            </button>
          </div>
        )}
        {spaces.data?.length === 0 && (
          <div className="spaces-empty">
            <Icon name="sparkles" size={34} />
            <h2>Your next idea starts here.</h2>
            <p>
              Create your first space above. Your canvas will save as you work.
            </p>
          </div>
        )}
        <div className="spaces-grid">
          {spaces.data?.map((space) => (
            <article className="space-card" key={space.id}>
              <a href={`/spaces/${space.id}`} aria-label={`Open ${space.name}`}>
                <div className="space-card-preview">
                  <span className="mini-node mini-text" />
                  <span className="mini-wire" />
                  <span className="mini-node mini-generator">
                    <Icon name="sparkles" size={23} />
                  </span>
                </div>
                <div className="space-card-details">
                  <h2>{space.name}</h2>
                  <p>Edited {new Date(space.updatedAt).toLocaleString()}</p>
                </div>
              </a>
              <div className="space-card-actions">
                {deleteId === space.id ? (
                  <>
                    <span>Delete this space?</span>
                    <button
                      onClick={() => remove.mutate(space.id)}
                      disabled={remove.isPending}
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setDeleteId(null)}
                      disabled={remove.isPending}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <span>Version {space.version}</span>
                    <button
                      aria-label={`Delete ${space.name}`}
                      onClick={() => setDeleteId(space.id)}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}
