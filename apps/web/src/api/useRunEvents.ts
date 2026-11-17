import { useEffect } from 'react';
import { runEventSchema } from '@hiveflow/shared';
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
        const runs = await executionApi.history(spaceId);
        if (!disposed) runs.forEach((run) => useRunStore.getState().merge(run));
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
        if (parsed.success && !disposed)
          useRunStore.getState().merge(parsed.data);
      } catch {
        /* Ignore malformed events; snapshots remain authoritative. */
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
