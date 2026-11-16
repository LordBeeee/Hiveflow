import { join } from 'node:path';
import type { DataSourceOptions } from 'typeorm';

export function databaseOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    synchronize: false,
    migrationsRun: false,
    entities: [],
    migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  };
}
