# ai-agent-multitenant

A production-shaped slice of a multi-tenant AI agent backend in TypeScript.

- **Postgres + Drizzle ORM** — `tenants`, `users`, and `tasks` tables
- **Row-Level Security** — isolation enforced at the database, not in application code
- **MCP server** — `list_tasks` and `get_task` tools; one server serves all tenants
- **Per-user auth** — bearer token → user → tenant on every tool call
- **Eval suite** — Vitest tests proving isolation, auth, and injection resistance

---

## Quick start

### 1. Prerequisites

- Docker Desktop
- Node.js 20+
- (Optional) An Anthropic API key for the model-layer safety eval

### 2. Clone and install

```bash
git clone <repo-url>
cd ai-agent-multitenant
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Optional: set ANTHROPIC_API_KEY for the model-layer safety eval
# Optional: set MCP_AUTH_TOKEN when running the MCP server locally (see below)
```

### 4. Start PostgreSQL

```bash
docker compose up -d
# Postgres listens on localhost:15432 (avoids conflicts with a local install on 5432)
```

### 5. Run the database setup

```bash
npm run db:migrate     # applies Drizzle migrations (tenants, users, tasks)
npm run db:seed        # seeds Tenant A, Tenant B, 2 users, and 6 tasks
```

Or run the full pipeline in one command:

```bash
npm run db:setup       # migrate + setup-rls + seed
```

### 6. See isolation tests FAIL (before RLS is installed)

Skip `db:setup-rls` first, then:

```bash
npm test
# Two tests FAIL intentionally:
#   "No tenant context returns ZERO rows" — returns ALL rows instead
#   "Wrong tenant context returns ZERO rows" — returns ALL rows instead
# This proves the isolation guarantee is NOT yet in place.
```

See `docs/TDD_EVIDENCE.md` for captured red→green output.

### 7. Install RLS

```bash
npm run db:setup-rls   # enables RLS + creates tasks_tenant_isolation policy
```

### 8. Re-run evals — all tests pass

```bash
npm test
# Expected after RLS is installed:
#   16 passed | 1 skipped (17 total)
#   - 6 isolation tests (including the two that previously failed)
#   - 4 safety tests (3 DB-layer + 1 model-layer skipped without API key)
#   - 7 MCP integration tests (auth, isolation, same server for all tenants)
```

---

## Running the MCP server

One server instance serves **all tenants**. On every tool call the server:

1. Reads the caller's bearer token
2. Looks up the user in the `users` table
3. Resolves their tenant internally
4. Queries tasks through RLS (`withTenantContext`)

Clients never pass `tenant_id` in tool arguments.

### Local dev (stdio)

Stdio MCP has no HTTP headers, so local runs use `MCP_AUTH_TOKEN` as a stand-in for `Authorization: Bearer …`:

```bash
# Alice → Tenant A
MCP_AUTH_TOKEN=dev-token-alice-tenant-a npm run mcp:serve

# Bob → Tenant B (same server binary, different user token)
MCP_AUTH_TOKEN=dev-token-bob-tenant-b npm run mcp:serve
```

### Production (HTTP MCP)

The host passes the logged-in user's token on each request:

```http
Authorization: Bearer <user-api-token>
```

The server checks OAuth `authInfo` or the `Authorization` header first; `MCP_AUTH_TOKEN` is only a stdio dev fallback.

### Seeded demo tokens

| User  | Tenant | Token                      |
|-------|--------|----------------------------|
| alice | A      | `dev-token-alice-tenant-a` |
| bob   | B      | `dev-token-bob-tenant-b`   |

---

## Project structure

```
src/
  auth/
    resolve-tenant.ts — bearer token → user → tenant (per request)
    session-store.ts  — optional session-bound token cache
  db/
    schema.ts         — Drizzle schema (tenants, users, tasks)
    client.ts         — DB pools + withTenantContext() helper
    migrate.ts        — applies Drizzle migrations (postgres superuser)
    setup-rls.ts      — enables RLS + installs tenant isolation policy
    seed.ts           — seeds tenants, users, tasks (incl. injection case)
    seed-tokens.ts    — stable API tokens for seeded users (used by evals)
  mcp/
    server.ts         — MCP stdio server: list_tasks + get_task

evals/
  setup.ts            — shared test helpers (adminDb, ground-truth queries)
  mcp-helpers.ts      — spawns real MCP stdio server for integration tests
  isolation.test.ts   — 6 RLS isolation tests
  safety.test.ts      — 4 prompt-injection safety tests (1 skipped without API key)
  mcp.test.ts         — 7 MCP server integration tests

migrations/           — Drizzle-generated SQL (source: src/db/schema.ts)

docs/
  TDD_EVIDENCE.md     — red-before-green capture for RLS hard-rule tests

docker/
  init.sql            — creates app_user (non-superuser, RLS enforced)

SPEC.md               — schema, RLS policy, auth flow, MCP contract, injection design
```

---

## How I used AI coding tools (Cursor / Claude Code)

I used Cursor and Claude Code to scaffold and iterate on this project. Things I verified by hand:

1. **RLS NULL semantics** — confirmed `current_setting('app.current_tenant_id', true)` returns `NULL` (not `''`) when the GUC is unset, so the USING clause evaluates to `NULL` → row hidden. Tested via `psql`.

2. **`set_config` LOCAL flag** — verified the third arg `true` (is_local) scopes the setting to the current transaction, not the session. Critical for connection-pool safety.

3. **app_user role** — ran `\du` in psql to confirm `app_user` has no `Superuser` attribute; superusers bypass RLS by PostgreSQL design.

4. **User → tenant auth flow** — confirmed tenant is resolved from `users.api_token` on each MCP tool call, not from a startup env var or tool argument.

5. **MCP SDK import paths** — verified `McpServer` and `StdioServerTransport` export paths in `@modelcontextprotocol/sdk`.

6. **NOT_FOUND vs 403** — when RLS hides a row, returning `NOT_FOUND` (not `FORBIDDEN`) prevents the caller from inferring whether the row exists.

7. **Bearer vs stdio auth** — production path uses `Authorization: Bearer`; stdio evals use `MCP_AUTH_TOKEN` because stdio has no HTTP headers. Same token lookup logic either way.
