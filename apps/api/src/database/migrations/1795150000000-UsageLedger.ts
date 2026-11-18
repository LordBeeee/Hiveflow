import type { MigrationInterface, QueryRunner } from 'typeorm';
export class UsageLedger1795150000000 implements MigrationInterface {
  async up(query: QueryRunner) {
    await query.query(
      `ALTER TABLE node_runs ADD COLUMN cost_user_id uuid NOT NULL DEFAULT 'b5b48f38-1fb2-4a65-965d-f15253ec8b26', ADD COLUMN cost_units numeric(18,3) NOT NULL DEFAULT 0, ADD COLUMN cost_reserved boolean NOT NULL DEFAULT false, ADD COLUMN cost_provider boolean NOT NULL DEFAULT false, ADD COLUMN cost_refunded boolean NOT NULL DEFAULT false, ADD COLUMN budget_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date)`,
    );
    await query.query('UPDATE node_runs SET cost_reserved=true');
    await query.query(
      `CREATE TABLE usage_ledger(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, run_id uuid NULL REFERENCES node_runs(id) ON DELETE SET NULL, units numeric(18,3) NOT NULL, entry_type text NOT NULL CHECK(entry_type IN ('reserve','adjustment','refund')), budget_date date NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
    );
    await query.query(
      "CREATE UNIQUE INDEX usage_ledger_once ON usage_ledger(run_id,entry_type) WHERE entry_type IN ('reserve','refund')",
    );
    await query.query(
      'CREATE INDEX usage_ledger_user_day ON usage_ledger(user_id,budget_date)',
    );
  }
  async down(query: QueryRunner) {
    await query.query('DROP TABLE usage_ledger');
    await query.query(
      'ALTER TABLE node_runs DROP COLUMN cost_user_id, DROP COLUMN cost_units, DROP COLUMN cost_reserved, DROP COLUMN cost_refunded, DROP COLUMN cost_provider, DROP COLUMN budget_date',
    );
  }
}
