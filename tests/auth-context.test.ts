import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { client, db } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import {
  ensureWorkspaceContextForUser,
  getSessionFromHeaders,
  hasRole,
  listWorkspaceMemberships,
  requireRole,
  requireSessionFromHeaders,
  resolveWorkspaceContext,
  type WorkspaceContext,
  type WorkspaceRole,
} from "@/lib/auth-context";
import {
  ForbiddenError,
  UnauthorizedError,
  WorkspaceNotFoundError,
  WorkspaceNotProvisionedError,
  WorkspaceSelectionRequiredError,
} from "@/lib/auth-errors";
import { auth } from "@/lib/auth";
import { provisionInitialWorkspace } from "@/lib/workspace-provisioning";

// Hard guard: these tests write users, workspaces and memberships. They must
// never reach the development database.
const databaseUrl = process.env.DATABASE_URL ?? "";
if (!/\/mindlinx_test(\?|$)/.test(databaseUrl) || /:5433\//.test(databaseUrl)) {
  throw new Error(
    `Refusing to run: DATABASE_URL must be the disposable mindlinx_test database on port 55432 (got ${databaseUrl.replace(/\/\/[^@]*@/, "//***@")})`,
  );
}

after(async () => {
  await client.end();
});

async function signUp(prefix: string) {
  const email = `${prefix}-${randomUUID()}@example.invalid`;
  const response = await auth.api.signUpEmail({
    body: { email, password: "Valid-Pass-12345", name: `${prefix} User` },
    asResponse: true,
  });
  assert.equal(response.status, 200, `sign-up failed for ${prefix}`);

  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("better-auth.session_token="))
    ?.split(";")[0];
  assert.ok(cookie, "sign-up did not set a session cookie");

  return { userId: body.user.id, email, headers: new Headers({ cookie }) };
}

async function initialWorkspaceOf(userId: string) {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.initialForUserId, userId));
  assert.ok(workspace, "expected an initial workspace");
  return workspace;
}

describe("session helpers", () => {
  it("rejects a request with no session", async () => {
    assert.equal(await getSessionFromHeaders(new Headers()), null);
    await assert.rejects(requireSessionFromHeaders(new Headers()), UnauthorizedError);
  });

  it("rejects a forged cookie", async () => {
    await assert.rejects(
      requireSessionFromHeaders(new Headers({ cookie: "better-auth.session_token=forged" })),
      UnauthorizedError,
    );
  });

  it("accepts a real session and uses the database user id", async () => {
    const user = await signUp("session");
    const session = await requireSessionFromHeaders(user.headers);
    assert.equal(session.user.id, user.userId);
    assert.equal(session.user.email, user.email);
  });
});

describe("initial provisioning", () => {
  it("creates one owner workspace when a user signs up", async () => {
    const { userId } = await signUp("initial");
    const workspace = await initialWorkspaceOf(userId);

    assert.equal(workspace.createdBy, userId);
    const members = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspace.id));
    assert.equal(members.length, 1);
    assert.equal(members[0].userId, userId);
    assert.equal(members[0].role, "owner");
  });

  it("returns the same workspace on repeated provisioning", async () => {
    const { userId } = await signUp("repeat");
    const first = await provisionInitialWorkspace(userId);
    const second = await provisionInitialWorkspace(userId);

    assert.equal(second.workspaceId, first.workspaceId);
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.initialForUserId, userId));
    assert.equal(rows.length, 1);
  });

  it("serialises concurrent provisioning into one workspace", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: `concurrent-${randomUUID()}@example.invalid`, name: "Concurrent User" })
      .returning({ id: users.id });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => provisionInitialWorkspace(user.id)),
    );
    assert.equal(new Set(results.map((result) => result.workspaceId)).size, 1);

    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.initialForUserId, user.id));
    assert.equal(rows.length, 1);

    const members = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, rows[0].id));
    assert.equal(members.length, 1);
    assert.equal(members[0].role, "owner");
  });

  it("rejects a missing user", async () => {
    await assert.rejects(provisionInitialWorkspace(randomUUID()), UnauthorizedError);
  });

  it("enforces one initial workspace per user in the database", async () => {
    const { userId } = await signUp("marker-unique");
    const workspace = await initialWorkspaceOf(userId);

    await assert.rejects(
      db.insert(workspaces).values({
        name: "Duplicate initial",
        slug: `ws-${randomUUID().replaceAll("-", "")}`,
        createdBy: userId,
        initialForUserId: userId,
      }),
    );

    // Ordinary workspaces leave the marker NULL and stay unlimited.
    const [ordinary] = await db
      .insert(workspaces)
      .values({
        name: "Ordinary workspace",
        slug: `ws-${randomUUID().replaceAll("-", "")}`,
        createdBy: userId,
      })
      .returning({ id: workspaces.id });
    assert.ok(ordinary);
    assert.notEqual(ordinary.id, workspace.id);
  });

  it("enforces one owner membership per workspace", async () => {
    const { userId } = await signUp("owner-unique");
    const workspace = await initialWorkspaceOf(userId);
    const [second] = await db
      .insert(users)
      .values({ email: `second-${randomUUID()}@example.invalid`, name: "Second User" })
      .returning({ id: users.id });

    await assert.rejects(
      db.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: second.id,
        role: "owner",
      }),
    );
  });
});

