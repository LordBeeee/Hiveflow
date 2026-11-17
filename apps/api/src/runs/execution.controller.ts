import { Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, type User } from '../auth/current-user';
import { RunsService } from './runs.service';
import { BatchesService } from './batches.service';
@Controller()
export class ExecutionController {
  constructor(
    private readonly runs: RunsService,
    private readonly batches: BatchesService,
  ) {}
  // Cancellation remains available even if the creation rate limit has been reached.
  @Post('runs/:id/cancel') cancel(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.runs.cancel(user, id);
  }
  @Post('batches/:id/cancel') cancelBatch(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.batches.cancel(user, id);
  }
}
