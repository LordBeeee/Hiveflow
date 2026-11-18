import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { estimateRequestSchema, costGraphHash } from '@hiveflow/shared';
import { CurrentUser, type User } from '../auth/current-user';
import { SpacesService } from '../spaces/spaces.service';
import { CostsService } from './costs.service';
@Controller('spaces/:id/run')
export class CostsController {
  constructor(
    private readonly spaces: SpacesService,
    private readonly costs: CostsService,
  ) {}
  @Post('estimate') async estimate(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    const input = estimateRequestSchema.safeParse(body ?? {});
    if (!input.success)
      throw new BadRequestException('Expected { force?, nodeId? }.');
    const space = await this.spaces.get(user, id);
    const { estimate } = await this.costs.plan(
      id,
      space.graph,
      input.data.force,
      input.data.nodeId,
    );
    let limitMessage: string | undefined;
    try {
      this.costs.enforce(estimate);
    } catch (error) {
      limitMessage = (error as Error).message;
    }
    return {
      ...estimate,
      version: space.version,
      graphHash: await costGraphHash(space.graph),
      allowed: !limitMessage,
      ...(limitMessage ? { limitMessage } : {}),
    };
  }
}
@Controller('usage')
export class UsageController {
  constructor(private readonly costs: CostsService) {}
  @Get() usage(@CurrentUser() user: User) {
    return this.costs.usage(user.id);
  }
}
