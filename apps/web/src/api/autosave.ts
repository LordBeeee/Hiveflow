import type {
  SpaceDocument,
  SpaceGraph,
  UpdateSpaceInput,
} from '@hiveflow/shared';
import { ApiError } from './spaces';
import { stableStringify } from '@hiveflow/shared';

export interface SpaceSnapshot {
  name: string;
  graph: SpaceGraph;
}
export interface SaveState {
  status: 'saved' | 'pending' | 'saving' | 'error' | 'conflict';
  dirty: boolean;
  version: number;
  message?: string;
}

export class AutosaveController {
  private latest: SpaceSnapshot;
  private savedFingerprint: string;
  private version: number;
  private status: SaveState['status'] = 'saved';
  private message?: string;
  private retryNeeded = false;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight: Promise<void> | null = null;

  constructor(
    initial: SpaceSnapshot,
    version: number,
    private readonly save: (input: UpdateSpaceInput) => Promise<SpaceDocument>,
    private readonly onState: (state: SaveState) => void,
    private readonly debounceMs = 800,
  ) {
    this.latest = initial;
    this.savedFingerprint = stableStringify(initial);
    this.version = version;
  }
  getState(): SaveState {
    return {
      status: this.status,
      version: this.version,
      dirty:
        !this.disposed &&
        (this.status === 'saving' ||
          this.retryNeeded ||
          stableStringify(this.latest) !== this.savedFingerprint),
      message: this.message,
    };
  }
  private publish() {
    if (!this.disposed) this.onState(this.getState());
  }
  update(snapshot: SpaceSnapshot): void {
    if (
      this.disposed ||
      stableStringify(snapshot) === stableStringify(this.latest)
    )
      return;
    this.latest = snapshot;
    clearTimeout(this.timer);
    if (this.status !== 'conflict' && this.status !== 'saving')
      this.status = this.needsSave() ? 'pending' : 'saved';
    this.publish();
    if (this.status !== 'conflict' && this.needsSave())
      this.timer = setTimeout(() => {
        void this.flush().catch(() => {});
      }, this.debounceMs);
  }
  private needsSave() {
    return (
      this.retryNeeded || stableStringify(this.latest) !== this.savedFingerprint
    );
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.disposed) return Promise.reject(new Error('This space is closed'));
    if (this.status === 'conflict')
      return Promise.reject(
        new ApiError(409, 'Resolve the conflict before leaving this space.'),
      );
    if (this.inFlight) return this.inFlight;
    if (!this.needsSave()) return Promise.resolve();
    this.inFlight = this.drain().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }
  private async drain(): Promise<void> {
    while (!this.disposed && this.needsSave()) {
      const snapshot = this.latest;
      this.status = 'saving';
      this.message = undefined;
      this.publish();
      try {
        const result = await this.save({ ...snapshot, version: this.version });
        this.version = result.version;
        this.savedFingerprint = stableStringify(snapshot);
        this.retryNeeded = false;
      } catch (error) {
        this.retryNeeded = true;
        this.status =
          error instanceof ApiError && error.status === 409
            ? 'conflict'
            : 'error';
        this.message =
          error instanceof Error ? error.message : 'Could not save this space.';
        this.publish();
        throw error;
      }
    }
    this.status = 'saved';
    this.publish();
  }
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
