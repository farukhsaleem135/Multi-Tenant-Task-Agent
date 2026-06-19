import { defineConfig } from 'drizzle-kit';
import 'dotenv/config';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Uses the admin (superuser) connection for schema introspection and generation.
    // Never use DATABASE_URL (app_user) here — drizzle-kit needs DDL privileges.
    url: process.env.DATABASE_URL_ADMIN!,
  },
});
