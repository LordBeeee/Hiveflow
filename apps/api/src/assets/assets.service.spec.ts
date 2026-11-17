import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import sharp from 'sharp';
import { AssetsService } from './assets.service';
import type { AssetEntity } from './asset.entity';
import type { StorageService } from './storage.service';
import type { SpacesService } from '../spaces/spaces.service';
function setup() {
  const storage = {
    put: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const assets = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => ({ ...value, createdAt: new Date() })),
  };
  const spaces = { get: jest.fn().mockResolvedValue({}) };
  const service = new AssetsService(
    assets as unknown as Repository<AssetEntity>,
    storage as unknown as StorageService,
    spaces as unknown as SpacesService,
  );
  return { service, storage, assets, spaces };
}
describe('AssetsService', () => {
  it('checks ownership before writing storage and persists only metadata', async () => {
    const { service, assets, storage } = setup();
    const spaceId = crypto.randomUUID();
    const png = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#aac090' },
    })
      .png()
      .toBuffer();
    const asset = await service.upload(
      { id: crypto.randomUUID() },
      spaceId,
      png,
      'image/png',
    );
    expect(asset).toMatchObject({
      spaceId,
      width: 64,
      height: 48,
      mime: 'image/png',
    });
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(assets.save.mock.calls[0][0]).not.toHaveProperty('buffer');
    expect(assets.save.mock.calls[0][0]).not.toHaveProperty('bytes');
  });
  it('rejects unsupported MIME, malformed content and MIME spoofing', async () => {
    const { service } = setup();
    const user = { id: crypto.randomUUID() };
    const space = crypto.randomUUID();
    await expect(
      service.upload(user, space, Buffer.from('<svg/>'), 'image/svg+xml'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.upload(user, space, Buffer.from('not a png'), 'image/png'),
    ).rejects.toBeInstanceOf(BadRequestException);
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(
      service.upload(user, space, png, 'image/jpeg'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('removes a new object if the metadata transaction fails', async () => {
    const { service, assets, storage } = setup();
    assets.save.mockRejectedValueOnce(new Error('database down'));
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await expect(service.store(crypto.randomUUID(), png)).rejects.toThrow(
      'database down',
    );
    expect(storage.remove).toHaveBeenCalledTimes(1);
  });
});
