import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import sharp, { type OutputInfo } from 'sharp';
import { assetSchema, type Asset } from '@hiveflow/shared';
import { ConfigService } from '@nestjs/config';
import {
  readBounded,
  sniffMedia,
  mediaExtensions,
  type StoreInput,
} from './media-input';
import type { User } from '../auth/current-user';
import { SpacesService } from '../spaces/spaces.service';
import { AssetEntity } from './asset.entity';
import { StorageService } from './storage.service';

export const IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/avif',
  'image/gif',
];
const formats: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heif: 'image/avif',
  gif: 'image/gif',
};
function dto(asset: AssetEntity): Asset {
  return assetSchema.parse({
    id: asset.id,
    spaceId: asset.spaceId,
    kind: asset.kind,
    durationMs: asset.durationMs ?? null,
    url: asset.url,
    mime: asset.mime,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    sha256: asset.sha256,
    createdAt: asset.createdAt.toISOString(),
  });
}
@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(AssetEntity)
    private readonly assets: Repository<AssetEntity>,
    private readonly storage: StorageService,
    private readonly spaces: SpacesService,
    private readonly config: ConfigService = new ConfigService(),
  ) {}
  async upload(
    user: User,
    spaceId: string,
    bytes: Buffer,
    declaredMime: string,
  ): Promise<Asset> {
    await this.spaces.get(user, spaceId);
    if (!IMAGE_MIME_TYPES.includes(declaredMime))
      throw new BadRequestException(
        'Choose a PNG, JPEG, WebP, AVIF or GIF image.',
      );
    let normalized: { data: Buffer; info: OutputInfo };
    try {
      const image = sharp(bytes, {
        limitInputPixels: 16_777_216,
        failOn: 'error',
      });
      const metadata = await image.metadata();
      if (
        !metadata.format ||
        formats[metadata.format] !== declaredMime ||
        (metadata.format === 'heif' && metadata.compression !== 'av1')
      )
        throw new Error('MIME mismatch');
      normalized = await image
        .rotate()
        .png()
        .toBuffer({ resolveWithObject: true });
    } catch {
      throw new BadRequestException(
        'The file is not a supported image, is damaged, or exceeds 16 megapixels.',
      );
    }
    return this.persist(
      spaceId,
      normalized.data,
      normalized.info.width,
      normalized.info.height,
    );
  }
  async store(spaceId: string, input: StoreInput | Buffer): Promise<Asset> {
    const legacy = Buffer.isBuffer(input);
    const data: StoreInput = legacy
      ? { kind: 'image', bytes: input, mime: 'image/png' }
      : input;
    const cap =
      this.config.get<number>(
        data.kind === 'audio'
          ? 'MAX_AUDIO_MB'
          : data.kind === 'video'
            ? 'MAX_VIDEO_MB'
            : 'MAX_UPLOAD_MB',
      ) ?? (data.kind === 'video' ? 250 : 25);
    if (data.kind === 'video')
      return this.storeVideo(spaceId, data, cap * 1024 * 1024);
    const bytes = await readBounded(data, cap * 1024 * 1024);
    if (data.kind !== 'image') {
      sniffMedia(data.kind, data.mime, bytes);
      const meta = data.meta ?? {};
      if (
        meta.durationMs !== undefined &&
        (!Number.isInteger(meta.durationMs) ||
          meta.durationMs < 0 ||
          meta.durationMs > 2147483647)
      )
        throw new Error('Invalid media duration');
      return this.persist(
        spaceId,
        bytes,
        null,
        null,
        data.kind,
        data.mime,
        meta.durationMs ?? null,
      );
    }
    const image = sharp(bytes, {
      limitInputPixels: 16_777_216,
      failOn: 'error',
    });
    const metadata = await image.metadata();
    if (
      !metadata.format ||
      !formats[metadata.format] ||
      (!legacy && formats[metadata.format] !== data.mime)
    )
      throw new Error('Provider returned an unsupported image format');
    const normalized = await image
      .rotate()
      .png()
      .toBuffer({ resolveWithObject: true });
    return this.persist(
      spaceId,
      normalized.data,
      normalized.info.width,
      normalized.info.height,
    );
  }
  private async persist(
    spaceId: string,
    bytes: Buffer,
    width: number | null,
    height: number | null,
    kind: StoreInput['kind'] = 'image',
    mime = 'image/png',
    durationMs: number | null = null,
  ): Promise<Asset> {
    const id = randomUUID();
    const storageKey = `spaces/${spaceId}/${id}.${mediaExtensions[mime]}`;
    await this.storage.put(storageKey, bytes, mime);
    try {
      return dto(
        await this.assets.save(
          this.assets.create({
            id,
            spaceId,
            kind,
            durationMs,
            storageKey,
            url: `/api/assets/${id}`,
            mime,
            sizeBytes: bytes.length,
            width,
            height,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          }),
        ),
      );
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => {});
      throw error;
    }
  }
  private async storeVideo(
    spaceId: string,
    input: StoreInput,
    limit: number,
  ): Promise<Asset> {
    if (!!input.bytes === !!input.stream)
      throw new Error('Provide exactly one of bytes or stream');
    if (!['video/mp4', 'video/webm'].includes(input.mime))
      throw new Error('Unsupported media MIME type');
    const meta = input.meta ?? {};
    if (
      !Number.isInteger(meta.width) ||
      !Number.isInteger(meta.height) ||
      meta.width! <= 0 ||
      meta.height! <= 0
    )
      throw new Error('Video width and height are required');
    if (
      meta.durationMs !== undefined &&
      (!Number.isInteger(meta.durationMs) ||
        meta.durationMs < 0 ||
        meta.durationMs > 2147483647)
    )
      throw new Error('Invalid media duration');
    const source = input.stream ?? Readable.from([input.bytes!]);
    const hash = createHash('sha256');
    let size = 0;
    let prefix = Buffer.alloc(0);
    const headerSize = input.mime === 'video/mp4' ? 12 : 4;
    const stream = Readable.from(
      (async function* () {
        for await (const value of source) {
          input.signal?.throwIfAborted();
          const chunk = Buffer.isBuffer(value)
            ? value
            : Buffer.from(value as Uint8Array);
          size += chunk.length;
          if (size > limit)
            throw new Error('Media exceeds the configured size limit');
          hash.update(chunk);
          if (prefix.length < headerSize)
            prefix = Buffer.concat([
              prefix,
              chunk.subarray(0, headerSize - prefix.length),
            ]);
          // Validate the signature as soon as enough bytes arrive; never accumulate the whole video.
          if (prefix.length >= headerSize) {
            if (input.mime === 'video/mp4') {
              if (
                prefix.toString('ascii', 4, 8) !== 'ftyp' ||
                prefix.readUInt32BE(0) < 12 ||
                prefix.readUInt32BE(0) > limit
              )
                throw new Error(
                  'Media content does not match its declared MIME type',
                );
            } else sniffMedia('video', input.mime, prefix);
          }
          yield chunk;
        }
        if (
          prefix.length < headerSize ||
          (input.mime === 'video/mp4' && prefix.readUInt32BE(0) > size)
        )
          throw new Error(
            'Media content does not match its declared MIME type',
          );
      })(),
    );
    const id = randomUUID(),
      storageKey = `spaces/${spaceId}/${id}.${mediaExtensions[input.mime]}`;
    try {
      await this.storage.putStream(
        storageKey,
        stream,
        input.mime,
        input.signal,
      );
      input.signal?.throwIfAborted();
      return dto(
        await this.assets.save(
          this.assets.create({
            id,
            spaceId,
            kind: 'video',
            storageKey,
            url: `/api/assets/${id}`,
            mime: input.mime,
            sizeBytes: size,
            sha256: hash.digest('hex'),
            width: meta.width!,
            height: meta.height!,
            durationMs: meta.durationMs ?? null,
          }),
        ),
      );
    } catch (error) {
      stream.destroy();
      source.destroy();
      await this.storage.remove(storageKey).catch(() => {});
      throw error;
    }
  }
  async forSpace(spaceId: string, id: string): Promise<Asset> {
    const asset = await this.assets.findOneBy({ id, spaceId });
    if (!asset)
      throw new NotFoundException(
        'Reference image is unavailable. Choose and upload the image again.',
      );
    return dto(asset);
  }
  async owned(user: User, id: string): Promise<AssetEntity> {
    const asset = await this.assets.findOneBy({ id });
    if (!asset) throw new NotFoundException('Image not found');
    await this.spaces.get(user, asset.spaceId);
    return asset;
  }
  async providerReference(spaceId: string, id: string) {
    const asset = await this.assets.findOneBy({ id, spaceId });
    if (!asset)
      throw new Error(
        'A reference image is unavailable. Upload or run its upstream node again.',
      );
    return {
      url: await this.storage.signedUrl(asset.storageKey),
      mime: asset.mime,
      read: async () => {
        const stream = await this.storage.get(asset.storageKey);
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
          const bytes = Buffer.from(chunk as Uint8Array);
          size += bytes.length;
          if (size > asset.sizeBytes) {
            stream.destroy();
            throw new Error('Reference image exceeds its stored size');
          }
          chunks.push(bytes);
        }
        return Buffer.concat(chunks);
      },
    };
  }
  async metadata(user: User, id: string): Promise<Asset> {
    return dto(await this.owned(user, id));
  }
  async stream(user: User, id: string, range?: string) {
    const asset = await this.owned(user, id);
    return { asset, body: await this.storage.get(asset.storageKey, range) };
  }
}
