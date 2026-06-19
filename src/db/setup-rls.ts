/**
 * setup-rls.ts — enables Row-Level Security on `tasks` and installs the
 * tenant-isolation policy (runs as postgres superuser).
 *
 * Running tests BEFORE this step lets you observe isolation failures; running
 * them AFTER lets you see the same tests pass. The README documents this.
 *
 * Policy design:
 *
 *   USING (tenant_id::text = current_setting('app.current_tenant_id', true))
 *
 *   missing_ok=true  → returns NULL when the variable is not set
 *   NULL comparison  → evaluates to NULL (not TRUE) → row is invisible
 *   Correct context  → only matching rows surface
 *
 *   WITH CHECK mirrors USING so out-of-scope INSERTs/UPDATEs are also blocked.
 */
import 'dotenv/config';
import { adminPool } from './client.js';

async function setupRls() {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');

    // Grant table DML to app_user
    // (docker/init.sql sets DEFAULT PRIVILEGES for future tables; belt-and-suspenders for existing ones)
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO app_user`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON tasks   TO app_user`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user`);

    await client.query(`ALTER TABLE tasks ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE tasks FORCE ROW LEVEL SECURITY`);

    await client.query(`DROP POLICY IF EXISTS tasks_tenant_isolation ON tasks`);

    await client.query(`
      CREATE POLICY tasks_tenant_isolation ON tasks
        FOR ALL
        TO app_user
        USING (
          tenant_id::text = current_setting('app.current_tenant_id', true)
        )
        WITH CHECK (
          tenant_id::text = current_setting('app.current_tenant_id', true)
        )
    `);

    await client.query('COMMIT');
    console.log('✓ RLS enabled on tasks.');
    console.log('✓ Policy tasks_tenant_isolation created.');
    console.log('  Rows visible only when app.current_tenant_id matches tenant_id.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await adminPool.end();
  }
}

setupRls().catch((err) => {
  console.error('RLS setup failed:', err);
  process.exit(1);
});
