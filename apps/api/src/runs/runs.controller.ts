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
} from '@nestjs/common';
import type { Response } from 'express';
import { runRequestSchema } from '@hiveflow/shared';
import { CurrentUser, type User } from '../auth/current-user';
import { SpacesService } from '../spaces/spaces.service';
import { RunEvents } from './run-events';
import { RunsService } from './runs.service';
@Controller('spaces/:id')
export class RunsController {
  constructor(
    private readonly runs: RunsService,
    private readonly spaces: SpacesService,
    private readonly events: RunEvents,
  ) {}
  @Post('nodes/:nodeId/run') start(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('nodeId', new ParseUUIDPipe()) nodeId: string,
    @Body() body: unknown,
  ) {
    if (!runRequestSchema.safeParse(body ?? {}).success)
      throw new BadRequestException('Expected { force?: boolean }');
    return this.runs.start(user, id, nodeId);
  }
  @Get('runs') history(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('nodeId', new ParseUUIDPipe({ optional: true })) nodeId?: string,
  ) {
    return this.runs.history(user, id, nodeId);
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
      response.write(`event: run.updated\ndata: ${JSON.stringify(event)}\n\n`),
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
