import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSpaces1794873600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "spaces" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "user_id" uuid NOT NULL,
      "name" text NOT NULL,
      "graph" jsonb NOT NULL,
      "schema_version" integer NOT NULL DEFAULT 1,
      "version" integer NOT NULL DEFAULT 1,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "spaces_name_check" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
      CONSTRAINT "spaces_version_check" CHECK ("version" > 0 AND "schema_version" > 0)
    )`);
    await queryRunner.query(
      'CREATE INDEX "spaces_user_updated_idx" ON "spaces" ("user_id", "updated_at" DESC)',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "spaces"');
  }
}
