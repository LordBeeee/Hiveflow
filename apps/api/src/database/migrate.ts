import dataSource from './data-source';

async function migrate(): Promise<void> {
  try {
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: 'all' });
  } finally {
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}
void migrate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
