/**
 * MCP server — exposes two read-only tools for all tenants.
 *
 * A single server instance serves every tenant. On each tool call the server
 * resolves the caller's tenant from authenticated user identity (bearer token),
 * then delegates to withTenantContext() so RLS enforces row visibility.
 *
 * Tools:
 *   list_tasks  — returns all tasks for the authenticated user's tenant
 *   get_task    — returns one task by ID; returns NOT_FOUND if the ID does
 *                 not exist OR belongs to a different tenant (indistinguishable
 *                 at this API level — RLS makes both cases look identical)
 *
 * Tenant identity is NEVER taken from tool arguments — only from auth context.
 */
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { withTenantContext } from '../db/client.js';
import { tasks } from '../db/schema.js';
import { resolveTenantFromRequest } from '../auth/resolve-tenant.js';

type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

function unauthorizedResult() {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: 'UNAUTHORIZED' }) }],
    isError: true,
  };
}

function internalErrorResult() {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: 'INTERNAL_ERROR' }) }],
    isError: true,
  };
}

async function main() {
  console.error('MCP task-manager starting (multi-tenant — auth resolves tenant per request).');

  const server = new McpServer({
    name: 'task-manager',
    version: '1.0.0',
  });

  server.tool(
    'list_tasks',
    'List all tasks for the authenticated user\'s tenant. ' +
      'Returns only tasks belonging to the tenant linked to the caller. ' +
      'Isolation is enforced by database-level Row-Level Security, ' +
      'not by application-layer filtering.',
    {},
    async (_args, extra: ToolExtra) => {
      try {
        const resolution = await resolveTenantFromRequest(extra);
        if (!resolution.ok) {
          return unauthorizedResult();
        }

        const rows = await withTenantContext(resolution.tenantId, (db) =>
          db.select().from(tasks),
        );
        return {
          content: [
            { type: 'text', text: JSON.stringify({ tasks: rows }, null, 2) },
          ],
        };
      } catch {
        return internalErrorResult();
      }
    },
  );

  server.tool(
    'get_task',
    'Get a single task by ID for the authenticated user\'s tenant. ' +
      'Returns NOT_FOUND if the task does not exist or is owned by another tenant. ' +
      'The caller cannot distinguish between the two cases.',
    { task_id: z.string().uuid('task_id must be a valid UUID') },
    async ({ task_id }, extra: ToolExtra) => {
      try {
        const resolution = await resolveTenantFromRequest(extra);
        if (!resolution.ok) {
          return unauthorizedResult();
        }

        const rows = await withTenantContext(resolution.tenantId, (db) =>
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
        return internalErrorResult();
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
