import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { POST } from "@/app/api/workspace/ensure/route";
import { client, db } from "@/db";
import { workspaceMembers, workspaces } from "@/db/schema";
import { auth } from "@/lib/auth";

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

const TRUSTED_ORIGIN = "http://localhost:3000";

function ensureRequest(options: {
  cookie?: string;
  workspaceId?: string;
  origin?: string | null;
} = {}) {
  const url = new URL(`${TRUSTED_ORIGIN}/api/workspace/ensure`);
  if (options.workspaceId !== undefined) url.searchParams.set("workspaceId", options.workspaceId);

  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? TRUSTED_ORIGIN);
  if (options.cookie) headers.set("cookie", options.cookie);

  return new Request(url, { method: "POST", headers });
}

async function expectError(response: Response, status: number, name: string) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: name });
}

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

  return { userId: body.user.id, cookie };
}

async function initialWorkspaceOf(userId: string) {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.initialForUserId, userId));
  assert.ok(workspace, "expected an initial workspace");
  return workspace;
}

describe("POST /api/workspace/ensure", () => {
  it("rejects a request with no session", async () => {
    await expectError(await POST(ensureRequest()), 401, "UnauthorizedError");
  });

  it("rejects a forged cookie", async () => {
    await expectError(
      await POST(ensureRequest({ cookie: "better-auth.session_token=forged" })),
      401,
      "UnauthorizedError",
    );
  });

  it("rejects a missing Origin", async () => {
    const { cookie } = await signUp("origin-missing");
    await expectError(
      await POST(ensureRequest({ cookie, origin: null })),
      403,
      "InvalidOriginError",
    );
  });

  it("rejects an untrusted Origin", async () => {
    const { cookie } = await signUp("origin-evil");
    await expectError(
      await POST(ensureRequest({ cookie, origin: "http://evil.example" })),
      403,
      "InvalidOriginError",
    );
  });

  it("resolves the provisioned workspace for a signed-up user", async () => {
    const { userId, cookie } = await signUp("ensure-happy");
    const workspace = await initialWorkspaceOf(userId);

    const response = await POST(ensureRequest({ cookie }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { userId, workspaceId: workspace.id, role: "owner" });
  });

  it("creates exactly one workspace when the initial one is missing", async () => {
    const { userId, cookie } = await signUp("ensure-heal");
    const workspace = await initialWorkspaceOf(userId);
    await db.delete(workspaces).where(eq(workspaces.id, workspace.id));

    const response = await POST(ensureRequest({ cookie }));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { workspaceId: string; role: string };
    assert.notEqual(body.workspaceId, workspace.id);
    assert.equal(body.role, "owner");

    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.initialForUserId, userId));
    assert.equal(rows.length, 1);
    const members = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, rows[0].id));
    assert.equal(members.length, 1);
    assert.equal(members[0].role, "owner");
  });

  it("returns 409 for a soft-deleted initial workspace without replacing it", async () => {
    const { userId, cookie } = await signUp("ensure-soft-deleted");
    const workspace = await initialWorkspaceOf(userId);
    await db.update(workspaces).set({ deletedAt: new Date() }).where(eq(workspaces.id, workspace.id));

    await expectError(await POST(ensureRequest({ cookie })), 409, "WorkspaceNotProvisionedError");

    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.initialForUserId, userId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, workspace.id);
  });

  it("returns 409 when multiple memberships exist without an explicit workspace", async () => {
    const a = await signUp("ensure-multi-a");
    const b = await signUp("ensure-multi-b");
    const workspaceB = await initialWorkspaceOf(b.userId);
    await db.insert(workspaceMembers).values({
      workspaceId: workspaceB.id,
      userId: a.userId,
      role: "member",
    });

    await expectError(
      await POST(ensureRequest({ cookie: a.cookie })),
      409,
      "WorkspaceSelectionRequiredError",
    );
  });

  it("returns 404 for a workspace the user does not belong to", async () => {
    const a = await signUp("ensure-outsider-a");
    const b = await signUp("ensure-outsider-b");
    const workspaceB = await initialWorkspaceOf(b.userId);

    await expectError(
      await POST(ensureRequest({ cookie: a.cookie, workspaceId: workspaceB.id })),
      404,
      "WorkspaceNotFoundError",
    );
  });

  it("returns 404 for a malformed workspace id", async () => {
    const { cookie } = await signUp("ensure-malformed");
    await expectError(
      await POST(ensureRequest({ cookie, workspaceId: "not-a-uuid" })),
      404,
      "WorkspaceNotFoundError",
    );
  });

  it("returns the database role for an explicitly selected workspace", async () => {
    const a = await signUp("ensure-select-a");
    const b = await signUp("ensure-select-b");
    const workspaceA = await initialWorkspaceOf(a.userId);
    const workspaceB = await initialWorkspaceOf(b.userId);
    await db.insert(workspaceMembers).values({
      workspaceId: workspaceB.id,
      userId: a.userId,
      role: "member",
    });

    const own = await POST(ensureRequest({ cookie: a.cookie, workspaceId: workspaceA.id }));
    assert.equal(own.status, 200);
    assert.deepEqual(await own.json(), { userId: a.userId, workspaceId: workspaceA.id, role: "owner" });

    const joined = await POST(ensureRequest({ cookie: a.cookie, workspaceId: workspaceB.id }));
    assert.equal(joined.status, 200);
    assert.deepEqual(await joined.json(), { userId: a.userId, workspaceId: workspaceB.id, role: "member" });
  });
});
