import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emptyGraph,
  type SpaceDocument,
  type UpdateSpaceInput,
} from '@hiveflow/shared';
import { AutosaveController, type SpaceSnapshot } from './autosave';
import { ApiError } from './spaces';

const snapshot = (name: string): SpaceSnapshot => ({
  name,
  graph: emptyGraph(),
});
const document = (input: UpdateSpaceInput): SpaceDocument => ({
  id: 'a6f7194d-a22b-497b-b076-947394260333',
  name: input.name ?? 'test',
  graph: input.graph ?? emptyGraph(),
  schemaVersion: 1,
  version: input.version + 1,
  createdAt: '2026-11-17T00:00:00.000Z',
  updatedAt: '2026-11-17T00:00:00.000Z',
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

describe('AutosaveController', () => {
  it('ignores object key order changed by PostgreSQL jsonb on load', () => {
    const graph = emptyGraph();
    graph.nodes = [
      {
        id: crypto.randomUUID(),
        type: 'image_generator',
        position: { x: 1, y: 2 },
        params: {
          prompt: '',
          count: 1,
          model: 'auto',
          aspectRatio: '1:1',
          resolution: '1K',
        },
      },
    ];
    const save = vi.fn();
    const controller = new AutosaveController(
      { name: 'test', graph },
      1,
      save,
      () => {},
    );
    const reordered = structuredClone(graph);
    reordered.nodes[0].params = {
      resolution: '1K',
      aspectRatio: '1:1',
      model: 'auto',
      count: 1,
      prompt: '',
    };
    controller.update({ graph: reordered, name: 'test' });
    expect(controller.getState()).toMatchObject({
      status: 'saved',
      dirty: false,
    });
    expect(save).not.toHaveBeenCalled();
    controller.dispose();
  });
  it('debounces edits and sends only the latest snapshot', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (input: UpdateSpaceInput) => document(input));
    const controller = new AutosaveController(
      snapshot('initial'),
      1,
      save,
      () => {},
    );
    controller.update(snapshot('first'));
    await vi.advanceTimersByTimeAsync(600);
    controller.update(snapshot('latest'));
    await vi.advanceTimersByTimeAsync(799);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ name: 'latest', version: 1 });
    expect(controller.getState()).toMatchObject({
      status: 'saved',
      version: 2,
      dirty: false,
    });
    controller.dispose();
  });
  it('serializes in-flight edits and flush waits until the newest edit is saved', async () => {
    const first = deferred<SpaceDocument>();
    const save = vi
      .fn<(input: UpdateSpaceInput) => Promise<SpaceDocument>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (input) => document(input));
    const controller = new AutosaveController(
      snapshot('initial'),
      4,
      save,
      () => {},
    );
    controller.update(snapshot('first'));
    const flush = controller.flush();
    controller.update(snapshot('intermediate'));
    controller.update(snapshot('latest'));
    expect(controller.flush()).toBe(flush);
    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.getState().dirty).toBe(true);
    first.resolve(document(save.mock.calls[0][0]));
    await flush;
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toMatchObject({ name: 'latest', version: 5 });
    expect(controller.getState()).toMatchObject({
      status: 'saved',
      version: 6,
      dirty: false,
    });
    controller.dispose();
  });
  it('persists a revert made while an earlier request is in flight', async () => {
    const first = deferred<SpaceDocument>();
    const save = vi
      .fn<(input: UpdateSpaceInput) => Promise<SpaceDocument>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (input) => document(input));
    const controller = new AutosaveController(
      snapshot('initial'),
      1,
      save,
      () => {},
    );
    controller.update(snapshot('changed'));
    const flush = controller.flush();
    controller.update(snapshot('initial'));
    expect(controller.getState().dirty).toBe(true);
    first.resolve(document(save.mock.calls[0][0]));
    await flush;
    expect(save.mock.calls[1][0]).toMatchObject({
      name: 'initial',
      version: 2,
    });
    controller.dispose();
  });
  it('keeps dirty state on errors and retries with the same version', async () => {
    const save = vi
      .fn<(input: UpdateSpaceInput) => Promise<SpaceDocument>>()
      .mockRejectedValueOnce(new ApiError(503, 'Offline'))
      .mockImplementation(async (input) => document(input));
    const controller = new AutosaveController(
      snapshot('initial'),
      1,
      save,
      () => {},
    );
    controller.update(snapshot('changed'));
    await expect(controller.flush()).rejects.toThrow('Offline');
    expect(controller.getState()).toMatchObject({
      status: 'error',
      dirty: true,
      version: 1,
    });
    await controller.flush();
    expect(save.mock.calls[1][0].version).toBe(1);
    expect(controller.getState().dirty).toBe(false);
    controller.dispose();
  });
  it('stops writes after 409 while preserving later edits for a copy', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValue(new ApiError(409, 'Conflict'));
    const controller = new AutosaveController(
      snapshot('initial'),
      1,
      save,
      () => {},
    );
    controller.update(snapshot('changed'));
    await expect(controller.flush()).rejects.toThrow('Conflict');
    controller.update(snapshot('more edits'));
    await vi.advanceTimersByTimeAsync(2000);
    await expect(controller.flush()).rejects.toMatchObject({ status: 409 });
    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toMatchObject({
      status: 'conflict',
      dirty: true,
      version: 1,
    });
    controller.dispose();
  });
  it('does not save a reverted pending edit and cancels timers on dispose', async () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const controller = new AutosaveController(
      snapshot('initial'),
      1,
      save,
      () => {},
    );
    controller.update(snapshot('temporary'));
    controller.update(snapshot('initial'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    controller.update(snapshot('new'));
    controller.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).not.toHaveBeenCalled();
    expect(controller.getState().dirty).toBe(false);
  });
});
