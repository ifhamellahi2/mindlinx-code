# Authentication

Better Auth 1.7.18 owns `session`, `account` and `verification`. `users` stays
the identity table — it is referenced by `workspaces.created_by` and
`workspace_members.user_id`, so it is extended, never replaced.
`workspace_members` remains the only membership and role store.

## Non-negotiables

- `advanced.database.generateId = "uuid"` — every auth id column is `uuid`,
  while Better Auth's default generator emits a 32-char string.
- `user: { modelName: "users" }` — no duplicate user table.
- `drizzleAdapter(db, { provider: "pg", transaction: true })`.
- `nextCookies()` is the last plugin in the array.
- Roles are read from `workspace_members` on every request, never stored in the
  session or a cookie.
- A workspace id supplied by the client is never trusted. Resolve the workspace
  from the route, verify membership, and return 404 (not 403) when absent.

## Workspace provisioning

Provisioning is idempotent and race-safe, but it is **not** one-workspace-per-user:
a user may belong to many workspaces. The idempotency key is
`workspaces.initial_for_user_id`, backed by the partial unique index
`workspaces_initial_for_user_unique`. Membership count is never used as proof:
an invited user can have memberships without ever owning a personal workspace.

- `provisionInitialWorkspace(userId)` locks the `users` row, returns the marked
  workspace when it exists, and otherwise inserts the workspace plus its single
  `owner` membership in one transaction. Concurrent callers converge on one row.
- Better Auth's `databaseHooks.user.create.after` provisions ordinary sign-ups.
  It runs after the sign-up transaction commits, so it may open its own
  transaction. A failure is logged, not hidden: the account is already
  committed, so the request is not failed. `POST /api/workspace/ensure`
  (`ensureWorkspaceContextForUser`) is the explicit recovery path and is safe to
  call repeatedly.
- Sign-up success alone does not prove a workspace exists. A missing one
  surfaces as `WorkspaceNotProvisionedError`, never as a fabricated context.
- Switching between workspaces is a future feature and must not be blocked by a
  constraint.

### Soft-deleted initial workspaces

- A soft-deleted workspace (`deleted_at IS NOT NULL`) is never returned as an
  active context: resolution fails with `WorkspaceNotFoundError`.
- Provisioning still returns the marked row and **never** creates a replacement,
  so the marker and its uniqueness survive.
- Recovery is a future, explicit operation: either clear `deleted_at` (restore)
  or, for a deliberate replacement, clear `initial_for_user_id` and provision
  again — both inside one transaction with the `users` row locked. Nothing
  automatic does either today.

### Invitations (not implemented)

Invitation-based registration must be distinguishable from ordinary sign-up
before the user-creation hook runs, so invited users are not given an unwanted
personal workspace. Future policy: the invitation flow records its source (for
example a verified invitation token on the sign-up request), the hook skips
`provisionInitialWorkspace` for it, and the invited user receives the membership
created by accepting the invitation. There is no invitation endpoint, token or
UI today, and `ensureWorkspaceContext()` — the personal-workspace heal path —
must not be used for invited users.

## Session and authorization helpers

`src/lib/auth-context.ts`:

- `getSessionFromHeaders` / `requireSessionFromHeaders` / `requireSession` —
  the identity is always the database-verified session for the signed cookie.
  User ids from the browser are never accepted.
- `resolveWorkspaceContext(userId, workspaceId?)` — read-only. An explicit id
  must be a UUID and must match a membership in a non-deleted workspace;
  otherwise it is a 404 so non-members cannot probe existence. Without an id,
  zero memberships is 409 `WorkspaceNotProvisionedError` and more than one is
  409 `WorkspaceSelectionRequiredError`; it never picks arbitrarily.
- `getWorkspaceContext` — `requireSession()` + resolve, for server components
  and actions.
- `ensureWorkspaceContext` — the recovery path. It provisions only when no
  explicit workspace was requested, so an invited user acting in an existing
  workspace never gets an unwanted personal one.
- `listWorkspaceMemberships` — active memberships, for the future switcher.
- `requireRole` / `hasRole` — hierarchy `member < admin < owner`. Admin gates
  use `admin`; ownership transfer and workspace rename/delete use `owner`.
  Roles are read from `workspace_members` on every request, never cached in the
  session or a cookie.

## HTTP entry point

`POST /api/workspace/ensure` (`src/app/api/workspace/ensure/route.ts`) is the
first authenticated endpoint and the recovery point for a failed sign-up hook.

- Requires a valid Better Auth session from `request.headers`. The user id comes
  only from the verified session, never from the request.
- Validates `Origin` against `BETTER_AUTH_URL` before doing anything. A missing,
  malformed or untrusted origin is 403 `InvalidOriginError`. Better Auth's origin
  protection covers `/api/auth/*` only, so this route checks its own.
- Optional `?workspaceId=<uuid>` selects one membership. A malformed id or a
  workspace the caller is not a member of is 404, so existence never leaks.
- With no `workspaceId` it heals a missing initial workspace (provisioning is
  idempotent) and returns 409 when there is no active membership or more than
  one. A soft-deleted initial workspace is 409 and is never replaced.
- Success returns `{ userId, workspaceId, role }`. Every response — success or
  error — carries `Cache-Control: no-store`.

`errorResponse()` in `src/lib/auth-errors.ts` maps the typed failures:

| Error | Status |
|---|---|
| `UnauthorizedError` | 401 |
| `ForbiddenError`, `InvalidOriginError` | 403 |
| `WorkspaceNotFoundError` | 404 |
| `WorkspaceNotProvisionedError`, `WorkspaceSelectionRequiredError` | 409 |

Bodies carry the stable error name only. Unknown errors are rethrown, so a
programming failure stays a 500 instead of being disguised as a client error.

## Future API requirements

Every route or server action that touches workspace data must:

1. Derive identity from `requireSession()` / `requireSessionFromHeaders()`; never
   accept a user id from the request.
2. Obtain the workspace from `getWorkspaceContext()` / `resolveWorkspaceContext()`
   (or `ensureWorkspaceContext*` where healing is intended) — never construct
   `WorkspaceContext` by hand.
3. Check roles with `requireRole()` using roles read from `workspace_members` per
   request; never trust a role from the session or the client.
4. Pass `context.workspaceId` — never a request-supplied id — into repository
   functions and every `WHERE` clause.
5. Send `Cache-Control: no-store` on authenticated responses.
6. Validate `Origin` on mutating endpoints; Better Auth's protection does not
   extend beyond `/api/auth/*`.

Do not use `proxy.ts` or `middleware.ts` as the authorization layer. Next.js
does not guarantee proxy coverage of every server entry point; enforce inside
the route or action.

## Testing

```bash
pnpm test:auth
```

Creates a throwaway PostgreSQL container on `127.0.0.1:55432`, applies every
migration, runs `scripts/db-verify.sql`, then runs the Node test suites
(`tests/auth-context.test.ts` for the helpers, `tests/workspace-route.test.ts`
for `POST /api/workspace/ensure`). The runner and both test files refuse any
database that is not `mindlinx_test` on port 55432, so they cannot reach the
development database.

## Production gates (deliberately not in the MVP)

- **Email verification** is deferred. It is required before email-based
  invitations and before sensitive recovery flows are trusted.
- **Rate limiting** uses Better Auth's in-memory limiter in development only.
  A multi-instance deployment needs a shared store.
- **Password reset** must never report success in production until an email
  provider is configured and the message is actually sent. In development the
  reset link is logged.
