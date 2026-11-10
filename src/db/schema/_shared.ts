import { timestamp } from "drizzle-orm/pg-core";

// Fresh column builders per table: Drizzle binds a column instance to one table,
// so these must never be shared module-level objects.
export function timestamps() {
  return {
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  };
}

export function createdAtColumn() {
  return timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
}

export function deletedAtColumn() {
  return timestamp("deleted_at", { withTimezone: true });
}
