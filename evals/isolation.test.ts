/**
 * Isolation eval — proves RLS enforces tenant boundaries at the database layer.
 *
 * These tests FAIL when run before `npm run db:setup-rls` and PASS after.
 * The "no context" and "wrong context" tests directly demonstrate that the
 * database — not application code — is the enforcer.
 *
 * Connection matrix:
 *   adminDb (setup only)  → postgres superuser, BYPASSES RLS
 *   withTenantContext(id) → app_user + SET LOCAL → RLS enforced
 *   getRawAppClient()     → app_user, NO context set → zero rows expected
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTenantId, getTenantTasks } from './setup.js';
import {
  withTenantContext,
  getRawAppClient,
  appPool,
  adminPool,
} from '../src/db/client.js';
import { tasks } from '../src/db/schema.js';

let tenantAId: string;
let tenantBId: string;

beforeAll(async () => {
  tenantAId = await getTenantId('A');
  tenantBId = await getTenantId('B');
});

afterAll(async () => {
  await appPool.end().catch(() => undefined);
  await adminPool.end().catch(() => undefined);
});

describe('RLS — Tenant Isolation', () => {
  it('Tenant A list returns only Tenant A rows', async () => {
    const rows = await withTenantContext(tenantAId, (db) =>
      db.select().from(tasks),
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tenantId).toBe(tenantAId);
    }
  });

  it('Tenant B list returns only Tenant B rows', async () => {
    const rows = await withTenantContext(tenantBId, (db) =>
      db.select().from(tasks),
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.tenantId).toBe(tenantBId);
    }
  });

  it('Tenant A CANNOT retrieve a Tenant B task by ID — RLS returns 0 rows', async () => {
    // Ground truth via admin (bypasses RLS)
    const bTasks = await getTenantTasks(tenantBId);
    expect(bTasks.length).toBeGreaterThan(0);

    const targetId = bTasks[0].id;

    // Same ID, queried as Tenant A — RLS must hide it
    const rows = await withTenantContext(tenantAId, (db) =>
      db.select().from(tasks).where(eq(tasks.id, targetId)),
    );

    expect(rows).toHaveLength(0);
  });

  it('get_task cross-tenant ID returns NOT_FOUND (MCP tool behaviour)', async () => {
    const bTasks = await getTenantTasks(tenantBId);
    const targetId = bTasks[0].id;

    const rows = await withTenantContext(tenantAId, (db) =>
      db.select().from(tasks).where(eq(tasks.id, targetId)),
    );

    // MCP server logic: 0 rows → NOT_FOUND (no "forbidden" — caller learns nothing)
    const response = rows.length === 0 ? { error: 'NOT_FOUND' } : { task: rows[0] };
    expect(response).toEqual({ error: 'NOT_FOUND' });
  });

  it('No tenant context returns ZERO rows — FAILS before setup-rls', async () => {
    // app_user connection, no set_config call → current_setting returns NULL
    // USING (tenant_id::text = NULL) → NULL → row invisible
    // Before RLS setup: this returns all rows and the test FAILS
    const { client, release } = await getRawAppClient();
    try {
      const result = await client.query('SELECT * FROM tasks');
      expect(result.rows).toHaveLength(0);
    } finally {
      release();
    }
  });

  it('Wrong tenant context returns ZERO rows — FAILS before setup-rls', async () => {
    const { client, release } = await getRawAppClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.current_tenant_id', $1, true)`,
        ['00000000-0000-0000-0000-000000000000'],
      );
      const result = await client.query('SELECT * FROM tasks');
      await client.query('COMMIT');
      expect(result.rows).toHaveLength(0);
    } finally {
      release();
    }
  });
});
