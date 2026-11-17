import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { uploadRequestSchema } from '@hiveflow/shared';
import { CurrentUser, type User } from '../auth/current-user';
import { AssetsService } from './assets.service';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: User,
    @Body() body: unknown,
    @UploadedFile() file?: { buffer: Buffer; mimetype: string },
  ) {
    const input = uploadRequestSchema.safeParse(body);
    if (!input.success || !file)
      throw new BadRequestException(
        'Provide spaceId and one image in the file field.',
      );
    return this.assets.upload(
      user,
      input.data.spaceId,
      file.buffer,
      file.mimetype,
    );
  }
  @Get(':id/metadata') metadata(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.assets.metadata(user, id);
  }
  @Get(':id') async image(
    @CurrentUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { asset, body } = await this.assets.stream(user, id);
    response.set({
      'Content-Type': asset.mime,
      'Content-Length': String(asset.sizeBytes),
      'Content-Disposition': `inline; filename="${asset.id}.png"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(body);
  }
}
