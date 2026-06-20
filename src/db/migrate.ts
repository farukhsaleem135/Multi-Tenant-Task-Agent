/**
 * migrate.ts — applies Drizzle-generated SQL migrations (postgres superuser).
 *
 * Schema source of truth: src/db/schema.ts
 * Generated SQL:          migrations/  (via `npm run db:generate`)
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { adminPool } from './client.js';

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../migrations',
);

async function runMigrate() {
  const db = drizzle(adminPool);
  await migrate(db, { migrationsFolder });
  await adminPool.end();
  console.log('✓ Drizzle migration complete — tenants, users, and tasks tables ready.');
}

runMigrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
