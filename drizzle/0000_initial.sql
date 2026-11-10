CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_entity_type_check" CHECK ("activities"."entity_type" in ('workspace', 'company', 'contact', 'campaign', 'prospect', 'icp', 'qualification', 'draft'))
);
--> statement-breakpoint
CREATE TABLE "business_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"industry" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"icp_id" uuid,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"start_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "campaigns_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "campaigns_status_check" CHECK ("campaigns"."status" in ('draft', 'active', 'paused', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "icps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"criteria" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "icps_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "icps_status_check" CHECK ("icps"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "outreach_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"model" text,
	"prompt_version" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_drafts_campaign_contact_channel_version_unique" UNIQUE("campaign_id","contact_id","channel","version"),
	CONSTRAINT "outreach_drafts_channel_check" CHECK ("outreach_drafts"."channel" in ('email', 'linkedin')),
	CONSTRAINT "outreach_drafts_status_check" CHECK ("outreach_drafts"."status" in ('draft', 'approved', 'exported', 'discarded')),
	CONSTRAINT "outreach_drafts_version_check" CHECK ("outreach_drafts"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "campaign_prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_prospects_workspace_campaign_company_unique" UNIQUE("workspace_id","campaign_id","company_id"),
	CONSTRAINT "campaign_prospects_status_check" CHECK ("campaign_prospects"."status" in ('new', 'researching', 'qualified', 'drafted', 'archived', 'disqualified'))
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"website" text,
	"industry" text,
	"employee_count" integer,
	"country" text,
	"description" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "companies_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "companies_employee_count_check" CHECK ("companies"."employee_count" is null or "companies"."employee_count" >= 0),
	CONSTRAINT "companies_source_check" CHECK ("companies"."source" in ('manual', 'discovery', 'import'))
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"title" text,
	"email" text,
	"linkedin_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "contacts_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "contacts_workspace_company_id_unique" UNIQUE("workspace_id","company_id","id")
);
--> statement-breakpoint
CREATE TABLE "qualifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"icp_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"band" text,
	"summary" text NOT NULL,
	"breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"prompt_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qualifications_workspace_company_icp_revision_unique" UNIQUE("workspace_id","company_id","icp_id","revision"),
	CONSTRAINT "qualifications_revision_check" CHECK ("qualifications"."revision" >= 1),
	CONSTRAINT "qualifications_score_check" CHECK ("qualifications"."score" >= 0 and "qualifications"."score" <= 100),
	CONSTRAINT "qualifications_band_check" CHECK ("qualifications"."band" is null or "qualifications"."band" in ('hot', 'warm', 'cold', 'disqualified'))
);
--> statement-breakpoint
CREATE TABLE "research_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"source_id" uuid,
	"field" text NOT NULL,
	"statement" text NOT NULL,
	"value" jsonb,
	"provenance" text NOT NULL,
	"confidence" numeric(3, 2),
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_findings_provenance_check" CHECK ("research_findings"."provenance" in ('verified', 'inferred')),
	CONSTRAINT "research_findings_confidence_check" CHECK ("research_findings"."confidence" is null or ("research_findings"."confidence" >= 0 and "research_findings"."confidence" <= 1)),
	CONSTRAINT "research_findings_verified_source_check" CHECK ("research_findings"."provenance" <> 'verified' or "research_findings"."source_id" is not null),
	CONSTRAINT "research_findings_inferred_model_check" CHECK ("research_findings"."provenance" <> 'inferred' or "research_findings"."model" is not null)
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"contact_id" uuid,
	"url" text NOT NULL,
	"title" text,
	"publisher" text,
	"source_type" text NOT NULL,
	"retrieved_at" timestamp with time zone NOT NULL,
	"content_hash" text,
	"excerpt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_sources_workspace_id_unique" UNIQUE("workspace_id","id"),
	CONSTRAINT "research_sources_source_type_check" CHECK ("research_sources"."source_type" in ('website', 'linkedin', 'news', 'filing', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_user_unique" UNIQUE("workspace_id","user_id"),
	CONSTRAINT "workspace_members_role_check" CHECK ("workspace_members"."role" in ('owner', 'admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workspaces_slug_lowercase_check" CHECK (char_length("workspaces"."slug") > 0 and "workspaces"."slug" = lower("workspaces"."slug"))
);
--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Hand-edited: Drizzle cannot emit a column list on composite SET NULL.
-- Nulls only icp_id; a bare SET NULL would violate workspace_id NOT NULL.
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_icp_fk" FOREIGN KEY ("workspace_id","icp_id") REFERENCES "public"."icps"("workspace_id","id") ON DELETE SET NULL ("icp_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "icps" ADD CONSTRAINT "icps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_prospect_fk" FOREIGN KEY ("workspace_id","campaign_id","company_id") REFERENCES "public"."campaign_prospects"("workspace_id","campaign_id","company_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_contact_fk" FOREIGN KEY ("workspace_id","company_id","contact_id") REFERENCES "public"."contacts"("workspace_id","company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_prospects" ADD CONSTRAINT "campaign_prospects_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_icp_fk" FOREIGN KEY ("workspace_id","icp_id") REFERENCES "public"."icps"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_contact_fk" FOREIGN KEY ("workspace_id","company_id","contact_id") REFERENCES "public"."contacts"("workspace_id","company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Hand-edited: Drizzle cannot emit a column list on composite SET NULL.
-- Nulls only source_id; a bare SET NULL would violate workspace_id NOT NULL.
ALTER TABLE "research_findings" ADD CONSTRAINT "research_findings_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."research_sources"("workspace_id","id") ON DELETE SET NULL ("source_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_company_fk" FOREIGN KEY ("workspace_id","company_id") REFERENCES "public"."companies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_sources" ADD CONSTRAINT "research_sources_contact_fk" FOREIGN KEY ("workspace_id","company_id","contact_id") REFERENCES "public"."contacts"("workspace_id","company_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_workspace_created_at_idx" ON "activities" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activities_entity_idx" ON "activities" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "business_profiles_workspace_live_unique" ON "business_profiles" USING btree ("workspace_id") WHERE "business_profiles"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "outreach_drafts_workspace_campaign_company_idx" ON "outreach_drafts" USING btree ("workspace_id","campaign_id","company_id");--> statement-breakpoint
CREATE INDEX "outreach_drafts_workspace_company_contact_idx" ON "outreach_drafts" USING btree ("workspace_id","company_id","contact_id");--> statement-breakpoint
CREATE INDEX "outreach_drafts_workspace_status_idx" ON "outreach_drafts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "campaign_prospects_workspace_status_idx" ON "campaign_prospects" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "campaign_prospects_workspace_company_idx" ON "campaign_prospects" USING btree ("workspace_id","company_id");--> statement-breakpoint
CREATE INDEX "campaign_prospects_campaign_status_idx" ON "campaign_prospects" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_workspace_domain_unique" ON "companies" USING btree ("workspace_id",lower("domain")) WHERE "companies"."domain" is not null and "companies"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "companies_workspace_created_at_idx" ON "companies" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_workspace_company_email_unique" ON "contacts" USING btree ("workspace_id","company_id",lower("email")) WHERE "contacts"."email" is not null and "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "contacts_workspace_company_idx" ON "contacts" USING btree ("workspace_id","company_id");--> statement-breakpoint
CREATE INDEX "contacts_workspace_email_idx" ON "contacts" USING btree ("workspace_id","email");--> statement-breakpoint
CREATE INDEX "qualifications_workspace_icp_revision_idx" ON "qualifications" USING btree ("workspace_id","icp_id","revision" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "research_findings_workspace_company_field_created_idx" ON "research_findings" USING btree ("workspace_id","company_id","field","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "research_sources_workspace_company_retrieved_idx" ON "research_sources" USING btree ("workspace_id","company_id","retrieved_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_one_owner_unique" ON "workspace_members" USING btree ("workspace_id") WHERE "workspace_members"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "workspace_members_user_id_idx" ON "workspace_members" USING btree ("user_id");