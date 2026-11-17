import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { SpaceEntity } from '../spaces/space.entity';
import { AssetEntity } from '../assets/asset.entity';
import { NodeRunEntity } from '../runs/node-run.entity';

export function databaseOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    synchronize: false,
    migrationsRun: false,
    entities: [SpaceEntity, AssetEntity, NodeRunEntity],
    migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  };
}
