import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import sharp, { type OutputInfo } from 'sharp';
import type { Asset } from '@hiveflow/shared';
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
  return {
    id: asset.id,
    spaceId: asset.spaceId,
    kind: 'image',
    url: asset.url,
    mime: asset.mime,
    sizeBytes: asset.sizeBytes,
    width: asset.width,
    height: asset.height,
    sha256: asset.sha256,
    createdAt: asset.createdAt.toISOString(),
  };
}
@Injectable()
export class AssetsService {
  constructor(
    @InjectRepository(AssetEntity)
    private readonly assets: Repository<AssetEntity>,
    private readonly storage: StorageService,
    private readonly spaces: SpacesService,
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
  async store(spaceId: string, bytes: Buffer): Promise<Asset> {
    const image = sharp(bytes, {
      limitInputPixels: 16_777_216,
      failOn: 'error',
    });
    const metadata = await image.metadata();
    if (!metadata.format || !formats[metadata.format])
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
    width: number,
    height: number,
  ): Promise<Asset> {
    const id = randomUUID();
    const storageKey = `spaces/${spaceId}/${id}.png`;
    await this.storage.put(storageKey, bytes, 'image/png');
    try {
      return dto(
        await this.assets.save(
          this.assets.create({
            id,
            spaceId,
            kind: 'image',
            storageKey,
            url: `/api/assets/${id}`,
            mime: 'image/png',
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
  async metadata(user: User, id: string): Promise<Asset> {
    return dto(await this.owned(user, id));
  }
  async stream(user: User, id: string) {
    const asset = await this.owned(user, id);
    return { asset, body: await this.storage.get(asset.storageKey) };
  }
}
