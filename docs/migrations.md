# Migrations

The approved schema lives in `docs/database-architecture.md`. Drizzle schema
files in `src/db/schema/` are the source; `drizzle/*.sql` is what reaches
PostgreSQL.

## Safe workflow

```bash
pnpm db:generate --name <change>   # write SQL from the schema
pnpm db:guard                      # fail if the SET NULL edits were lost
pnpm db:check                      # journal/snapshot consistency
```

Then apply to a disposable database and run `scripts/db-verify.sql` before
touching the development database.

### Disposable database

```bash
docker run -d --name mindlinx-migration-test \
  -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=mindlinx_test \
  -p 127.0.0.1:55432:5432 --tmpfs /var/lib/postgresql/data:rw postgres:16-alpine

DATABASE_URL=postgres://test:test@127.0.0.1:55432/mindlinx_test pnpm db:migrate
docker cp scripts/db-verify.sql mindlinx-migration-test:/tmp/
docker exec mindlinx-migration-test psql -U test -d mindlinx_test \
  -v ON_ERROR_STOP=1 -f /tmp/db-verify.sql

docker rm -f mindlinx-migration-test
```

Never run `db:push` or `db:migrate` against the development database until the
suite passes. Never use `docker compose down -v`.

## The two hand-edited constraints

Drizzle cannot emit a column list on a composite `ON DELETE SET NULL`, so
`drizzle/0000_initial.sql` is edited by hand:

```sql
-- campaigns
... FOREIGN KEY ("workspace_id","icp_id") REFERENCES "icps"("workspace_id","id")
    ON DELETE SET NULL ("icp_id") ...
-- research_findings
... FOREIGN KEY ("workspace_id","source_id") REFERENCES "research_sources"("workspace_id","id")
    ON DELETE SET NULL ("source_id") ...
```

A bare `SET NULL` nulls every FK column, including the `NOT NULL`
`workspace_id`, so the delete would fail. `pnpm db:guard` re-checks this after
every generation. If a future regeneration drops the edits, restore the two
lines above and re-run the suite.

Note: deleting a `research_sources` row referenced by a `verified` finding is
rejected by `research_findings_verified_source_check`. That is intentional —
verified claims must keep their source.

## Custom migrations

- `0001_updated_at_triggers.sql` — shared `set_updated_at()` trigger from
  architecture §8, attached to every table with `updated_at`. Hand-written
  because Drizzle cannot express triggers. `db:generate` will not modify it.
- `0002_auth.sql` — generated: Better Auth `session`, `account` and
  `verification` tables, plus `users.email_verified`, `users.image`,
  `users.name NOT NULL` and `users_email_lower_unique`. Reviewed by hand; it
  contains no drops.
- `0003_auth_triggers.sql` — custom: `set_updated_at` triggers for the three
  auth tables.
- `0004_initial_workspace.sql` — generated: `workspaces.initial_for_user_id`
  (nullable FK to `users`, `ON DELETE SET NULL`) and the partial unique index
  `workspaces_initial_for_user_unique`. Additive only; no table rebuild.

When adding a table with `updated_at`, add its trigger to a new custom
migration (`pnpm db:generate --custom --name <change>`).

`scripts/db-verify.sql` currently expects 17 tables, 33 foreign keys, 26 named
indexes, 19 CHECK constraints and 13 `updated_at` triggers.
