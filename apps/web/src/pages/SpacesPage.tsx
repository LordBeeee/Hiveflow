import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { spacesApi } from '../api/spaces';
import { Icon } from '../canvas/Icons';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useCreateSpace } from '../api/useCreateSpace';

export function SpacesPage() {
  const queryClient = useQueryClient();
  const spaces = useQuery({ queryKey: ['spaces'], queryFn: spacesApi.list });
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const create = useCreateSpace(name);
  const remove = useMutation({
    mutationFn: spacesApi.remove,
    onSuccess: async () => {
      setDeleteId(null);
      await queryClient.invalidateQueries({ queryKey: ['spaces'] });
    },
  });
  const visibleSpaces = spaces.data?.filter((space) =>
    space.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <WorkspaceLayout
      active="spaces"
      creating={create.isPending}
      onCreate={() => {
        if (!create.isPending) create.mutate();
      }}
    >
      <div className="spaces-heading">
        <div>
          <h1>
            Spaces
            <span className="spaces-count">{spaces.data?.length ?? 0}</span>
          </h1>
          <p>A little space for your next big idea.</p>
        </div>
        <label className="spaces-search">
          <Icon name="search" size={18} />
          <input
            aria-label="Search spaces"
            placeholder="Search spaces…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <form
        className="create-space"
        onSubmit={(event) => {
          event.preventDefault();
          if (!create.isPending) create.mutate(undefined);
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
      <div className="spaces-section-heading">
        <span>All spaces</span>
        <span>Last edited</span>
      </div>
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
          <div className="empty-space-art">
            <Icon name="spaces" size={38} />
            <span>
              <Icon name="plus" size={16} />
            </span>
          </div>
          <h2>Room for something great.</h2>
          <p>
            Create your first space above. Your canvas will save as you work.
          </p>
        </div>
      )}
      {!!spaces.data?.length && visibleSpaces?.length === 0 && (
        <div className="spaces-empty" role="status">
          <Icon name="search" size={30} />
          <h2>No spaces found</h2>
          <p>
            Try another name or{' '}
            <button className="clear-search" onClick={() => setSearch('')}>
              clear your search
            </button>
            .
          </p>
        </div>
      )}
      <div className="spaces-grid">
        {visibleSpaces?.map((space) => (
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
    </WorkspaceLayout>
  );
}
