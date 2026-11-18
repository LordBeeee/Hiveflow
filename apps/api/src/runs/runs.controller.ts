import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { runRequestSchema, batchRunRequestSchema } from '@hiveflow/shared';
import { CurrentUser, type User } from '../auth/current-user';
import { SpacesService } from '../spaces/spaces.service';
import { RunEvents } from './run-events';
import { RunsService } from './runs.service';
import { ThrottlerGuard } from '@nestjs/throttler';
import { BatchesService } from './batches.service';
@Controller('spaces/:id')
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly spaces: SpacesService,
    private readonly events: RunEvents,
    private readonly batches: BatchesService,
  ) {}
  @Post('nodes/:nodeId/run') @UseGuards(ThrottlerGuard) start(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('nodeId', new ParseUUIDPipe()) nodeId: string,
    @Body() body: unknown,
  ) {
    if (!runRequestSchema.safeParse(body ?? {}).success)
      throw new BadRequestException('Expected { force?: boolean }');
    return this.runs.start(
      user,
      id,
      nodeId,
      runRequestSchema.parse(body ?? {}).force,
    );
  }
  @Post('run') @UseGuards(ThrottlerGuard) startAll(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = batchRunRequestSchema.safeParse(body ?? {});
    if (!input.success)
      throw new BadRequestException('Expected { force?: boolean }');
    return this.batches.start(user, id, input.data.force, input.data);
  }
  @Get('batches') batchHistory(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.batches.history(user, id);
  }
  @Get('runs') history(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('nodeId', new ParseUUIDPipe({ optional: true })) nodeId?: string,
    @Query('succeeded') succeeded?: string,
  ) {
    return this.runs.history(user, id, nodeId, succeeded === 'true');
  }
  @Get('events') async stream(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ) {
    await this.spaces.get(user, id);
    response.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write('retry: 2000\n: connected\n\n');
    const unsubscribe = this.events.subscribe(id, (event) =>
      response.write(
        `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      ),
    );
    const heartbeat = setInterval(
      () => response.write(': heartbeat\n\n'),
      15000,
    );
    response.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}
