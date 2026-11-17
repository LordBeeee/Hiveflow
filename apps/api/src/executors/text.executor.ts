import { Injectable } from '@nestjs/common';
import { textParamsSchema } from '@hiveflow/shared';
import type { ExecutionContext, NodeExecutor } from './node-executor';
@Injectable()
export class TextExecutor implements NodeExecutor {
  readonly type = 'text';
  async execute(context: ExecutionContext) {
    context.signal.throwIfAborted();
    return { output: { text: textParamsSchema.parse(context.params).value } };
  }
}
