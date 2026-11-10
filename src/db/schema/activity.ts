import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn } from "./_shared";
import { users, workspaces } from "./tenancy";

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("activities_workspace_created_at_idx").on(
      table.workspaceId,
      table.createdAt.desc(),
    ),
    index("activities_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt.desc(),
    ),
    check(
      "activities_entity_type_check",
      sql`${table.entityType} in ('workspace', 'company', 'contact', 'campaign', 'prospect', 'icp', 'qualification', 'draft')`,
    ),
  ],
);
