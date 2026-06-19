# ai-agent-multitenant

A production-shaped slice of a multi-tenant AI agent backend in TypeScript.

- **Postgres + Drizzle ORM** — `tenants` and `tasks` tables
- **Row-Level Security** — isolation enforced at the database, not in application code
- **MCP server** — `list_tasks` and `get_task` tools exposed over stdio
- **Eval suite** — Vitest tests proving isolation and injection resistance

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
# Edit .env — set ANTHROPIC_API_KEY if you want the model-layer safety eval
```

### 4. Start PostgreSQL

```bash
docker compose up -d
# Postgres listens on localhost:15432 (avoids conflicts with a local install on 5432)
```

### 5. Run the database setup

```bash
npm run db:migrate     # applies Drizzle migrations from migrations/
npm run db:seed        # seeds Tenant A, Tenant B, and 6 tasks
```

### 6. See isolation tests FAIL (before RLS is installed)

```bash
npm test
# Two tests FAIL intentionally:
#   "No tenant context returns ZERO rows" — returns ALL rows instead
#   "Wrong tenant context returns ZERO rows" — returns ALL rows instead
# This proves the isolation guarantee is NOT yet in place.
```

### 7. Install RLS

```bash
npm run db:setup-rls   # enables RLS + creates tasks_tenant_isolation policy
```

### 8. Re-run evals — all tests pass

```bash
npm test
# All tests pass after RLS is installed:
#   14 passed | 1 skipped (15 total)
#   - 6 isolation tests (including the two that previously failed)
#   - 4 safety tests (3 DB-layer + 1 model-layer skipped without API key)
#   - 5 MCP integration tests (real stdio server)
```

---

## Running the MCP server

```bash
# Serve Tenant A
TENANT_NAME=A npm run mcp:serve

# In another terminal — serve Tenant B
TENANT_NAME=B npm run mcp:serve
```

The server resolves the tenant UUID at startup and scopes every tool call to
that tenant. Clients cannot override tenant identity via tool parameters.

---

## Project structure

```
src/
  db/
    schema.ts       — Drizzle schema (tenants, tasks, task_status enum)
    client.ts       — DB pools + withTenantContext() helper
    migrate.ts      — idempotent table creation (postgres superuser)
    setup-rls.ts    — enables RLS + installs tenant isolation policy
    seed.ts         — seeds two tenants + 6 tasks (incl. injection test case)
  mcp/
    server.ts       — MCP stdio server: list_tasks + get_task tools

evals/
  setup.ts          — shared test helpers (adminDb, ground-truth queries)
  mcp-helpers.ts    — spawns real MCP stdio server for integration tests
  isolation.test.ts — 6 RLS isolation tests
  safety.test.ts    — 4 prompt-injection safety tests (1 skipped without API key)
  mcp.test.ts       — 5 MCP server integration tests

migrations/         — Drizzle-generated SQL (source: src/db/schema.ts)

docs/
  TDD_EVIDENCE.md   — red-before-green capture for RLS hard-rule tests

docker/
  init.sql          — creates app_user (non-superuser, RLS enforced)

SPEC.md             — schema, RLS policy, MCP contract, injection test design
docs/TDD_EVIDENCE.md — documented fail-first proof for RLS hard-rule tests
```

---

## How I used Claude Code

I used Claude Code in this session to scaffold the entire project. Things I
verified by hand:

1. **RLS NULL semantics** — confirmed `current_setting('app.current_tenant_id', true)`
   returns `NULL` (not `''`) when the GUC is unset, so the USING clause
   evaluates to `NULL` → row hidden. Tested via `psql` in a fresh session.

2. **`set_config` LOCAL flag** — verified the third arg `true` (is_local) scopes
   the setting to the current transaction, not the session. Critical for
   connection-pool safety — prevents tenant bleed-through on reused connections.

3. **app_user role** — ran `\du` in psql to confirm `app_user` has no `Superuser`
   attribute; superusers bypass RLS entirely by PostgreSQL design.

4. **MCP SDK import paths** — verified `McpServer` and `StdioServerTransport`
   export from `@modelcontextprotocol/sdk/server/mcp.js` and `.../stdio.js`.

5. **NOT_FOUND vs 403** — confirmed the spec intent: when RLS hides a row,
   returning `NOT_FOUND` (not `FORBIDDEN`) prevents the caller from inferring
   whether the row exists at all.
