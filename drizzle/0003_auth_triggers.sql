-- Custom migration: updated_at triggers for the Better Auth tables (architecture §8).
-- The function itself was created in 0001_updated_at_triggers.sql.

CREATE TRIGGER session_set_updated_at BEFORE UPDATE ON "session"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER account_set_updated_at BEFORE UPDATE ON "account"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER verification_set_updated_at BEFORE UPDATE ON "verification"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
