import { CostEstimateProvider } from '../api/costs';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { prepareGraphForLoad, type SpaceDocument } from '@hiveflow/shared';
import { spacesApi } from '../api/spaces';
import { AutosaveController, type SaveState } from '../api/autosave';
import { graphSnapshot, loadGraph, useGraphStore } from '../store/graph';
import { SpaceCanvas } from '../canvas/SpaceCanvas';
import { ExecutionContext } from '../api/execution';
import { useExecutionActions } from '../api/useExecutionActions';
import { useRunEvents } from '../api/useRunEvents';
import { copySpaceWithAssets } from '../api/copySpace';
import { RunControls } from '../api/RunControls';
import { useStaleNodes } from '../api/useStaleNodes';

function SpaceEditor({ space }: { space: SpaceDocument }) {
  const [name, setName] = useState(space.name);
  const nameRef = useRef(space.name);
  const controllerRef = useRef<AutosaveController | null>(null);
  const execution = useExecutionActions(
    space.id,
    () =>
      controllerRef.current?.flush() ??
      Promise.reject(new Error('Space is not ready')),
  );
  useRunEvents(space.id);
  useStaleNodes();
  const [save, setSave] = useState<SaveState>({
    status: 'saved',
    dirty: false,
    version: space.version,
  });
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => {
    if (save.status === 'saved') setActionError(null);
  }, [save.status]);

  useEffect(() => {
    try {
      if (space.schemaVersion !== 1)
        throw new Error(
          'This space uses a newer format. Update Hiveflow to open it.',
        );
      const prepared = prepareGraphForLoad(space.graph);
      if (prepared.warnings.length)
        console.warn('Space params repaired:', prepared.warnings);
      loadGraph(prepared.graph);
      const controller = new AutosaveController(
        { name: space.name, graph: space.graph },
        space.version,
        (input) => spacesApi.update(space.id, input),
        setSave,
      );
      controllerRef.current = controller;
      if (prepared.warnings.length)
        controller.update({ name: space.name, graph: prepared.graph });
      const unsubscribe = useGraphStore.subscribe((state, previous) => {
        if (
          state.nodes !== previous.nodes ||
          state.edges !== previous.edges ||
          state.viewport !== previous.viewport
        )
          controller.update({
            name: nameRef.current.trim() || 'Untitled space',
            graph: graphSnapshot(),
          });
      });
      const beforeUnload = (event: BeforeUnloadEvent) => {
        if (controller.getState().dirty || execution.hasPendingUploads()) {
          event.preventDefault();
          event.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', beforeUnload);
      setReady(true);
      return () => {
        unsubscribe();
        controller.dispose();
        window.removeEventListener('beforeunload', beforeUnload);
        controllerRef.current = null;
      };
    } catch (error) {
      setLoadError(
        error instanceof Error && error.name !== 'ZodError'
          ? error.message
          : 'The saved graph contains invalid connections and could not be opened.',
      );
    }
  }, [space]);

  function changeName(value: string) {
    setName(value);
    nameRef.current = value;
    controllerRef.current?.update({
      name: value.trim() || 'Untitled space',
      graph: graphSnapshot(),
    });
  }
  async function back() {
    if (working) return;
    setWorking(true);
    setActionError(null);
    try {
      await execution.waitForUploads();
      await controllerRef.current?.flush();
      window.location.assign('/spaces');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Save failed');
      setWorking(false);
    }
  }
  async function copy() {
    if (working) return;
    setWorking(true);
    setActionError(null);
    try {
      await execution.waitForUploads();
      const result = await copySpaceWithAssets(
        `${(nameRef.current.trim() || 'Untitled space').slice(0, 113)} (copy)`,
        graphSnapshot(),
      );
      controllerRef.current?.dispose();
      window.location.assign(`/spaces/${result.id}`);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Copy failed');
      setWorking(false);
    }
  }
  if (loadError)
    return (
      <div className="page-message" role="alert">
        <h1>This space could not be opened.</h1>
        <p>{loadError}</p>
        <a href="/spaces">Back to spaces</a>
      </div>
    );
  if (!ready)
    return (
      <p className="page-message" role="status">
        Preparing your canvas…
      </p>
    );
  const labels = {
    saved: 'Saved',
    pending: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Save failed',
    conflict: 'Conflict',
  };
  return (
    <ExecutionContext.Provider value={execution.actions}>
      <CostEstimateProvider
        spaceId={space.id}
        version={save.version}
        saved={ready && save.status === 'saved'}
      >
        <ReactFlowProvider>
          <SpaceCanvas
            spaceName={name}
            onNameChange={changeName}
            onBack={() => void back()}
            headerEnd={
              <>
                <RunControls
                  spaceId={space.id}
                  prepare={async () => {
                    await execution.waitForUploads();
                    await controllerRef.current?.flush();
                  }}
                />
                <span
                  role="status"
                  className={`save-indicator save-${save.status}`}
                  title={save.message}
                >
                  <span />
                  {labels[save.status]}
                </span>
                {save.status === 'error' && (
                  <button
                    className="header-button"
                    onClick={() =>
                      void controllerRef.current?.flush().catch(() => {})
                    }
                  >
                    Retry save
                  </button>
                )}
                <span className="avatar">H</span>
              </>
            }
            notice={
              save.status === 'conflict' ||
              save.status === 'error' ||
              actionError ? (
                <div
                  className={`save-notice ${save.status === 'conflict' ? 'conflict' : ''}`}
                  role="alert"
                >
                  <div>
                    <strong>
                      {save.status === 'conflict'
                        ? 'This space changed in another tab.'
                        : 'Your changes have not been saved.'}
                    </strong>
                    <p>
                      {actionError ??
                        (save.status === 'conflict'
                          ? 'Your edits are kept here. Reload the saved version or save your work as a new space.'
                          : save.message)}
                    </p>
                  </div>
                  <div className="save-notice-actions">
                    <button disabled={working} onClick={() => void copy()}>
                      Save as copy
                    </button>
                    {save.status === 'conflict' && (
                      <button
                        disabled={working}
                        onClick={() => {
                          if (
                            window.confirm(
                              'Replace your local edits with the saved version?',
                            )
                          ) {
                            controllerRef.current?.dispose();
                            window.location.reload();
                          }
                        }}
                      >
                        Reload saved version
                      </button>
                    )}
                  </div>
                </div>
              ) : null
            }
          />
        </ReactFlowProvider>
      </CostEstimateProvider>
    </ExecutionContext.Provider>
  );
}

export function SpacePage({ id }: { id: string }) {
  const space = useQuery({
    queryKey: ['space', id],
    queryFn: () => spacesApi.get(id),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
  if (space.isPending)
    return (
      <p className="page-message" role="status">
        Opening your space…
      </p>
    );
  if (space.isError)
    return (
      <div className="page-message" role="alert">
        <h1>Could not open this space.</h1>
        <p>{space.error.message}</p>
        <button
          className="secondary-button"
          onClick={() => void space.refetch()}
        >
          Retry
        </button>
        <a href="/spaces">Back to spaces</a>
      </div>
    );
  return <SpaceEditor space={space.data} />;
}
