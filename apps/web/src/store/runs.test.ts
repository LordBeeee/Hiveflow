import { beforeEach, expect, it } from 'vitest';
import type { NodeRun } from '@hiveflow/shared';
import { useRunStore } from './runs';
const spaceId = 'db5a70ba-7603-478b-a414-ff0bf310a151';
function run(sequence: string, status: NodeRun['status']): NodeRun {
  return {
    spaceId,
    runId: `dc24b8ae-c281-4d88-a494-${sequence.padStart(12, '0')}`,
    nodeId: '46bf236c-09e0-4023-bc18-1ff0292cddde',
    nodeType: 'image_generator',
    sequence,
    batchId: null,
    status,
    inputHash: 'a'.repeat(64),
    output:
      status === 'succeeded'
        ? {
            image: [
              {
                assetId: '02452b35-89ac-40ed-a54e-bbc41f194810',
                url: '/api/assets/test',
                width: 1024,
                height: 1024,
              },
            ],
          }
        : null,
    error: null,
    provider: 'openrouter',
    cacheHit: false,
    createdAt: '2026-11-17T00:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  };
}
beforeEach(() => useRunStore.getState().reset(spaceId));
it('retains volatile progress when a running history snapshot has no progress', () => {
  const video = {
    ...run('1', 'running'),
    nodeType: 'video_generator' as const,
    progress: 46,
  };
  useRunStore.getState().merge(video);
  useRunStore.getState().merge({ ...video, progress: undefined });
  expect(useRunStore.getState().nodes[video.nodeId].progress).toBe(46);
  useRunStore
    .getState()
    .merge({ ...run('2', 'running'), nodeType: 'video_generator' });
  expect(useRunStore.getState().nodes[video.nodeId].progress).toBeUndefined();
});
it('recovers previous successful text after refresh of a canceled run without accepting older replacements', () => {
  const canceled = { ...run('3', 'canceled'), nodeType: 'assistant' as const };
  const success = {
    ...run('2', 'succeeded'),
    nodeType: 'assistant' as const,
    output: { text: 'Recovered result' },
  };
  useRunStore.getState().merge(canceled);
  useRunStore.getState().mergeSuccess(success);
  useRunStore.getState().mergeSuccess({
    ...success,
    sequence: '1',
    runId: run('1', 'succeeded').runId,
    output: { text: 'Older result' },
  });
  expect(useRunStore.getState().nodes[canceled.nodeId].status).toBe('canceled');
  expect(useRunStore.getState().outputs[canceled.nodeId]).toEqual({
    text: 'Recovered result',
  });
  useRunStore.getState().mergeSuccess({
    ...canceled,
    status: 'succeeded',
    output: { text: 'Late result' },
  });
  expect(useRunStore.getState().outputs[canceled.nodeId]).toEqual({
    text: 'Recovered result',
  });
});
it('keeps a newer queued run when an older run succeeds later', () => {
  useRunStore.getState().merge(run('2', 'queued'));
  useRunStore.getState().merge(run('1', 'succeeded'));
  expect(Object.values(useRunStore.getState().nodes)[0].sequence).toBe('2');
  expect(Object.keys(useRunStore.getState().outputs)).toHaveLength(0);
});
it('does not downgrade running/succeeded state during snapshot recovery', () => {
  useRunStore.getState().merge(run('1', 'succeeded'));
  useRunStore.getState().merge(run('1', 'queued'));
  expect(Object.values(useRunStore.getState().nodes)[0].status).toBe(
    'succeeded',
  );
});
it('retains the previous preview while a newer run is generating', () => {
  useRunStore.getState().merge(run('1', 'succeeded'));
  useRunStore.getState().merge(run('2', 'running'));
  expect(Object.values(useRunStore.getState().nodes)[0].status).toBe('running');
  expect(Object.keys(useRunStore.getState().outputs)).toHaveLength(1);
});
it('ignores late events from a different space', () => {
  useRunStore
    .getState()
    .merge({ ...run('1', 'succeeded'), spaceId: crypto.randomUUID() });
  expect(Object.keys(useRunStore.getState().nodes)).toHaveLength(0);
});
it('does not replace prepared inputs with an older waiting snapshot', () => {
  useRunStore
    .getState()
    .merge({ ...run('1', 'queued'), waiting: false, inputHash: 'prepared' });
  useRunStore
    .getState()
    .merge({ ...run('1', 'queued'), waiting: true, inputHash: 'pending' });
  expect(Object.values(useRunStore.getState().nodes)[0].inputHash).toBe(
    'prepared',
  );
});
it('preserves terminal status against conflicting late events', () => {
  useRunStore.getState().merge(run('1', 'canceled'));
  useRunStore.getState().merge(run('1', 'succeeded'));
  expect(Object.values(useRunStore.getState().nodes)[0].status).toBe(
    'canceled',
  );
});
it('clears request errors on new progress but preserves them on an unchanged snapshot', () => {
  const first = run('1', 'succeeded');
  useRunStore.getState().merge(first);
  useRunStore.getState().setRequest(first.nodeId, false, 'Save conflict');
  useRunStore.getState().merge(first);
  expect(useRunStore.getState().requestErrors[first.nodeId]).toBe(
    'Save conflict',
  );
  useRunStore.getState().merge(run('2', 'running'));
  expect(useRunStore.getState().requestErrors[first.nodeId]).toBeUndefined();
});
