import type { MigrationInterface, QueryRunner } from 'typeorm';
export class GeneralizePlatform1795130000000 implements MigrationInterface {
  async up(query: QueryRunner) {
    await query.query(
      `ALTER TABLE assets DROP CONSTRAINT assets_kind_check, ADD CONSTRAINT assets_kind_check CHECK(kind IN ('image','video','audio')), ALTER COLUMN width DROP NOT NULL, ALTER COLUMN height DROP NOT NULL, ALTER COLUMN size_bytes TYPE bigint, ADD COLUMN duration_ms integer NULL`,
    );
    await query.query(
      'ALTER TABLE node_runs ADD COLUMN model text NULL, ADD COLUMN provider_kind text NULL',
    );
    await query.query(`UPDATE node_runs SET inputs = jsonb_build_object('ports',
      (CASE WHEN inputs ? 'prompt' THEN jsonb_build_object('prompt', jsonb_build_array(jsonb_build_object('kind','text','value',inputs->>'prompt'))) ELSE '{}'::jsonb END) ||
      (CASE WHEN jsonb_array_length(COALESCE(inputs->'references','[]'::jsonb)) > 0 THEN jsonb_build_object('references', (SELECT jsonb_agg(jsonb_build_object('kind','asset','mediaKind','image','assetId',item->>'assetId','sha256',item->>'sha256')) FROM jsonb_array_elements(inputs->'references') item)) ELSE '{}'::jsonb END))
      || CASE WHEN inputs ? 'error' THEN jsonb_build_object('error',inputs->>'error') ELSE '{}'::jsonb END
      WHERE inputs IS NOT NULL AND NOT inputs ? 'ports'`);
  }
  async down(query: QueryRunner) {
    await query.query(
      'ALTER TABLE node_runs DROP COLUMN model, DROP COLUMN provider_kind',
    );
    await query.query(
      `ALTER TABLE assets DROP CONSTRAINT assets_kind_check, ADD CONSTRAINT assets_kind_check CHECK(kind='image'), ALTER COLUMN width SET NOT NULL, ALTER COLUMN height SET NOT NULL, ALTER COLUMN size_bytes TYPE integer, DROP COLUMN duration_ms`,
    );
  }
}
