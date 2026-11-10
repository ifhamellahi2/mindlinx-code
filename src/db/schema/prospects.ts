import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { deletedAtColumn, timestamps } from "./_shared";
import { campaigns } from "./business";
import { workspaces } from "./tenancy";

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain"),
    website: text("website"),
    industry: text("industry"),
    employeeCount: integer("employee_count"),
    country: text("country"),
    description: text("description"),
    source: text("source").notNull(),
    ...timestamps(),
    deletedAt: deletedAtColumn(),
  },
  (table) => [
    // Composite-FK target for contacts, campaign_prospects and research.
    unique("companies_workspace_id_unique").on(table.workspaceId, table.id),
    uniqueIndex("companies_workspace_domain_unique")
      .on(table.workspaceId, sql`lower(${table.domain})`)
      .where(sql`${table.domain} is not null and ${table.deletedAt} is null`),
    index("companies_workspace_created_at_idx").on(
      table.workspaceId,
      table.createdAt.desc(),
    ),
    check(
      "companies_employee_count_check",
      sql`${table.employeeCount} is null or ${table.employeeCount} >= 0`,
    ),
    check(
      "companies_source_check",
      sql`${table.source} in ('manual', 'discovery', 'import')`,
    ),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    title: text("title"),
    email: text("email"),
    linkedinUrl: text("linkedin_url"),
    ...timestamps(),
    deletedAt: deletedAtColumn(),
  },
  (table) => [
    unique("contacts_workspace_id_unique").on(table.workspaceId, table.id),
    // Lets drafts and research prove a contact belongs to the same company.
    unique("contacts_workspace_company_id_unique").on(
      table.workspaceId,
      table.companyId,
      table.id,
    ),
    uniqueIndex("contacts_workspace_company_email_unique")
      .on(table.workspaceId, table.companyId, sql`lower(${table.email})`)
      .where(sql`${table.email} is not null and ${table.deletedAt} is null`),
    index("contacts_workspace_company_idx").on(
      table.workspaceId,
      table.companyId,
    ),
    index("contacts_workspace_email_idx").on(table.workspaceId, table.email),
    foreignKey({
      name: "contacts_company_fk",
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [companies.workspaceId, companies.id],
    }).onDelete("restrict"),
  ],
);

export const campaignProspects = pgTable(
  "campaign_prospects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull(),
    companyId: uuid("company_id").notNull(),
    status: text("status").notNull(),
    ...timestamps(),
  },
  (table) => [
    // Membership identity and composite-FK target for outreach_drafts.
    unique("campaign_prospects_workspace_campaign_company_unique").on(
      table.workspaceId,
      table.campaignId,
      table.companyId,
    ),
    index("campaign_prospects_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    index("campaign_prospects_workspace_company_idx").on(
      table.workspaceId,
      table.companyId,
    ),
    index("campaign_prospects_campaign_status_idx").on(
      table.campaignId,
      table.status,
    ),
    foreignKey({
      name: "campaign_prospects_campaign_fk",
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "campaign_prospects_company_fk",
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [companies.workspaceId, companies.id],
    }).onDelete("restrict"),
    check(
      "campaign_prospects_status_check",
      sql`${table.status} in ('new', 'researching', 'qualified', 'drafted', 'archived', 'disqualified')`,
    ),
  ],
);
