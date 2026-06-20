/** In-memory map of MCP session ID → validated API token. */
const sessionTokens = new Map<string, string>();

export function setSessionToken(sessionId: string, token: string): void {
  sessionTokens.set(sessionId, token);
}

export function getSessionToken(sessionId: string): string | undefined {
  return sessionTokens.get(sessionId);
}

export function clearSessionToken(sessionId: string): void {
  sessionTokens.delete(sessionId);
}
