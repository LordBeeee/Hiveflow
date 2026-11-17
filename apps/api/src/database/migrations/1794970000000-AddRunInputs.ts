import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddRunInputs1794970000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE node_runs ADD COLUMN inputs jsonb NULL',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE node_runs DROP COLUMN inputs');
  }
}
