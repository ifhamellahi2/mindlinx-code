-- Structural + behavioural verification for the MindLinx initial migration.
-- Run against a disposable database only:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db-verify.sql
-- Every check raises an exception on failure, so a non-zero exit means the
-- migration no longer matches docs/database-architecture.md.

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.expect_fail(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'PASS rejected: %', label;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL accepted but should reject: %', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'FAIL rejected but should accept: % (%)', label, SQLERRM;
  END;
  RAISE NOTICE 'PASS accepted: %', label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(label text, cond boolean) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL assertion: %', label;
  END IF;
  RAISE NOTICE 'PASS assertion: %', label;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE expected text[] := ARRAY[
  'users','workspaces','workspace_members','business_profiles','icps',
  'campaigns','companies','contacts','campaign_prospects','research_sources',
  'research_findings','qualifications','outreach_drafts','activities',
  'session','account','verification'];
DECLARE actual text[];
BEGIN
  SELECT array_agg(tablename::text ORDER BY tablename) INTO actual
  FROM pg_tables WHERE schemaname = 'public';
  IF actual IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(expected) x) THEN
    RAISE EXCEPTION 'FAIL table set. expected %, got %', expected, actual;
  END IF;
  RAISE NOTICE 'PASS 17 tables present';
END $$;

-- ---------------------------------------------------------------------------
-- 2. Foreign keys: count, composite shape, delete actions
-- ---------------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace s ON s.oid = t.relnamespace
  WHERE c.contype = 'f' AND s.nspname = 'public';
  IF n <> 33 THEN RAISE EXCEPTION 'FAIL expected 33 FKs, got %', n; END IF;
  RAISE NOTICE 'PASS 33 foreign keys present';
END $$;

DO $$
DECLARE r record;
BEGIN
  -- confdelsetcols holds attnums of the referencing table; resolve to names.
  SELECT c.confdeltype AS del,
         (SELECT array_agg(a.attname::text ORDER BY a.attname)
            FROM unnest(c.confdelsetcols) k
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) AS setcols
  INTO r FROM pg_constraint c
  WHERE c.conname = 'campaigns_icp_fk';
  IF r.del <> 'n' THEN RAISE EXCEPTION 'FAIL campaigns_icp_fk is not SET NULL'; END IF;
  IF r.setcols IS DISTINCT FROM ARRAY['icp_id']::text[] THEN
    RAISE EXCEPTION 'FAIL campaigns_icp_fk has no column-scoped SET NULL (got %)', r.setcols;
  END IF;
  RAISE NOTICE 'PASS campaigns_icp_fk = ON DELETE SET NULL (icp_id)';

  SELECT c.confdeltype AS del,
         (SELECT array_agg(a.attname::text ORDER BY a.attname)
            FROM unnest(c.confdelsetcols) k
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k) AS setcols
  INTO r FROM pg_constraint c
  WHERE c.conname = 'research_findings_source_fk';
  IF r.del <> 'n' THEN RAISE EXCEPTION 'FAIL research_findings_source_fk is not SET NULL'; END IF;
  IF r.setcols IS DISTINCT FROM ARRAY['source_id']::text[] THEN
    RAISE EXCEPTION 'FAIL research_findings_source_fk has no column-scoped SET NULL (got %)', r.setcols;
  END IF;
  RAISE NOTICE 'PASS research_findings_source_fk = ON DELETE SET NULL (source_id)';

  -- A deleted user must not block on the workspace they originally owned.
  SELECT c.confdeltype AS del INTO r FROM pg_constraint c
  WHERE c.conname = 'workspaces_initial_for_user_id_users_id_fk';
  IF r.del IS DISTINCT FROM 'n' THEN
    RAISE EXCEPTION 'FAIL workspaces_initial_for_user_id_users_id_fk is not SET NULL';
  END IF;
  RAISE NOTICE 'PASS workspaces_initial_for_user_id_users_id_fk = ON DELETE SET NULL';
END $$;

