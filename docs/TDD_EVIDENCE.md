# TDD Evidence — Red Before Green

This document records the intentional fail-first workflow for RLS isolation.
The two hard-rule tests **must fail** before `npm run db:setup-rls` and **pass** after.

## Tests that prove the database is the enforcer

| Test file | Test name | Pre-RLS behaviour | Post-RLS behaviour |
|-----------|-----------|-------------------|---------------------|
| `evals/isolation.test.ts` | `No tenant context returns ZERO rows — FAILS before setup-rls` | Returns **all** rows (RLS off) | Returns **0** rows |
| `evals/isolation.test.ts` | `Wrong tenant context returns ZERO rows — FAILS before setup-rls` | Returns **all** rows (RLS off) | Returns **0** rows |

## Reproduce locally

```bash
# 1. Fresh DB with schema + seed, but NO RLS policy yet
docker compose up -d
npm run db:migrate
npm run db:seed

# 2. Run evals — expect 2 failures
npm test
```

### Captured pre-RLS output (2026-06-19)

```
× evals/isolation.test.ts > RLS — Tenant Isolation > No tenant context returns ZERO rows — FAILS before setup-rls
  → expected [ { …(6) }, { …(6) }, { …(6) }, …(3) ] to have a length of +0 but got 6

× evals/isolation.test.ts > RLS — Tenant Isolation > Wrong tenant context returns ZERO rows — FAILS before setup-rls
  → expected [ { …(6) }, { …(6) }, { …(6) }, …(3) ] to have a length of +0 but got 6

Test Files  1 failed (1)
Tests  2 failed | 4 skipped (6)
```

The failing row count (6) matches the full seeded task set — proof that without RLS,
`app_user` can see every tenant's rows via a raw `SELECT * FROM tasks`.

```bash
# 3. Install RLS
npm run db:setup-rls

# 4. Re-run — all deterministic tests pass
npm test
```

### Captured post-RLS output (2026-06-19)

```
Test Files  3 passed (3)
Tests  14 passed | 1 skipped (15)
```

All isolation, safety (DB-layer), and MCP integration tests pass.
The model-layer Claude test is **skipped** unless `ANTHROPIC_API_KEY` is set.

## Why this matters

Before RLS, `app_user` can `SELECT * FROM tasks` and see every row.
After RLS + `FORCE ROW LEVEL SECURITY`, the same raw query returns zero rows when
`app.current_tenant_id` is unset or wrong — with **no** application `WHERE tenant_id` clause.

That red→green transition is the proof that isolation lives in PostgreSQL, not in TypeScript.
