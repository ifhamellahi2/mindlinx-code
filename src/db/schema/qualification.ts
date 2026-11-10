import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn } from "./_shared";
import { icps } from "./business";
import { companies } from "./prospects";
import { workspaces } from "./tenancy";

export const qualifications = pgTable(
  "qualifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull(),
    icpId: uuid("icp_id").notNull(),
    revision: integer("revision").notNull(),
    score: numeric("score", { precision: 5, scale: 2 }).notNull(),
    band: text("band"),
    summary: text("summary").notNull(),
    breakdown: jsonb("breakdown").notNull().default(sql`'[]'::jsonb`),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    // Append-only identity; "current" is the highest revision per company + ICP.
    unique("qualifications_workspace_company_icp_revision_unique").on(
      table.workspaceId,
      table.companyId,
      table.icpId,
      table.revision,
    ),
    index("qualifications_workspace_icp_revision_idx").on(
      table.workspaceId,
      table.icpId,
      table.revision.desc(),
    ),
    foreignKey({
      name: "qualifications_company_fk",
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [companies.workspaceId, companies.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "qualifications_icp_fk",
      columns: [table.workspaceId, table.icpId],
      foreignColumns: [icps.workspaceId, icps.id],
    }).onDelete("restrict"),
    check("qualifications_revision_check", sql`${table.revision} >= 1`),
    check(
      "qualifications_score_check",
      sql`${table.score} >= 0 and ${table.score} <= 100`,
    ),
    check(
      "qualifications_band_check",
      sql`${table.band} is null or ${table.band} in ('hot', 'warm', 'cold', 'disqualified')`,
    ),
  ],
);
