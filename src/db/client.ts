import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import * as schema from './schema.js';

// ─── Admin pool (postgres superuser) ─────────────────────────────────────────
// Superusers bypass RLS. Use ONLY for migrations and seeding.
// Never expose this pool to application logic or agent tool handlers.
export const adminPool = new Pool({
  connectionString: process.env.DATABASE_URL_ADMIN,
});

// ─── App pool (app_user) ──────────────────────────────────────────────────────
// app_user is a non-superuser — RLS is enforced for every query.
// This is the only pool that agent tools and MCP handlers should use.
export const appPool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const adminDb = drizzle(adminPool, { schema });

/**
 * Execute `fn` inside a transaction scoped to `tenantId`.
 *
 * How it works:
 *   1. Acquire a connection from the app pool (RLS enforced for app_user).
 *   2. BEGIN a transaction.
 *   3. Call set_config('app.current_tenant_id', tenantId, true) — the `true`
 *      (is_local) flag means the setting is cleared at transaction end,
 *      preventing bleed-through to the next caller on a pooled connection.
 *   4. Hand a Drizzle client to `fn`. The RLS policy on `tasks` reads
 *      current_setting('app.current_tenant_id', true) and filters rows.
 *      No WHERE clause in application code is needed or trusted.
 *   5. COMMIT (ROLLBACK on error).
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (db: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>,
): Promise<T> {
  const client: PoolClient = await appPool.connect();
  try {
    await client.query('BEGIN');
    // Parameterized to prevent injection; LOCAL = auto-cleared at transaction end
    await client.query(
      `SELECT set_config('app.current_tenant_id', $1, true)`,
      [tenantId],
    );
    const db = drizzle(client, { schema });
    const result = await fn(db);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Acquire a raw app_user client with NO tenant context set.
 * Used in isolation tests to verify zero-row behavior when the
 * session variable is absent — proving RLS is active on its own.
 */
export async function getRawAppClient(): Promise<{
  client: PoolClient;
  release: () => void;
}> {
  const client = await appPool.connect();
  return { client, release: () => client.release() };
}
