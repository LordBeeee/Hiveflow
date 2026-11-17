import { useEffect } from 'react';
import { runEventSchema, batchEventSchema } from '@hiveflow/shared';
import { useRunStore } from '../store/runs';
import { executionApi } from './execution';

export function useRunEvents(spaceId: string) {
  useEffect(() => {
    useRunStore.getState().reset(spaceId);
    let disposed = false;
    let refreshing = false;
    const refresh = async () => {
      if (disposed || refreshing) return;
      refreshing = true;
      try {
        const [runs, succeeded, batches] = await Promise.all([
          executionApi.history(spaceId),
          executionApi.history(spaceId, true),
          executionApi.batches(spaceId),
        ]);
        if (!disposed) {
          runs.forEach((run) => useRunStore.getState().merge(run));
          succeeded.forEach((run) => useRunStore.getState().mergeSuccess(run));
          if (batches[0]) useRunStore.getState().setBatch(batches[0]);
        }
      } catch {
        /* EventSource reconnect and periodic snapshots recover transient failures. */
      } finally {
        refreshing = false;
      }
    };
    const events = new EventSource(`/api/spaces/${spaceId}/events`);
    events.addEventListener('run.updated', (event) => {
      try {
        const parsed = runEventSchema.safeParse(
          JSON.parse((event as MessageEvent<string>).data),
        );
        if (parsed.success && !disposed) {
          useRunStore.getState().mergeSuccess(parsed.data);
          useRunStore.getState().merge(parsed.data);
        }
      } catch {
        /* Ignore malformed events; snapshots remain authoritative. */
      }
    });
    events.addEventListener('batch.updated', (event) => {
      try {
        const parsed = batchEventSchema.safeParse(
          JSON.parse((event as MessageEvent<string>).data),
        );
        if (parsed.success && !disposed)
          useRunStore.getState().setBatch(parsed.data);
      } catch {
        /* History snapshots recover malformed or missed events. */
      }
    });
    events.onopen = () => {
      void refresh();
    };
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      events.close();
    };
  }, [spaceId]);
}
