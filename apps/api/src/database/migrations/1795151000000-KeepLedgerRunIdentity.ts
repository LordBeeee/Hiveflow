import type { MigrationInterface, QueryRunner } from 'typeorm';
export class KeepLedgerRunIdentity1795151000000 implements MigrationInterface {
  async up(query: QueryRunner) {
    // An audit event keeps its logical run identifier after the workflow is deleted.
    await query.query(
      'ALTER TABLE usage_ledger DROP CONSTRAINT IF EXISTS usage_ledger_run_id_fkey',
    );
  }
  async down(query: QueryRunner) {
    await query.query(
      'ALTER TABLE usage_ledger ADD CONSTRAINT usage_ledger_run_id_fkey FOREIGN KEY(run_id) REFERENCES node_runs(id) ON DELETE SET NULL NOT VALID',
    );
  }
}
