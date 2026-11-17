import type { MigrationInterface, QueryRunner } from 'typeorm';
export class VideoTasks1795140000000 implements MigrationInterface {
  async up(query: QueryRunner) {
    await query.query(
      'ALTER TABLE node_runs ADD COLUMN provider_task_id text NULL',
    );
    await query.query(
      `CREATE TABLE mock_video_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid UNIQUE NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), canceled boolean NOT NULL DEFAULT false, fail boolean NOT NULL, duration_ms integer NOT NULL, submit_calls integer NOT NULL DEFAULT 1, input_hash text NOT NULL)`,
    );
    await query.query(
      "CREATE INDEX node_runs_provider_running ON node_runs(provider) WHERE status='running'",
    );
    await query.query(
      "CREATE INDEX node_runs_kind_running ON node_runs(provider_kind) WHERE status='running'",
    );
  }
  async down(query: QueryRunner) {
    await query.query(
      'DROP INDEX node_runs_kind_running, node_runs_provider_running',
    );
    await query.query('DROP TABLE mock_video_tasks');
    await query.query('ALTER TABLE node_runs DROP COLUMN provider_task_id');
  }
}
