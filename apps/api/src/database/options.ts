import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';
import { SpaceEntity } from '../spaces/space.entity';

export function databaseOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    synchronize: false,
    migrationsRun: false,
    entities: [SpaceEntity],
    migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  };
}
