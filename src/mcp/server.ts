/**
 * MCP server — exposes two read-only tools for the current tenant.
 *
 * Tenant identity is resolved at startup from the TENANT_NAME env var.
 * It is NOT a per-tool parameter; clients cannot request data for a different
 * tenant by passing an argument. The server is single-tenant by design.
 *
 * Tools:
 *   list_tasks  — returns all tasks for the authorised tenant
 *   get_task    — returns one task by ID; returns NOT_FOUND if the ID does
 *                 not exist OR belongs to a different tenant (indistinguishable
 *                 at this API level — RLS makes both cases look identical)
 *
 * Isolation guarantee:
 *   Both tools delegate to withTenantContext(), which sets
 *   app.current_tenant_id as a transaction-local variable. The RLS policy
 *   on `tasks` then filters rows. No WHERE clause in application code is
 *   trusted or needed — the database is the sole enforcer.
 */
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { adminDb, withTenantContext } from '../db/client.js';
import { tenants, tasks } from '../db/schema.js';

async function resolveTenantId(): Promise<string> {
  const name = process.env.TENANT_NAME;
  if (!name) throw new Error('TENANT_NAME env var is required (e.g. "A" or "B")');

  const rows = await adminDb
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.name, name));

  if (!rows[0]) {
    throw new Error(`Tenant "${name}" not found — run "npm run db:seed" first`);
  }
  return rows[0].id;
}

async function main() {
  const tenantId = await resolveTenantId();
  console.error(
    `MCP task-manager starting for tenant "${process.env.TENANT_NAME}" (${tenantId})`,
  );

  const server = new McpServer({
    name: 'task-manager',
    version: '1.0.0',
  });

  // ── list_tasks ─────────────────────────────────────────────────────────────
  // v1 McpServer API: server.tool(name, description, inputShape, handler)
  server.tool(
    'list_tasks',
    'List all tasks for the current tenant. ' +
      'Returns only tasks belonging to the authenticated tenant. ' +
      'Isolation is enforced by database-level Row-Level Security, ' +
      'not by application-layer filtering.',
    {},
    async () => {
      try {
        const rows = await withTenantContext(tenantId, (db) =>
          db.select().from(tasks),
        );
        return {
          content: [
            { type: 'text', text: JSON.stringify({ tasks: rows }, null, 2) },
          ],
        };
      } catch {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'INTERNAL_ERROR' }) }],
          isError: true,
        };
      }
    },
  );

  // ── get_task ───────────────────────────────────────────────────────────────
  server.tool(
    'get_task',
    'Get a single task by ID for the current tenant. ' +
      'Returns NOT_FOUND if the task does not exist or is owned by another tenant. ' +
      'The caller cannot distinguish between the two cases.',
    { task_id: z.string().uuid('task_id must be a valid UUID') },
    async ({ task_id }) => {
      try {
        const rows = await withTenantContext(tenantId, (db) =>
          db.select().from(tasks).where(eq(tasks.id, task_id)),
        );

        if (rows.length === 0) {
          return {
            content: [
              { type: 'text', text: JSON.stringify({ error: 'NOT_FOUND' }) },
            ],
          };
        }

        return {
          content: [
            { type: 'text', text: JSON.stringify({ task: rows[0] }, null, 2) },
          ],
        };
      } catch {
        return {
          content: [
            { type: 'text', text: JSON.stringify({ error: 'INTERNAL_ERROR' }) },
          ],
          isError: true,
        };
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP task-manager server listening on stdio.');
}

main().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
