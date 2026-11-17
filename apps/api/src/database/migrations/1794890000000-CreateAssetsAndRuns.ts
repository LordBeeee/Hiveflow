import type { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateAssetsAndRuns1794890000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE assets (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      kind text NOT NULL DEFAULT 'image' CHECK (kind = 'image'), storage_key text NOT NULL UNIQUE, url text NOT NULL,
      mime text NOT NULL, size_bytes integer NOT NULL, width integer NOT NULL, height integer NOT NULL, sha256 text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      'CREATE INDEX assets_space_idx ON assets (space_id)',
    );
    await queryRunner.query(`CREATE TABLE node_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
      node_id text NOT NULL, node_type text NOT NULL, sequence bigserial UNIQUE NOT NULL, batch_id uuid NULL,
      status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','canceled','skipped')),
      input_hash text NOT NULL, params jsonb NOT NULL, output jsonb NULL, error text NULL, provider text NULL,
      cache_hit boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz NULL, finished_at timestamptz NULL
    )`);
    await queryRunner.query(
      'CREATE INDEX node_runs_history_idx ON node_runs (space_id, node_id, created_at DESC)',
    );
    await queryRunner.query(
      'CREATE INDEX node_runs_input_hash_idx ON node_runs (input_hash)',
    );
    await queryRunner.query(
      "CREATE UNIQUE INDEX node_runs_active_unique ON node_runs (space_id, node_id, input_hash) WHERE status IN ('queued','running')",
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE node_runs');
    await queryRunner.query('DROP TABLE assets');
  }
}
