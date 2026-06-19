import { pgTable, pgEnum, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const taskStatus = pgEnum('task_status', ['pending', 'in_progress', 'done']);

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  status: taskStatus('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
