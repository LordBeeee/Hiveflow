import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';
import { emptyGraph } from '@hiveflow/shared';
import { SpacesService } from './spaces.service';
import { SpaceEntity } from './space.entity';

const user = { id: 'b5b48f38-1fb2-4a65-965d-f15253ec8b26' };
const id = '7515979c-28b8-44bd-9b39-f1fbb5d19351';
function setup() {
  const entity: SpaceEntity = {
    id,
    userId: user.id,
    name: 'Test',
    graph: emptyGraph(),
    schemaVersion: 1,
    version: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const builder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    setParameters: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const repo = {
    create: jest.fn((value: unknown) => value),
    save: jest.fn().mockResolvedValue(entity),
    find: jest.fn().mockResolvedValue([entity]),
    findOneBy: jest.fn().mockResolvedValue(entity),
    existsBy: jest.fn().mockResolvedValue(true),
    findOneByOrFail: jest.fn().mockResolvedValue(entity),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    createQueryBuilder: jest.fn(() => builder),
    manager: { transaction: jest.fn() },
  };
  repo.manager.transaction.mockImplementation(
    async (
      callback: (manager: {
        getRepository: () => typeof repo;
        query: (...args: unknown[]) => Promise<unknown>;
      }) => Promise<unknown>,
    ) =>
      callback({
        getRepository: () => repo,
        query: jest.fn().mockResolvedValue([]),
      }),
  );
  return {
    service: new SpacesService(repo as unknown as Repository<SpaceEntity>),
    repo,
    builder,
    entity,
  };
}

describe('SpacesService', () => {
  it('scopes reads, lists and deletes to the current owner', async () => {
    const { service, repo } = setup();
    await service.get(user, id);
    await service.list(user);
    await service.remove(user, id);
    expect(repo.findOneBy).toHaveBeenCalledWith({ id, userId: user.id });
    expect(repo.find.mock.calls[0][0].where).toEqual({ userId: user.id });
    expect(repo.delete).toHaveBeenCalledWith({ id, userId: user.id });
  });
  it('uses an atomic owner/version condition and parameterized graph update', async () => {
    const { service, builder } = setup();
    const graph = emptyGraph();
    await service.update(user, id, { graph, version: 1 });
    expect(builder.where).toHaveBeenCalledWith(
      'id = :id AND user_id = :userId AND version = :version',
      { id, userId: user.id, version: 1 },
    );
    expect(builder.setParameters).toHaveBeenCalledWith({
      graph: JSON.stringify(graph),
    });
    expect(builder.set.mock.calls[0][0].version()).toBe('"version" + 1');
  });
  it('returns conflict for a stale version and 404 for an unowned/missing row', async () => {
    const { service, builder, repo } = setup();
    builder.execute.mockResolvedValue({ affected: 0 });
    await expect(
      service.update(user, id, { graph: emptyGraph(), version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);
    repo.existsBy.mockResolvedValue(false);
    await expect(
      service.update(user, id, { graph: emptyGraph(), version: 1 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('validates the stored graph before a name-only write', async () => {
    const { service, entity } = setup();
    entity.graph.viewport.zoom = 0;
    await expect(
      service.update(user, id, { name: 'Renamed', version: 1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
  it('returns 404 for missing reads and deletes', async () => {
    const { service, repo } = setup();
    repo.findOneBy.mockResolvedValue(null);
    repo.delete.mockResolvedValue({ affected: 0 });
    await expect(service.get(user, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove(user, id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
