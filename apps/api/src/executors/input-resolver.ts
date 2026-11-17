import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  resolveNodeInputs,
  type GraphNode,
  type SpaceGraph,
  type RunOutput,
  type ResolvedInputs,
} from '@hiveflow/shared';
import { AssetsService } from '../assets/assets.service';
import { NodeRunEntity } from '../runs/node-run.entity';
@Injectable()
export class InputResolver {
  constructor(
    @InjectRepository(NodeRunEntity)
    private readonly runs: Repository<NodeRunEntity>,
    private readonly assets: AssetsService,
  ) {}
  resolve(
    spaceId: string,
    graph: SpaceGraph,
    node: GraphNode,
    batchOutputs?: Map<string, RunOutput | null>,
  ): Promise<ResolvedInputs> {
    return resolveNodeInputs(
      graph,
      node,
      async (source) => {
        if (batchOutputs) return batchOutputs.get(source.id);
        return (
          await this.runs.findOne({
            where: { spaceId, nodeId: source.id, status: 'succeeded' },
            order: { sequence: 'DESC' },
          })
        )?.output;
      },
      async (id) => {
        try {
          return await this.assets.forSpace(spaceId, id);
        } catch (error) {
          if (error instanceof NotFoundException) return null;
          throw error;
        }
      },
    );
  }
}
