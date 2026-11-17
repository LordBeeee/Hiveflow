import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
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
    const bytes = await readBounded(data, cap * 1024 * 1024);
    if (data.kind !== 'image') {
      sniffMedia(data.kind, data.mime, bytes);
      const meta = data.meta ?? {};
      if (
        data.kind === 'video' &&
        (!Number.isInteger(meta.width) ||
          !Number.isInteger(meta.height) ||
          meta.width! <= 0 ||
          meta.height! <= 0)
      )
        throw new Error('Video width and height are required');
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
        data.kind === 'video' ? meta.width! : null,
        data.kind === 'video' ? meta.height! : null,
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
    return { url: await this.storage.signedUrl(asset.storageKey) };
  }
  async metadata(user: User, id: string): Promise<Asset> {
    return dto(await this.owned(user, id));
  }
  async stream(user: User, id: string) {
    const asset = await this.owned(user, id);
    return { asset, body: await this.storage.get(asset.storageKey) };
  }
}
