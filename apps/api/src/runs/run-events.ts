import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { NodeRun, RunEvent, Batch } from '@hiveflow/shared';
type ExecutionEvent = RunEvent | (Batch & { type: 'batch.updated' });
@Injectable()
export class RunEvents {
  private readonly spaces = new Map<string, Subject<ExecutionEvent>>();
  subscribe(spaceId: string, listener: (event: ExecutionEvent) => void) {
    let channel = this.spaces.get(spaceId);
    if (!channel) {
      channel = new Subject<ExecutionEvent>();
      this.spaces.set(spaceId, channel);
    }
    const subscription = channel.subscribe(listener);
    return () => {
      subscription.unsubscribe();
      if (!channel.observed) {
        channel.complete();
        this.spaces.delete(spaceId);
      }
    };
  }
  emit(run: NodeRun) {
    this.spaces.get(run.spaceId)?.next({ type: 'run.updated', ...run });
  }
  emitBatch(batch: Batch) {
    this.spaces.get(batch.spaceId)?.next({ type: 'batch.updated', ...batch });
  }
}
