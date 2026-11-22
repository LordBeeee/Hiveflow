import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ExecutionContexts1795200000000 implements MigrationInterface {
  async up(query: QueryRunner) {
    // Existing space_id columns remain the executor's context key, avoiding a second engine.
    // Standalone contexts never create a spaces row or a saved graph.
    await query.query(`CREATE TABLE execution_contexts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      kind text NOT NULL CHECK(kind IN ('space','image','video','audio')),
      name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await query.query(
      `INSERT INTO execution_contexts(id,user_id,kind,name,created_at) SELECT id,user_id,'space',name,created_at FROM spaces`,
    );
    await query.query(
      `CREATE UNIQUE INDEX standalone_context_user_kind ON execution_contexts(user_id,kind) WHERE kind <> 'space'`,
    );
    await query.query(`CREATE FUNCTION sync_space_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP = 'DELETE' THEN DELETE FROM execution_contexts WHERE id=OLD.id AND kind='space'; RETURN OLD; END IF;
      INSERT INTO execution_contexts(id,user_id,kind,name) VALUES(NEW.id,NEW.user_id,'space',NEW.name)
        ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,name=EXCLUDED.name WHERE execution_contexts.kind='space';
      IF NOT FOUND THEN RAISE EXCEPTION 'Execution context already exists'; END IF;
      RETURN NEW;
    END $$`);
    await query.query(
      `CREATE TRIGGER space_context_write BEFORE INSERT OR UPDATE ON spaces FOR EACH ROW EXECUTE FUNCTION sync_space_context()`,
    );
    await query.query(
      `CREATE TRIGGER space_context_delete AFTER DELETE ON spaces FOR EACH ROW EXECUTE FUNCTION sync_space_context()`,
    );
    for (const table of ['assets', 'node_runs']) {
      await query.query(
        `ALTER TABLE ${table} DROP CONSTRAINT ${table}_space_id_fkey`,
      );
      await query.query(
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_space_id_fkey FOREIGN KEY(space_id) REFERENCES execution_contexts(id) ON DELETE CASCADE`,
      );
    }
  }
  async down(query: QueryRunner) {
    const [row] = await query.query(
      `SELECT count(*)::int AS count FROM execution_contexts WHERE kind <> 'space'`,
    );
    if (row.count)
      throw new Error(
        'Remove standalone contexts before reverting this migration.',
      );
    for (const table of ['assets', 'node_runs']) {
      await query.query(
        `ALTER TABLE ${table} DROP CONSTRAINT ${table}_space_id_fkey`,
      );
      await query.query(
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_space_id_fkey FOREIGN KEY(space_id) REFERENCES spaces(id) ON DELETE CASCADE`,
      );
    }
    await query.query('DROP TRIGGER space_context_write ON spaces');
    await query.query('DROP TRIGGER space_context_delete ON spaces');
    await query.query('DROP FUNCTION sync_space_context()');
    await query.query('DROP TABLE execution_contexts');
  }
}
