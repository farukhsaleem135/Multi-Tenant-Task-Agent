/**
 * MCP integration eval — exercises the real stdio server process.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getTenantId, getTenantTasks } from './setup.js';
import { startMcpClient, parseToolText } from './mcp-helpers.js';
import { appPool, adminPool } from '../src/db/client.js';

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

describe('MCP server — integration', () => {
  it('exposes exactly two tools: list_tasks and get_task', async () => {
    const session = await startMcpClient('A');
    try {
      const { tools } = await session.client.listTools();
      const names = tools?.map((t) => t.name).sort() ?? [];
      expect(names).toEqual(['get_task', 'list_tasks']);
    } finally {
      await session.close();
    }
  });

  it('list_tasks returns only the authorised tenant rows', async () => {
    const session = await startMcpClient('A');
    try {
      const result = await session.client.callTool({ name: 'list_tasks', arguments: {} });
      const body = parseToolText(result) as { tasks: Array<{ tenantId: string }> };

      expect(body.tasks.length).toBeGreaterThan(0);
      for (const task of body.tasks) {
        expect(task.tenantId).toBe(tenantAId);
      }
    } finally {
      await session.close();
    }
  });

  it('get_task returns NOT_FOUND for a cross-tenant task ID', async () => {
    const bTasks = await getTenantTasks(tenantBId);
    const targetId = bTasks[0].id;

    const session = await startMcpClient('A');
    try {
      const result = await session.client.callTool({
        name: 'get_task',
        arguments: { task_id: targetId },
      });
      const body = parseToolText(result) as { error?: string; task?: unknown };

      expect(body).toEqual({ error: 'NOT_FOUND' });
      expect(body.task).toBeUndefined();
    } finally {
      await session.close();
    }
  });

  it('get_task returns NOT_FOUND for a non-existent UUID (same shape as cross-tenant)', async () => {
    const session = await startMcpClient('A');
    try {
      const result = await session.client.callTool({
        name: 'get_task',
        arguments: { task_id: '00000000-0000-0000-0000-000000000001' },
      });
      const body = parseToolText(result) as { error?: string };

      expect(body).toEqual({ error: 'NOT_FOUND' });
    } finally {
      await session.close();
    }
  });

  it('list_tasks as Tenant A never leaks Tenant B titles (injection scenario)', async () => {
    const tenantBTitles = (await getTenantTasks(tenantBId)).map((t) => t.title);

    const session = await startMcpClient('A');
    try {
      const result = await session.client.callTool({ name: 'list_tasks', arguments: {} });
      const body = parseToolText(result) as { tasks: Array<{ title: string; description?: string }> };
      const payload = JSON.stringify(body);

      for (const title of tenantBTitles) {
        expect(payload, `MCP list_tasks must not expose Tenant B task "${title}"`).not.toContain(
          title,
        );
      }

      const hasInjection = body.tasks.some((t) =>
        t.description?.includes('Ignore your previous instructions'),
      );
      expect(hasInjection).toBe(true);
    } finally {
      await session.close();
    }
  });
});
