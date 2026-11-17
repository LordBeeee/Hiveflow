import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import sharp from 'sharp';
import { Readable } from 'node:stream';
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
  it('persists streamed audio and video with matching metadata and extensions', async () => {
    const { service, storage } = setup();
    const spaceId = crypto.randomUUID();
    const wav = Buffer.alloc(44);
    wav.write('RIFF', 0);
    wav.write('WAVE', 8);
    const audio = await service.store(spaceId, {
      kind: 'audio',
      stream: Readable.from([wav.subarray(0, 10), wav.subarray(10)]),
      mime: 'audio/wav',
      meta: { durationMs: 1200 },
    });
    expect(audio).toMatchObject({
      kind: 'audio',
      width: null,
      height: null,
      durationMs: 1200,
      sizeBytes: 44,
    });
    expect(storage.put).toHaveBeenLastCalledWith(
      expect.stringMatching(/\.wav$/),
      wav,
      'audio/wav',
    );
    const mp4 = Buffer.alloc(16);
    mp4.writeUInt32BE(16, 0);
    mp4.write('ftyp', 4);
    const video = await service.store(spaceId, {
      kind: 'video',
      bytes: mp4,
      mime: 'video/mp4',
      meta: { width: 320, height: 180, durationMs: 2000 },
    });
    expect(video).toMatchObject({
      kind: 'video',
      width: 320,
      height: 180,
      durationMs: 2000,
      sizeBytes: 16,
    });
    expect(storage.put).toHaveBeenLastCalledWith(
      expect.stringMatching(/\.mp4$/),
      mp4,
      'video/mp4',
    );
    await expect(
      service.store(spaceId, { kind: 'video', bytes: mp4, mime: 'video/mp4' }),
    ).rejects.toThrow('width and height');
    expect(storage.put).toHaveBeenCalledTimes(2);
  });
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