describe("workspace resolution", () => {
  it("rejects a workspace the user does not belong to", async () => {
    const a = await signUp("outsider-a");
    const b = await signUp("outsider-b");
    const workspaceB = await initialWorkspaceOf(b.userId);

    await assert.rejects(resolveWorkspaceContext(a.userId, workspaceB.id), WorkspaceNotFoundError);
    await assert.rejects(resolveWorkspaceContext(a.userId, randomUUID()), WorkspaceNotFoundError);
    await assert.rejects(resolveWorkspaceContext(a.userId, "not-a-uuid"), WorkspaceNotFoundError);
  });

  it("supports multiple memberships and refuses to choose one", async () => {
    const a = await signUp("multi-a");
    const b = await signUp("multi-b");
    const workspaceA = await initialWorkspaceOf(a.userId);
    const workspaceB = await initialWorkspaceOf(b.userId);
    await db.insert(workspaceMembers).values({
      workspaceId: workspaceB.id,
      userId: a.userId,
      role: "member",
    });

    await assert.rejects(resolveWorkspaceContext(a.userId), WorkspaceSelectionRequiredError);

    const inA = await resolveWorkspaceContext(a.userId, workspaceA.id);
    const inB = await resolveWorkspaceContext(a.userId, workspaceB.id);
    assert.equal(inA.role, "owner");
    assert.equal(inB.role, "member");
    assert.equal((await listWorkspaceMemberships(a.userId)).length, 2);
  });

  it("never resolves a soft-deleted initial workspace", async () => {
    const user = await signUp("soft-deleted");
    const workspace = await initialWorkspaceOf(user.userId);
    await db.update(workspaces).set({ deletedAt: new Date() }).where(eq(workspaces.id, workspace.id));

    // The marker survives and provisioning returns it; no replacement is made.
    const reprovisioned = await provisionInitialWorkspace(user.userId);
    assert.equal(reprovisioned.workspaceId, workspace.id);
    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.initialForUserId, user.userId));
    assert.equal(rows.length, 1);

    await assert.rejects(resolveWorkspaceContext(user.userId, workspace.id), WorkspaceNotFoundError);
    await assert.rejects(resolveWorkspaceContext(user.userId), WorkspaceNotProvisionedError);
    await assert.rejects(ensureWorkspaceContextForUser(user.userId), WorkspaceNotProvisionedError);

    const afterHeal = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.initialForUserId, user.userId));
    assert.equal(afterHeal.length, 1);
  });
});

describe("hook recovery", () => {
  it("provisions again when the initial workspace is missing", async () => {
    const user = await signUp("heal");
    const workspace = await initialWorkspaceOf(user.userId);
    await db.delete(workspaces).where(eq(workspaces.id, workspace.id));

    const healed = await ensureWorkspaceContextForUser(user.userId);
    assert.notEqual(healed.workspaceId, workspace.id);
    assert.equal(healed.role, "owner");
    assert.equal((await listWorkspaceMemberships(user.userId)).length, 1);
  });
});

describe("role authorization", () => {
  const context = (role: WorkspaceRole): WorkspaceContext => ({
    userId: "user-id",
    workspaceId: "workspace-id",
    role,
  });

  it("enforces member < admin < owner", () => {
    assert.equal(hasRole(context("member"), "member"), true);
    assert.equal(hasRole(context("member"), "admin"), false);
    assert.equal(hasRole(context("admin"), "admin"), true);
    assert.equal(hasRole(context("admin"), "owner"), false);
    assert.equal(hasRole(context("owner"), "owner"), true);

    assert.throws(() => requireRole(context("member"), "admin"), ForbiddenError);
    assert.throws(() => requireRole(context("member"), "owner"), ForbiddenError);
    assert.throws(() => requireRole(context("admin"), "owner"), ForbiddenError);
    assert.equal(requireRole(context("owner"), "admin").role, "owner");
  });
});