-- The initial-workspace marker must be unique only among non-NULL rows, so
-- ordinary workspaces are unaffected.
DO $$
DECLARE pred text;
BEGIN
  SELECT pg_get_expr(i.indpred, i.indrelid) INTO pred
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  WHERE c.relname = 'workspaces_initial_for_user_unique';
  IF pred IS NULL OR pred NOT ILIKE '%initial_for_user_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'FAIL workspaces_initial_for_user_unique is not partial (got %)', pred;
  END IF;
  RAISE NOTICE 'PASS workspaces_initial_for_user_unique is partial';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Indexes and CHECK constraints
-- ---------------------------------------------------------------------------
DO $$
DECLARE expected text[] := ARRAY[
  'activities_workspace_created_at_idx','activities_entity_idx',
  'business_profiles_workspace_live_unique',
  'outreach_drafts_workspace_campaign_company_idx',
  'outreach_drafts_workspace_company_contact_idx',
  'outreach_drafts_workspace_status_idx',
  'campaign_prospects_workspace_status_idx',
  'campaign_prospects_workspace_company_idx',
  'campaign_prospects_campaign_status_idx',
  'companies_workspace_domain_unique','companies_workspace_created_at_idx',
  'contacts_workspace_company_email_unique','contacts_workspace_company_idx',
  'contacts_workspace_email_idx',
  'qualifications_workspace_icp_revision_idx',
  'research_findings_workspace_company_field_created_idx',
  'research_sources_workspace_company_retrieved_idx',
  'workspace_members_one_owner_unique','workspace_members_user_id_idx',
  'workspaces_initial_for_user_unique',
  'users_email_lower_unique',
  'session_token_unique','session_user_id_idx',
  'account_provider_account_unique','account_user_id_idx',
  'verification_identifier_idx'];
DECLARE actual text[];
BEGIN
  SELECT array_agg(indexname::text ORDER BY indexname) INTO actual
  FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY(expected);
  IF actual IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(expected) x) THEN
    RAISE EXCEPTION 'FAIL index set. missing %', expected;
  END IF;
  RAISE NOTICE 'PASS 26 named indexes present';
END $$;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace s ON s.oid = t.relnamespace
  WHERE c.contype = 'c' AND s.nspname = 'public';
  IF n <> 19 THEN RAISE EXCEPTION 'FAIL expected 19 CHECKs, got %', n; END IF;
  RAISE NOTICE 'PASS 19 CHECK constraints present';
END $$;

-- ---------------------------------------------------------------------------
-- 4. Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO users (id, email, name) VALUES
  ('00000000-0000-4000-8000-000000000001', 'owner@example.com', 'Owner'),
  ('00000000-0000-4000-8000-000000000002', 'member@example.com', 'Member');

INSERT INTO session (id, expires_at, token, user_id, updated_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', now() + interval '7 days', 'token-owner',
   '00000000-0000-4000-8000-000000000001', '2000-01-01T00:00:00Z');

INSERT INTO account (id, account_id, provider_id, user_id, password) VALUES
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001',
   'credential', '00000000-0000-4000-8000-000000000001', 'scrypt-hash');

INSERT INTO workspaces (id, name, slug, created_by) VALUES
  ('10000000-0000-4000-8000-000000000001', 'Workspace One', 'ws-one', '00000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002', 'Workspace Two', 'ws-two', '00000000-0000-4000-8000-000000000001');

INSERT INTO icps (id, workspace_id, name, status) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'ICP One', 'active'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'ICP Two', 'active'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'ICP Three', 'active');

INSERT INTO campaigns (id, workspace_id, icp_id, name, status) VALUES
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Campaign One', 'active'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Campaign Two', 'active'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000003', 'Campaign Three', 'draft');

