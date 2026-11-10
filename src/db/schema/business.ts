import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deletedAtColumn, timestamps } from "./_shared";
import { users, workspaces } from "./tenancy";

export const businessProfiles = pgTable(
  "business_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    website: text("website"),
    industry: text("industry"),
    description: text("description"),
    ...timestamps(),
    deletedAt: deletedAtColumn(),
  },
  (table) => [
    // One live profile per workspace; a soft-deleted one can be replaced.
    uniqueIndex("business_profiles_workspace_live_unique")
      .on(table.workspaceId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const icps = pgTable(
  "icps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    criteria: jsonb("criteria").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull(),
    ...timestamps(),
    deletedAt: deletedAtColumn(),
  },
  (table) => [
    // Composite-FK target for campaigns and qualifications.
    unique("icps_workspace_id_unique").on(table.workspaceId, table.id),
    check(
      "icps_status_check",
      sql`${table.status} in ('active', 'archived')`,
    ),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    icpId: uuid("icp_id"),
    name: text("name").notNull(),
    status: text("status").notNull(),
    startDate: date("start_date"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
    deletedAt: deletedAtColumn(),
  },
  (table) => [
    // Composite-FK target for campaign_prospects.
    unique("campaigns_workspace_id_unique").on(table.workspaceId, table.id),
    // A campaign can only point at an ICP in its own workspace.
    // NOTE: Drizzle cannot emit `ON DELETE SET NULL (icp_id)`; the generated
    // migration must be hand-edited. A bare SET NULL would try to null
    // workspace_id and fail.
    foreignKey({
      name: "campaigns_icp_fk",
      columns: [table.workspaceId, table.icpId],
      foreignColumns: [icps.workspaceId, icps.id],
    }).onDelete("set null"),
    check(
      "campaigns_status_check",
      sql`${table.status} in ('draft', 'active', 'paused', 'archived')`,
    ),
  ],
);
