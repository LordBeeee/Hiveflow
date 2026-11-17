import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  emptyGraph,
  spaceGraphSchema,
  type CreateSpaceInput,
  type SpaceDocument,
  type SpaceSummary,
  type UpdateSpaceInput,
} from '@hiveflow/shared';
import { SpaceEntity } from './space.entity';
import type { User } from '../auth/current-user';

function summary(space: SpaceEntity): SpaceSummary {
  return {
    id: space.id,
    name: space.name,
    version: space.version,
    createdAt: space.createdAt.toISOString(),
    updatedAt: space.updatedAt.toISOString(),
  };
}
function document(space: SpaceEntity): SpaceDocument {
  return {
    ...summary(space),
    graph: space.graph,
    schemaVersion: space.schemaVersion,
  };
}

@Injectable()
export class SpacesService {
  constructor(
    @InjectRepository(SpaceEntity)
    private readonly spaces: Repository<SpaceEntity>,
  ) {}

  async create(user: User, body: CreateSpaceInput): Promise<SpaceDocument> {
    const graph = body.graph ?? emptyGraph();
    const space = await this.spaces.save(
      this.spaces.create({
        userId: user.id,
        name: body.name ?? 'Untitled space',
        graph,
        schemaVersion: graph.schemaVersion,
        version: 1,
      }),
    );
    return document(space);
  }
  async list(user: User): Promise<SpaceSummary[]> {
    const spaces = await this.spaces.find({
      where: { userId: user.id },
      select: {
        id: true,
        name: true,
        version: true,
        createdAt: true,
        updatedAt: true,
      },
      order: { updatedAt: 'DESC', id: 'ASC' },
    });
    return spaces.map(summary);
  }
  async get(user: User, id: string): Promise<SpaceDocument> {
    const space = await this.spaces.findOneBy({ id, userId: user.id });
    if (!space) throw new NotFoundException('Space not found');
    return document(space);
  }
  async update(
    user: User,
    id: string,
    body: UpdateSpaceInput,
  ): Promise<SpaceDocument> {
    return this.spaces.manager.transaction(async (manager) => {
      const repository = manager.getRepository(SpaceEntity);
      if (body.graph === undefined) {
        const current = await repository.findOneBy({ id, userId: user.id });
        if (!current) throw new NotFoundException('Space not found');
        const parsed = spaceGraphSchema.safeParse(current.graph);
        if (!parsed.success)
          throw new BadRequestException({
            message: 'Invalid saved graph',
            errors: parsed.error.issues.map((issue) => ({
              path: ['graph', ...issue.path].map(String).join('.'),
              message: issue.message,
            })),
          });
      }
      const result = await repository
        .createQueryBuilder()
        .update(SpaceEntity)
        .set({
          ...(body.graph !== undefined
            ? {
                graph: () => 'CAST(:graph AS jsonb)',
                schemaVersion: body.graph.schemaVersion,
              }
            : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          version: () => '"version" + 1',
          updatedAt: () => 'CURRENT_TIMESTAMP',
        })
        .setParameters(
          body.graph !== undefined ? { graph: JSON.stringify(body.graph) } : {},
        )
        .where('id = :id AND user_id = :userId AND version = :version', {
          id,
          userId: user.id,
          version: body.version,
        })
        .execute();
      if (!result.affected) {
        if (!(await repository.existsBy({ id, userId: user.id })))
          throw new NotFoundException('Space not found');
        throw new ConflictException(
          'This space changed in another tab. Reload the saved version or save your edits as a copy.',
        );
      }
      return document(
        await repository.findOneByOrFail({ id, userId: user.id }),
      );
    });
  }
  async remove(user: User, id: string): Promise<void> {
    const result = await this.spaces.delete({ id, userId: user.id });
    if (!result.affected) throw new NotFoundException('Space not found');
  }
}
