import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { uploadRequestSchema, libraryQuerySchema } from '@hiveflow/shared';
import { CurrentUser, type User } from '../auth/current-user';
import { mediaExtensions } from './media-input';
import { AssetsService } from './assets.service';
import { byteRange } from './byte-range';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}
  @Get() list(@CurrentUser() user: User, @Query() query: unknown) {
    const parsed = libraryQuerySchema.safeParse(query);
    if (!parsed.success)
      throw new BadRequestException('Invalid library filters or pagination.');
    return this.assets.list(user, parsed.data);
  }
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
    @Headers('range') rangeHeader?: string,
    @Headers('if-range') ifRange?: string,
    @Query('download') download?: string,
  ) {
    const asset = await this.assets.owned(user, id);
    const etag = `"${asset.sha256}"`;
    const range = byteRange(
      ifRange && ifRange !== etag ? undefined : rangeHeader,
      asset.sizeBytes,
    );
    response.set('ETag', etag);
    response.set('Accept-Ranges', 'bytes');
    if (range === false) {
      response
        .status(416)
        .set('Content-Range', `bytes */${asset.sizeBytes}`)
        .end();
      return;
    }
    const { body } = await this.assets.stream(
      user,
      id,
      range ? `bytes=${range.start}-${range.end}` : undefined,
    );
    if (range)
      response
        .status(206)
        .set(
          'Content-Range',
          `bytes ${range.start}-${range.end}/${asset.sizeBytes}`,
        );
    response.set({
      'Content-Type': asset.mime,
      'Content-Length': String(
        range ? range.end - range.start + 1 : asset.sizeBytes,
      ),
      'Content-Disposition': `${download === '1' ? 'attachment' : 'inline'}; filename="${asset.id}.${mediaExtensions[asset.mime]}"`,
      'Cache-Control':
        asset.kind === 'image' ? 'private, no-store' : 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    return new StreamableFile(body);
  }
}
