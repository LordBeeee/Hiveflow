import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetsService } from '../assets/assets.service';
import { NodeRunEntity } from './node-run.entity';
@Injectable()
export class RunCache {
  constructor(
    @InjectRepository(NodeRunEntity)
    private readonly runs: Repository<NodeRunEntity>,
    private readonly assets: AssetsService,
  ) {}
  async find(spaceId: string, nodeId: string, hash: string) {
    const run = await this.runs.findOne({
      where: { spaceId, nodeId, inputHash: hash, status: 'succeeded' },
      order: { sequence: 'DESC' },
    });
    if (!run?.output) return null;
    for (const image of run.output.image ?? []) {
      try {
        await this.assets.forSpace(spaceId, image.assetId);
      } catch (error) {
        if (error instanceof NotFoundException) return null;
        throw error;
      }
    }
    return run;
  }
}