INSERT INTO companies (id, workspace_id, name, domain, source) VALUES
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Acme', 'Acme.com', 'manual'),
  ('40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'Beta', 'beta.com', 'manual'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'Gamma', 'gamma.com', 'manual');

INSERT INTO contacts (id, workspace_id, company_id, first_name, email) VALUES
  ('50000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Ada', 'A@Example.com'),
  ('50000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'Bob', 'b@example.com'),
  ('50000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000003', 'Cleo', 'c@example.com');

INSERT INTO campaign_prospects (id, workspace_id, campaign_id, company_id, status) VALUES
  ('60000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'new'),
  ('60000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'new');

INSERT INTO research_sources (id, workspace_id, company_id, contact_id, url, source_type, retrieved_at) VALUES
  ('70000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'https://acme.test/about', 'website', now());

INSERT INTO research_findings (id, workspace_id, company_id, contact_id, source_id, field, statement, provenance, model) VALUES
  ('80000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', 'industry', 'Acme makes anvils', 'inferred', 'test-model');

INSERT INTO qualifications (id, workspace_id, company_id, icp_id, revision, score, summary) VALUES
  ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1, 80, 'fits');

INSERT INTO outreach_drafts (id, workspace_id, campaign_id, company_id, contact_id, channel, body, status, version) VALUES
  ('a0000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'email', 'hello', 'draft', 1);

INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'owner');

-- ---------------------------------------------------------------------------
-- 5. Cross-workspace references are rejected
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_fail('contact -> company in another workspace',
  $$INSERT INTO contacts (workspace_id, company_id, email) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','x@x.test')$$);

SELECT pg_temp.expect_fail('campaign_prospect -> campaign in another workspace',
  $$INSERT INTO campaign_prospects (workspace_id, campaign_id, company_id, status) VALUES
    ('10000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','new')$$);

SELECT pg_temp.expect_fail('qualification -> ICP in another workspace',
  $$INSERT INTO qualifications (workspace_id, company_id, icp_id, revision, score, summary) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',2,50,'x')$$);

SELECT pg_temp.expect_fail('draft -> prospect in another workspace',
  $$INSERT INTO outreach_drafts (workspace_id, campaign_id, company_id, contact_id, channel, body, status, version) VALUES
    ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002','50000000-0000-4000-8000-000000000002','email','x','draft',1)$$);

SELECT pg_temp.expect_fail('finding -> contact from another workspace',
  $$INSERT INTO research_findings (workspace_id, company_id, contact_id, field, statement, provenance, model) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','x','x','inferred','m')$$);

-- ---------------------------------------------------------------------------
-- 6. Campaign / company / contact consistency
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_fail('draft -> company that is not a prospect of the campaign',
  $$INSERT INTO outreach_drafts (workspace_id, campaign_id, company_id, contact_id, channel, body, status, version) VALUES
    ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003','50000000-0000-4000-8000-000000000003','email','x','draft',1)$$);

SELECT pg_temp.expect_fail('draft -> contact belonging to a different company',
  $$INSERT INTO outreach_drafts (workspace_id, campaign_id, company_id, contact_id, channel, body, status, version) VALUES
    ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000003','email','x','draft',2)$$);

-- ---------------------------------------------------------------------------
-- 7. Partial unique indexes
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_ok('first live business profile',
  $$INSERT INTO business_profiles (workspace_id, name) VALUES
    ('10000000-0000-4000-8000-000000000001','Profile A')$$);

SELECT pg_temp.expect_fail('second live business profile in same workspace',
  $$INSERT INTO business_profiles (workspace_id, name) VALUES
    ('10000000-0000-4000-8000-000000000001','Profile B')$$);

SELECT pg_temp.expect_ok('soft-delete frees the business profile slot',
  $$UPDATE business_profiles SET deleted_at = now() WHERE workspace_id = '10000000-0000-4000-8000-000000000001'$$);

SELECT pg_temp.expect_ok('new live profile after soft delete',
  $$INSERT INTO business_profiles (workspace_id, name) VALUES
    ('10000000-0000-4000-8000-000000000001','Profile C')$$);

SELECT pg_temp.expect_fail('same company domain, different case, same workspace',
  $$INSERT INTO companies (workspace_id, name, domain, source) VALUES
    ('10000000-0000-4000-8000-000000000001','Acme Dupe','acme.COM','manual')$$);

SELECT pg_temp.expect_ok('same domain in a different workspace',
  $$INSERT INTO companies (workspace_id, name, domain, source) VALUES
    ('10000000-0000-4000-8000-000000000002','Acme Elsewhere','acme.com','manual')$$);

SELECT pg_temp.expect_ok('soft-delete frees the company domain',
  $$UPDATE companies SET deleted_at = now() WHERE id = '40000000-0000-4000-8000-000000000001'$$);

SELECT pg_temp.expect_ok('new company with the freed domain',
  $$INSERT INTO companies (workspace_id, name, domain, source) VALUES
    ('10000000-0000-4000-8000-000000000001','Acme Again','acme.com','manual')$$);

SELECT pg_temp.expect_fail('same contact email, different case, same company',
  $$INSERT INTO contacts (workspace_id, company_id, email) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','a@example.COM')$$);

SELECT pg_temp.expect_ok('same contact email in a different company',
  $$INSERT INTO contacts (workspace_id, company_id, email) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003','A@Example.com')$$);

SELECT pg_temp.expect_ok('soft-delete frees the contact email',
  $$UPDATE contacts SET deleted_at = now() WHERE id = '50000000-0000-4000-8000-000000000001'$$);

SELECT pg_temp.expect_ok('new contact with the freed email',
  $$INSERT INTO contacts (workspace_id, company_id, email) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','a@example.com')$$);

SELECT pg_temp.expect_fail('second owner in a workspace',
  $$INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
    ('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','owner')$$);

-- ---------------------------------------------------------------------------
-- 8. Revision / version uniqueness
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_fail('duplicate qualification revision',
  $$INSERT INTO qualifications (workspace_id, company_id, icp_id, revision, score, summary) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1,60,'dup')$$);

SELECT pg_temp.expect_ok('next qualification revision',
  $$INSERT INTO qualifications (workspace_id, company_id, icp_id, revision, score, summary) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',2,90,'better')$$);

SELECT pg_temp.expect_fail('duplicate draft version',
  $$INSERT INTO outreach_drafts (workspace_id, campaign_id, company_id, contact_id, channel, body, status, version) VALUES
    ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','email','dup','draft',1)$$);

SELECT pg_temp.expect_ok('next draft version',
  $$INSERT INTO outreach_drafts (workspace_id, campaign_id, company_id, contact_id, channel, body, status, version) VALUES
    ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','email','v2','draft',2)$$);

-- ---------------------------------------------------------------------------
-- 9. CHECK constraints
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_fail('invalid campaign status',
  $$INSERT INTO campaigns (workspace_id, name, status) VALUES
    ('10000000-0000-4000-8000-000000000001','Bad','nope')$$);

SELECT pg_temp.expect_fail('qualification score above 100',
  $$INSERT INTO qualifications (workspace_id, company_id, icp_id, revision, score, summary) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',3,101,'x')$$);

SELECT pg_temp.expect_fail('qualification revision below 1',
  $$INSERT INTO qualifications (workspace_id, company_id, icp_id, revision, score, summary) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',0,50,'x')$$);

SELECT pg_temp.expect_fail('draft version below 1',
  $$INSERT INTO outreach_drafts (workspace_id, campaign_id, company_id, contact_id, channel, body, status, version) VALUES
    ('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','email','x','draft',0)$$);

SELECT pg_temp.expect_fail('uppercase workspace slug',
  $$INSERT INTO workspaces (name, slug) VALUES ('Bad Slug','Bad-Slug')$$);

SELECT pg_temp.expect_fail('invalid workspace member role',
  $$INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
    ('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','god')$$);

SELECT pg_temp.expect_fail('negative employee count',
  $$INSERT INTO companies (workspace_id, name, source, employee_count) VALUES
    ('10000000-0000-4000-8000-000000000001','Neg','manual',-1)$$);

SELECT pg_temp.expect_fail('verified finding without a source',
  $$INSERT INTO research_findings (workspace_id, company_id, field, statement, provenance) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','x','x','verified')$$);

SELECT pg_temp.expect_fail('inferred finding without a model',
  $$INSERT INTO research_findings (workspace_id, company_id, field, statement, provenance) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','x','x','inferred')$$);

SELECT pg_temp.expect_fail('confidence above 1',
  $$INSERT INTO research_findings (workspace_id, company_id, field, statement, provenance, confidence, model) VALUES
    ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','x','x','inferred',1.01,'m')$$);

-- ---------------------------------------------------------------------------
-- 10. Composite ON DELETE SET NULL (the hand-edited constraints)
-- ---------------------------------------------------------------------------
DO $$
DECLARE icp uuid; ws uuid;
BEGIN
  DELETE FROM icps WHERE id = '20000000-0000-4000-8000-000000000003';
  SELECT workspace_id, icp_id INTO ws, icp
  FROM campaigns WHERE id = '30000000-0000-4000-8000-000000000003';
  PERFORM pg_temp.assert_true('campaigns.icp_id nulled, workspace_id kept',
    icp IS NULL AND ws = '10000000-0000-4000-8000-000000000001');
END $$;

DO $$
DECLARE src uuid; ws uuid;
BEGIN
  DELETE FROM research_sources WHERE id = '70000000-0000-4000-8000-000000000001';
  SELECT workspace_id, source_id INTO ws, src
  FROM research_findings WHERE id = '80000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.assert_true('research_findings.source_id nulled, workspace_id kept',
    src IS NULL AND ws = '10000000-0000-4000-8000-000000000001');
END $$;

-- A verified finding must keep its source: the CHECK blocks the SET NULL update.
DO $$
DECLARE company uuid := '40000000-0000-4000-8000-000000000003';
BEGIN
  INSERT INTO research_sources (id, workspace_id, company_id, url, source_type, retrieved_at)
  VALUES ('70000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001', company, 'https://gamma.test', 'website', now());
  INSERT INTO research_findings (workspace_id, company_id, source_id, field, statement, provenance)
  VALUES ('10000000-0000-4000-8000-000000000001', company, '70000000-0000-4000-8000-000000000002', 'x', 'x', 'verified');
  PERFORM pg_temp.expect_fail('deleting a source used by a verified finding',
    $q$DELETE FROM research_sources WHERE id = '70000000-0000-4000-8000-000000000002'$q$);
END $$;

-- ---------------------------------------------------------------------------
-- 11. Better Auth tables: constraints and cascade
-- ---------------------------------------------------------------------------
SELECT pg_temp.expect_fail('user email differing only by case',
  $$INSERT INTO users (email, name) VALUES ('OWNER@example.com','Dupe')$$);

SELECT pg_temp.expect_ok('user email that differs in a new domain',
  $$INSERT INTO users (email, name) VALUES ('owner@other.test','Other')$$);

SELECT pg_temp.expect_fail('user without a name',
  $$INSERT INTO users (email) VALUES ('noname@example.com')$$);

SELECT pg_temp.expect_fail('duplicate session token',
  $$INSERT INTO session (expires_at, token, user_id) VALUES
    (now(), 'token-owner', '00000000-0000-4000-8000-000000000002')$$);

SELECT pg_temp.expect_fail('duplicate provider account link',
  $$INSERT INTO account (account_id, provider_id, user_id) VALUES
    ('00000000-0000-4000-8000-000000000001','credential','00000000-0000-4000-8000-000000000002')$$);

SELECT pg_temp.expect_ok('same provider account for a different provider',
  $$INSERT INTO account (account_id, provider_id, user_id) VALUES
    ('00000000-0000-4000-8000-000000000001','google','00000000-0000-4000-8000-000000000002')$$);

DO $$
DECLARE n_session int; n_account int;
BEGIN
  INSERT INTO session (expires_at, token, user_id)
    VALUES (now() + interval '1 day', 'token-member', '00000000-0000-4000-8000-000000000002');
  DELETE FROM users WHERE id = '00000000-0000-4000-8000-000000000002';
  SELECT count(*) INTO n_session FROM session WHERE user_id = '00000000-0000-4000-8000-000000000002';
  SELECT count(*) INTO n_account FROM account WHERE user_id = '00000000-0000-4000-8000-000000000002';
  PERFORM pg_temp.assert_true('deleting a user cascades to session and account',
    n_session = 0 AND n_account = 0);
END $$;

-- ---------------------------------------------------------------------------
-- 12. updated_at triggers
-- ---------------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace s ON s.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND s.nspname = 'public';
  IF n <> 13 THEN RAISE EXCEPTION 'FAIL expected 13 updated_at triggers, got %', n; END IF;
  RAISE NOTICE 'PASS 13 updated_at triggers present';
END $$;

DO $$
DECLARE ts timestamptz;
BEGIN
  UPDATE session SET ip_address = '127.0.0.1'
  WHERE id = 'b0000000-0000-4000-8000-000000000001';
  SELECT updated_at INTO ts FROM session
  WHERE id = 'b0000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.assert_true('session updated_at trigger fires', ts > '2000-01-01'::timestamptz);
END $$;

ROLLBACK;

\echo 'All migration verification checks passed.'
