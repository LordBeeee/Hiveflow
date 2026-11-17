import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { NodeRun, RunEvent } from '@hiveflow/shared';
@Injectable()
export class RunEvents {
  private readonly spaces = new Map<string, Subject<RunEvent>>();
  subscribe(spaceId: string, listener: (event: RunEvent) => void) {
    let channel = this.spaces.get(spaceId);
    if (!channel) {
      channel = new Subject<RunEvent>();
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
}
