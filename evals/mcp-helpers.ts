/**
 * Helpers for MCP integration tests — spawns the real stdio server process.
 *
 * Auth is passed via MCP_AUTH_TOKEN env, which simulates Authorization: Bearer
 * for stdio transport (no HTTP headers). The same server binary serves all
 * tenants; tenant is resolved per tool call from the user token.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const projectRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

export type McpSession = {
  client: Client;
  transport: StdioClientTransport;
  close: () => Promise<void>;
};

export async function startMcpClient(authToken: string): Promise<McpSession> {
  const env = { ...process.env };
  env.MCP_AUTH_TOKEN = authToken;
  delete env.TENANT_NAME;

  const transport = new StdioClientTransport({
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['tsx', path.join(projectRoot, 'src/mcp/server.ts')],
    env,
    cwd: projectRoot,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'eval-client', version: '1.0.0' });
  await client.connect(transport);

  return {
    client,
    transport,
    close: async () => {
      await transport.close();
    },
  };
}

export async function startMcpClientUnauthenticated(): Promise<McpSession> {
  const env = { ...process.env };
  delete env.MCP_AUTH_TOKEN;
  delete env.TENANT_NAME;

  const transport = new StdioClientTransport({
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['tsx', path.join(projectRoot, 'src/mcp/server.ts')],
    env,
    cwd: projectRoot,
    stderr: 'pipe',
  });

  const client = new Client({ name: 'eval-client', version: '1.0.0' });
  await client.connect(transport);

  return {
    client,
    transport,
    close: async () => {
      await transport.close();
    },
  };
}

export function parseToolText(result: {
  content: Array<{ type: string; text?: string }>;
}): unknown {
  const textBlock = result.content.find((b) => b.type === 'text');
  if (!textBlock?.text) {
    throw new Error('MCP tool response missing text content');
  }
  return JSON.parse(textBlock.text);
}
