import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveDemoVideoTasks1795300000000 implements MigrationInterface {
  async up(query: QueryRunner) {
    // Runs and stored outputs remain available in history; only the retired
    // provider's private task bookkeeping is removed.
    await query.query('DROP TABLE IF EXISTS mock_video_tasks');
  }

  async down(query: QueryRunner) {
    await query.query(
      `CREATE TABLE mock_video_tasks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid UNIQUE NOT NULL REFERENCES node_runs(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), canceled boolean NOT NULL DEFAULT false, fail boolean NOT NULL, duration_ms integer NOT NULL, submit_calls integer NOT NULL DEFAULT 1, input_hash text NOT NULL)`,
    );
  }
}
