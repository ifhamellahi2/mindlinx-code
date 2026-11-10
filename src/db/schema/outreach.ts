import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { campaignProspects, contacts } from "./prospects";
import { users, workspaces } from "./tenancy";

export const outreachDrafts = pgTable(
  "outreach_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull(),
    companyId: uuid("company_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    channel: text("channel").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status").notNull(),
    version: integer("version").notNull().default(1),
    model: text("model"),
    promptVersion: text("prompt_version"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (table) => [
    unique("outreach_drafts_campaign_contact_channel_version_unique").on(
      table.campaignId,
      table.contactId,
      table.channel,
      table.version,
    ),
    index("outreach_drafts_workspace_campaign_company_idx").on(
      table.workspaceId,
      table.campaignId,
      table.companyId,
    ),
    index("outreach_drafts_workspace_company_contact_idx").on(
      table.workspaceId,
      table.companyId,
      table.contactId,
    ),
    index("outreach_drafts_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    // The company must be a member of the campaign, in the same workspace.
    foreignKey({
      name: "outreach_drafts_prospect_fk",
      columns: [table.workspaceId, table.campaignId, table.companyId],
      foreignColumns: [
        campaignProspects.workspaceId,
        campaignProspects.campaignId,
        campaignProspects.companyId,
      ],
    }).onDelete("restrict"),
    // The contact must belong to that same company and workspace.
    foreignKey({
      name: "outreach_drafts_contact_fk",
      columns: [table.workspaceId, table.companyId, table.contactId],
      foreignColumns: [
        contacts.workspaceId,
        contacts.companyId,
        contacts.id,
      ],
    }).onDelete("restrict"),
    check(
      "outreach_drafts_channel_check",
      sql`${table.channel} in ('email', 'linkedin')`,
    ),
    check(
      "outreach_drafts_status_check",
      sql`${table.status} in ('draft', 'approved', 'exported', 'discarded')`,
    ),
    check("outreach_drafts_version_check", sql`${table.version} >= 1`),
  ],
);
