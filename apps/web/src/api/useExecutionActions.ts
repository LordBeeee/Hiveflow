import { useMemo, useRef } from 'react';
import { executionApi, type ExecutionActions } from './execution';
import { useGraphStore } from '../store/graph';
import { useRunStore } from '../store/runs';
import { useUIStore } from '../store/ui';

export function useExecutionActions(
  spaceId: string,
  flush: () => Promise<void>,
) {
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const uploads = useRef(
    new Map<string, { file: File; promise: Promise<void> }>(),
  );
  const requests = useRef(new Map<string, Promise<void>>());
  const actions = useMemo<ExecutionActions>(() => {
    const uploadFile = async (nodeId: string, file: File) => {
      if (useRunStore.getState().uploads[nodeId]?.status === 'uploading')
        return;
      useRunStore.getState().setUpload(nodeId, { status: 'uploading' });
      const promise = (async () => {
        try {
          const asset = await executionApi.upload(spaceId, file);
          useGraphStore.getState().updateParams(nodeId, { assetId: asset.id });
          useRunStore.getState().setUpload(nodeId, undefined);
          uploads.current.delete(nodeId);
        } catch (error) {
          useRunStore.getState().setUpload(nodeId, {
            status: 'failed',
            error:
              error instanceof Error
                ? error.message
                : 'Upload failed. Please retry.',
          });
          throw error;
        }
      })();
      uploads.current.set(nodeId, { file, promise });
      return promise;
    };
    return {
      uploadFile,
      retryUpload: async (nodeId) => {
        const upload = uploads.current.get(nodeId);
        if (upload) await uploadFile(nodeId, upload.file);
      },
      attachReference: async (nodeId, file) => {
        const id = useGraphStore.getState().addReference(nodeId, null);
        if (id) await uploadFile(id, file);
      },
      runNode: async (nodeId) => {
        if (requests.current.has(nodeId)) return requests.current.get(nodeId);
        const task = (async () => {
          useRunStore.getState().setRequest(nodeId, true);
          try {
            await Promise.all(
              [...uploads.current]
                .filter(([id]) =>
                  useGraphStore.getState().nodes.some((node) => node.id === id),
                )
                .map(([, upload]) => upload.promise),
            );
            await flushRef.current();
            await executionApi.run(spaceId, nodeId);
            const runs = await executionApi.history(spaceId);
            runs.forEach((run) => useRunStore.getState().merge(run));
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Could not start this run. Please retry.';
            useRunStore.getState().setRequest(nodeId, false, message);
            useUIStore.getState().notify(message);
          } finally {
            useRunStore
              .getState()
              .setRequest(
                nodeId,
                false,
                useRunStore.getState().requestErrors[nodeId],
              );
            requests.current.delete(nodeId);
          }
        })();
        requests.current.set(nodeId, task);
        return task;
      },
    };
  }, [spaceId]);
  const hasPendingUploads = () =>
    Object.values(useRunStore.getState().uploads).some(
      (upload) => upload?.status === 'uploading',
    );
  const waitForUploads = async () => {
    await Promise.all(
      [...uploads.current]
        .filter(([id]) =>
          useGraphStore.getState().nodes.some((node) => node.id === id),
        )
        .map(([, upload]) => upload.promise),
    );
  };
  return { actions, hasPendingUploads, waitForUploads };
}
