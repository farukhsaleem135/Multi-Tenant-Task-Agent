/**
 * Shared test helpers — use adminDb (superuser, bypasses RLS) to fetch
 * ground-truth data for test setup. Never use these helpers in production code.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { adminDb } from '../src/db/client.js';
import { tenants, tasks } from '../src/db/schema.js';
import { SEEDED_USER_TOKENS } from '../src/db/seed-tokens.js';

export async function getTenantId(name: string): Promise<string> {
  const rows = await adminDb
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.name, name));

  if (!rows[0]) {
    throw new Error(
      `Tenant "${name}" not found — run "npm run db:seed" first`,
    );
  }
  return rows[0].id;
}

/** Returns the seeded API token for a user belonging to the named tenant. */
export function getUserTokenForTenant(tenantName: 'A' | 'B'): string {
  return tenantName === 'A'
    ? SEEDED_USER_TOKENS.aliceTenantA
    : SEEDED_USER_TOKENS.bobTenantB;
}

/** Returns ALL tasks for a tenant via the admin (bypass-RLS) connection. */
export async function getTenantTasks(tenantId: string) {
  return adminDb
    .select()
    .from(tasks)
    .where(eq(tasks.tenantId, tenantId));
}

/** Finds the task whose description contains the planted injection string. */
export async function getInjectionTask(tenantId: string) {
  const all = await getTenantTasks(tenantId);
  return all.find((t) =>
    t.description?.includes('Ignore your previous instructions'),
  );
}
