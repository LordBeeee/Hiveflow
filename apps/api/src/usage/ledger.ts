import type { EntityManager } from 'typeorm';
export interface LedgerRun {
  id: string;
  cost_user_id: string;
  cost_units: string;
  budget_date: string;
}
export async function lockUsage(manager: EntityManager, userId: string) {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `usage:${userId}`,
  ]);
}
// Caller owns the user lock and row lock. Ledger entries survive Space/run deletion.
export async function refundLockedRun(manager: EntityManager, row: LedgerRun) {
  await manager.query(
    "INSERT INTO usage_ledger(user_id,run_id,units,entry_type,budget_date) VALUES($1,$2,$3,'refund',$4) ON CONFLICT DO NOTHING",
    [row.cost_user_id, row.id, -Number(row.cost_units), row.budget_date],
  );
  await manager.query(
    'UPDATE node_runs SET cost_refunded=true,cost_units=0 WHERE id=$1',
    [row.id],
  );
}
