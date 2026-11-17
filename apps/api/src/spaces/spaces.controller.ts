import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { createSpaceSchema, updateSpaceSchema } from '@hiveflow/shared';
import { CurrentUser, type User } from '../auth/current-user';
import { SpacesService } from './spaces.service';

function parse<T>(
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: { path: PropertyKey[]; message: string }[] };
        };
  },
  body: unknown,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new BadRequestException({
      message: 'Invalid space document',
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    });
  return parsed.data;
}

@Controller('spaces')
export class SpacesController {
  constructor(private readonly spaces: SpacesService) {}
  @Post() create(@CurrentUser() user: User, @Body() body: unknown) {
    return this.spaces.create(user, parse(createSpaceSchema, body ?? {}));
  }
  @Get() list(@CurrentUser() user: User) {
    return this.spaces.list(user);
  }
  @Get(':id') get(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.spaces.get(user, id);
  }
  @Patch(':id') update(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.spaces.update(user, id, parse(updateSpaceSchema, body));
  }
  @Delete(':id') @HttpCode(204) remove(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.spaces.remove(user, id);
  }
}
