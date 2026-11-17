import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateBatches1795050000000 implements MigrationInterface {
  async up(query: QueryRunner) {
    await query.query(`CREATE TABLE batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      graph jsonb NOT NULL, levels jsonb NOT NULL, current_level integer NOT NULL DEFAULT 0,
      force boolean NOT NULL DEFAULT false, status text NOT NULL CHECK(status IN ('running','succeeded','failed','canceled')),
      created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz NULL
    )`);
    await query.query(
      "CREATE UNIQUE INDEX batches_active_unique ON batches(space_id) WHERE status='running'",
    );
    await query.query(
      'ALTER TABLE node_runs ADD COLUMN prepared boolean NOT NULL DEFAULT true, ADD COLUMN level integer NULL',
    );
    await query.query(
      'ALTER TABLE node_runs ADD CONSTRAINT node_runs_batch_fk FOREIGN KEY(batch_id) REFERENCES batches(id) ON DELETE CASCADE',
    );
    await query.query(
      'CREATE INDEX node_runs_batch_idx ON node_runs(batch_id, level)',
    );
  }
  async down(query: QueryRunner) {
    await query.query(
      'ALTER TABLE node_runs DROP CONSTRAINT node_runs_batch_fk, DROP COLUMN prepared, DROP COLUMN level',
    );
    await query.query('DROP TABLE batches');
  }
}
