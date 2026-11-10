import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn } from "./_shared";
import { companies, contacts } from "./prospects";
import { workspaces } from "./tenancy";

export const researchSources = pgTable(
  "research_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull(),
    contactId: uuid("contact_id"),
    url: text("url").notNull(),
    title: text("title"),
    publisher: text("publisher"),
    sourceType: text("source_type").notNull(),
    retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
    contentHash: text("content_hash"),
    excerpt: text("excerpt"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    // Composite-FK target for research_findings.source_id.
    unique("research_sources_workspace_id_unique").on(
      table.workspaceId,
      table.id,
    ),
    index("research_sources_workspace_company_retrieved_idx").on(
      table.workspaceId,
      table.companyId,
      table.retrievedAt.desc(),
    ),
    foreignKey({
      name: "research_sources_company_fk",
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [companies.workspaceId, companies.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "research_sources_contact_fk",
      columns: [table.workspaceId, table.companyId, table.contactId],
      foreignColumns: [
        contacts.workspaceId,
        contacts.companyId,
        contacts.id,
      ],
    }).onDelete("restrict"),
    check(
      "research_sources_source_type_check",
      sql`${table.sourceType} in ('website', 'linkedin', 'news', 'filing', 'manual')`,
    ),
  ],
);

export const researchFindings = pgTable(
  "research_findings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull(),
    contactId: uuid("contact_id"),
    sourceId: uuid("source_id"),
    field: text("field").notNull(),
    statement: text("statement").notNull(),
    value: jsonb("value"),
    provenance: text("provenance").notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 }),
    model: text("model"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    index("research_findings_workspace_company_field_created_idx").on(
      table.workspaceId,
      table.companyId,
      table.field,
      table.createdAt.desc(),
    ),
    foreignKey({
      name: "research_findings_company_fk",
      columns: [table.workspaceId, table.companyId],
      foreignColumns: [companies.workspaceId, companies.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "research_findings_contact_fk",
      columns: [table.workspaceId, table.companyId, table.contactId],
      foreignColumns: [
        contacts.workspaceId,
        contacts.companyId,
        contacts.id,
      ],
    }).onDelete("restrict"),
    // NOTE: Drizzle cannot emit `ON DELETE SET NULL (source_id)`; the
    // generated migration must be hand-edited for the same reason as
    // campaigns.icp_id.
    foreignKey({
      name: "research_findings_source_fk",
      columns: [table.workspaceId, table.sourceId],
      foreignColumns: [researchSources.workspaceId, researchSources.id],
    }).onDelete("set null"),
    check(
      "research_findings_provenance_check",
      sql`${table.provenance} in ('verified', 'inferred')`,
    ),
    check(
      "research_findings_confidence_check",
      sql`${table.confidence} is null or (${table.confidence} >= 0 and ${table.confidence} <= 1)`,
    ),
    check(
      "research_findings_verified_source_check",
      sql`${table.provenance} <> 'verified' or ${table.sourceId} is not null`,
    ),
    check(
      "research_findings_inferred_model_check",
      sql`${table.provenance} <> 'inferred' or ${table.model} is not null`,
    ),
  ],
);
