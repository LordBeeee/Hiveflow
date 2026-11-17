import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import type { AssetsService } from '../assets/assets.service';
import { RunCache } from './run-cache';
import type { NodeRunEntity } from './node-run.entity';
function setup() {
  const row = { output: { image: [{ assetId: 'image' }] } };
  const repo = { findOne: jest.fn().mockResolvedValue(row) };
  const assets = { forSpace: jest.fn().mockResolvedValue({}) };
  return {
    row,
    repo,
    assets,
    cache: new RunCache(
      repo as unknown as Repository<NodeRunEntity>,
      assets as unknown as AssetsService,
    ),
  };
}
it('reuses only succeeded output for the same Space, node and content hash', async () => {
  const { cache, repo, assets, row } = setup();
  expect(await cache.find('space', 'node', 'hash')).toBe(row);
  expect(repo.findOne).toHaveBeenCalledWith({
    where: {
      spaceId: 'space',
      nodeId: 'node',
      inputHash: 'hash',
      status: 'succeeded',
    },
    order: { sequence: 'DESC' },
  });
  expect(assets.forSpace).toHaveBeenCalledWith('space', 'image');
});
it('ignores cache entries with missing assets without hiding infrastructure failures', async () => {
  const { cache, assets } = setup();
  assets.forSpace.mockRejectedValueOnce(new NotFoundException());
  expect(await cache.find('space', 'node', 'hash')).toBeNull();
  assets.forSpace.mockRejectedValueOnce(new Error('database down'));
  await expect(cache.find('space', 'node', 'hash')).rejects.toThrow(
    'database down',
  );
});
