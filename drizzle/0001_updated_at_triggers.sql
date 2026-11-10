-- Custom migration: shared updated_at trigger (architecture §8).
-- Drizzle cannot express triggers in the schema, so this is hand-written.
-- Drizzle-kit applies each statement itself; the breakpoint markers keep the
-- file consistent with generated migrations.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER workspaces_set_updated_at BEFORE UPDATE ON "workspaces"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER workspace_members_set_updated_at BEFORE UPDATE ON "workspace_members"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER business_profiles_set_updated_at BEFORE UPDATE ON "business_profiles"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER icps_set_updated_at BEFORE UPDATE ON "icps"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER campaigns_set_updated_at BEFORE UPDATE ON "campaigns"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER companies_set_updated_at BEFORE UPDATE ON "companies"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER contacts_set_updated_at BEFORE UPDATE ON "contacts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER campaign_prospects_set_updated_at BEFORE UPDATE ON "campaign_prospects"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER outreach_drafts_set_updated_at BEFORE UPDATE ON "outreach_drafts"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
