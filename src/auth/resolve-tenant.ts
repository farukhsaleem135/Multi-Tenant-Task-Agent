/**
 * Resolves the tenant for an authenticated user from a bearer token.
 * Uses adminDb — user→tenant mapping is auth metadata, not tenant-scoped task data.
 */
import { eq } from 'drizzle-orm';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import { adminDb } from '../db/client.js';
import { users } from '../db/schema.js';
import { getSessionToken, setSessionToken } from './session-store.js';

export type TenantResolution =
  | { ok: true; tenantId: string; userId: string }
  | { ok: false; error: 'UNAUTHORIZED' };

function parseBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

function headerValue(
  headers: Record<string, string> | Headers | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

/**
 * Extract a bearer token from MCP request context.
 * Priority: OAuth authInfo → HTTP Authorization header → session store → MCP_AUTH_TOKEN env.
 */
export function extractAuthToken(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
): string | undefined {
  if (extra.authInfo?.token) {
    return extra.authInfo.token;
  }

  const authorization = headerValue(extra.requestInfo?.headers, 'authorization');
  const bearer = parseBearerToken(authorization);
  if (bearer) {
    return bearer;
  }

  if (extra.sessionId) {
    const sessionToken = getSessionToken(extra.sessionId);
    if (sessionToken) {
      return sessionToken;
    }
  }

  const envToken = process.env.MCP_AUTH_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  return undefined;
}

/** Bind an auth token to an MCP session (called during initialize). */
export function bindSessionAuth(
  sessionId: string | undefined,
  token: string | undefined,
): void {
  if (sessionId && token) {
    setSessionToken(sessionId, token);
  }
}

export async function resolveTenantForToken(token: string): Promise<TenantResolution> {
  const rows = await adminDb
    .select({ userId: users.id, tenantId: users.tenantId })
    .from(users)
    .where(eq(users.apiToken, token))
    .limit(1);

  if (!rows[0]) {
    return { ok: false, error: 'UNAUTHORIZED' };
  }

  return { ok: true, tenantId: rows[0].tenantId, userId: rows[0].userId };
}

export async function resolveTenantFromRequest(
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
): Promise<TenantResolution> {
  const token = extractAuthToken(extra);
  if (!token) {
    return { ok: false, error: 'UNAUTHORIZED' };
  }
  return resolveTenantForToken(token);
}
