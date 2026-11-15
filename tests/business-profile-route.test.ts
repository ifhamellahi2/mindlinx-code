import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { eq } from "drizzle-orm";
import { GET, PUT } from "@/app/api/business-profile/route";
import { client, db } from "@/db";
import { businessProfiles, workspaceMembers, workspaces } from "@/db/schema";
import { auth } from "@/lib/auth";

// Hard guard: these tests write users, workspaces and profiles. They must never
// reach the development database.
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
const ENDPOINT = `${TRUSTED_ORIGIN}/api/business-profile`;

function profileRequest(
  options: {
    method?: "GET" | "PUT";
    cookie?: string;
    origin?: string | null;
    body?: unknown;
    rawBody?: string;
  } = {},
) {
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? TRUSTED_ORIGIN);
  if (options.cookie) headers.set("cookie", options.cookie);

  const rawBody =
    options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (rawBody !== undefined) headers.set("content-type", "application/json");

  return new Request(ENDPOINT, { method: options.method ?? "GET", headers, body: rawBody });
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

// Gives a signed-up user exactly one membership: the workspace under test.
// Their personal workspace is removed so context resolution is unambiguous.
async function cookieForRole(role: "admin" | "member", workspaceId: string) {
  const { userId, cookie } = await signUp(`role-${role}`);
  const initial = await initialWorkspaceOf(userId);
  await db.delete(workspaces).where(eq(workspaces.id, initial.id));
  await db.insert(workspaceMembers).values({ workspaceId, userId, role });
  return cookie;
}

describe("GET /api/business-profile", () => {
  it("rejects a request with no session", async () => {
    await expectError(await GET(profileRequest()), 401, "UnauthorizedError");
  });

  it("returns an empty result when no profile exists", async () => {
    const { cookie } = await signUp("bp-get-empty");
    const response = await GET(profileRequest({ cookie }));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { profile: null });
  });

  it("returns 409 when the user belongs to multiple workspaces", async () => {
    const a = await signUp("bp-get-multi-a");
    const b = await signUp("bp-get-multi-b");
    const workspaceB = await initialWorkspaceOf(b.userId);
    await db.insert(workspaceMembers).values({
      workspaceId: workspaceB.id,
      userId: a.userId,
      role: "member",
    });

    await expectError(
      await GET(profileRequest({ cookie: a.cookie })),
      409,
      "WorkspaceSelectionRequiredError",
    );
  });
});

describe("PUT /api/business-profile", () => {
  it("rejects a request with no session", async () => {
    await expectError(
      await PUT(profileRequest({ method: "PUT", body: { name: "Acme" } })),
      401,
      "UnauthorizedError",
    );
  });

  it("rejects a missing Origin", async () => {
    const { cookie } = await signUp("bp-origin-missing");
    await expectError(
      await PUT(profileRequest({ method: "PUT", cookie, origin: null, body: { name: "Acme" } })),
      403,
      "InvalidOriginError",
    );
  });

  it("rejects an untrusted Origin", async () => {
    const { cookie } = await signUp("bp-origin-evil");
    await expectError(
      await PUT(
        profileRequest({
          method: "PUT",
          cookie,
          origin: "http://evil.example",
          body: { name: "Acme" },
        }),
      ),
      403,
      "InvalidOriginError",
    );
  });

  it("creates a draft, then returns it from GET", async () => {
    const { cookie } = await signUp("bp-put-create");
    const created = await PUT(
      profileRequest({
        method: "PUT",
        cookie,
        body: {
          name: "  Acme Labs  ",
          website: "example.com",
          industry: "B2B SaaS",
          details: { targetCustomers: "Early-stage startups" },
          expectedUpdatedAt: null,
        },
      }),
    );

    assert.equal(created.status, 200);
    assert.equal(created.headers.get("cache-control"), "no-store");
    const body = (await created.json()) as {
      profile: {
        id: string;
        name: string;
        website: string | null;
        details: { targetCustomers: string | null; goals: string | null };
        completedAt: string | null;
        updatedAt: string;
      };
    };

    assert.equal(body.profile.name, "Acme Labs");
    assert.equal(body.profile.website, "https://example.com/");
    assert.equal(body.profile.details.targetCustomers, "Early-stage startups");
    assert.equal(body.profile.details.goals, null);
    assert.equal(body.profile.completedAt, null);
    assert.match(body.profile.updatedAt, /\.\d{6}Z$/);

    const read = await GET(profileRequest({ cookie }));
    assert.equal(read.status, 200);
    const readBody = (await read.json()) as { profile: { id: string } };
    assert.equal(readBody.profile.id, body.profile.id);
  });

  it("returns field-level errors for invalid input", async () => {
    const { cookie } = await signUp("bp-validation");
    const response = await PUT(
      profileRequest({ method: "PUT", cookie, body: { name: "Acme", complete: true } }),
    );

    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = (await response.json()) as {
      error: string;
      fields: Record<string, string>;
    };
    assert.equal(body.error, "ValidationError");
    assert.ok(body.fields.description);
  });

  it("returns a stable error for malformed JSON", async () => {
    const { cookie } = await signUp("bp-malformed");
    const response = await PUT(
      profileRequest({ method: "PUT", cookie, rawBody: "{ not json" }),
    );

    assert.equal(response.status, 400);
    const body = (await response.json()) as {
      error: string;
      fields: Record<string, string>;
    };
    assert.equal(body.error, "ValidationError");
    assert.ok(body.fields.body);
  });

  it("rejects an oversized request body before parsing", async () => {
    const { cookie } = await signUp("bp-oversized");
    const response = await PUT(
      profileRequest({
        method: "PUT",
        cookie,
        body: { name: "a".repeat(40_000) },
      }),
    );

    await expectError(response, 413, "PayloadTooLargeError");
  });

  it("completes a profile and updates it without changing its id", async () => {
    const { cookie } = await signUp("bp-complete");
    const created = await PUT(
      profileRequest({ method: "PUT", cookie, body: { name: "Acme", expectedUpdatedAt: null } }),
    );
    const { profile } = (await created.json()) as {
      profile: { id: string; updatedAt: string };
    };

    const completed = await PUT(
      profileRequest({
        method: "PUT",
        cookie,
        body: {
          name: "Acme",
          description: "We sell widgets.",
          complete: true,
          expectedUpdatedAt: profile.updatedAt,
        },
      }),
    );
    assert.equal(completed.status, 200);
    const completedBody = (await completed.json()) as {
      profile: { id: string; completedAt: string | null; updatedAt: string };
    };
    assert.equal(completedBody.profile.id, profile.id);
    assert.ok(completedBody.profile.completedAt);

    const edited = await PUT(
      profileRequest({
        method: "PUT",
        cookie,
        body: {
          name: "Acme Labs",
          description: "We sell widgets.",
          complete: true,
          expectedUpdatedAt: completedBody.profile.updatedAt,
        },
      }),
    );
    assert.equal(edited.status, 200);
    const editedBody = (await edited.json()) as {
      profile: { id: string; name: string; completedAt: string | null };
    };
    assert.equal(editedBody.profile.id, profile.id);
    assert.equal(editedBody.profile.name, "Acme Labs");
    assert.equal(editedBody.profile.completedAt, completedBody.profile.completedAt);
  });

  it("returns 409 for a stale token and 200 for an identical retry", async () => {
    const { cookie } = await signUp("bp-conflict");
    const created = await PUT(
      profileRequest({ method: "PUT", cookie, body: { name: "Acme", expectedUpdatedAt: null } }),
    );
    const { profile } = (await created.json()) as {
      profile: { updatedAt: string };
    };

    const first = await PUT(
      profileRequest({
        method: "PUT",
        cookie,
        body: { name: "Acme A", expectedUpdatedAt: profile.updatedAt },
      }),
    );
    assert.equal(first.status, 200);
    const firstBody = (await first.json()) as { profile: { updatedAt: string } };

    const stale = await PUT(
      profileRequest({
        method: "PUT",
        cookie,
        body: { name: "Acme B", expectedUpdatedAt: profile.updatedAt },
      }),
    );
    await expectError(stale, 409, "BusinessProfileConflictError");

    // A retry of the *first* request must succeed without a second write.
    const retry = await PUT(
      profileRequest({
        method: "PUT",
        cookie,
        body: { name: "Acme A", expectedUpdatedAt: profile.updatedAt },
      }),
    );
    assert.equal(retry.status, 200);
    const retryBody = (await retry.json()) as { profile: { name: string; updatedAt: string } };
    assert.equal(retryBody.profile.name, "Acme A");
    assert.equal(retryBody.profile.updatedAt, firstBody.profile.updatedAt);
  });

  for (const role of ["admin", "member"] as const) {
    it(`allows a workspace ${role} to edit the profile`, async () => {
      const owner = await signUp(`bp-owner-${role}`);
      const ownerWorkspace = await initialWorkspaceOf(owner.userId);
      const cookie = await cookieForRole(role, ownerWorkspace.id);

      const response = await PUT(
        profileRequest({
          method: "PUT",
          cookie,
          body: { name: `Edited by ${role}`, expectedUpdatedAt: null },
        }),
      );

      assert.equal(response.status, 200);
      const body = (await response.json()) as { profile: { name: string } };
      assert.equal(body.profile.name, `Edited by ${role}`);
    });
  }

  it("hides a soft-deleted profile and refuses its old token", async () => {
    const { cookie } = await signUp("bp-soft-deleted");
    const created = await PUT(
      profileRequest({ method: "PUT", cookie, body: { name: "Acme", expectedUpdatedAt: null } }),
    );
    const { profile } = (await created.json()) as {
      profile: { id: string; updatedAt: string };
    };

    await db
      .update(businessProfiles)
      .set({ deletedAt: new Date() })
      .where(eq(businessProfiles.id, profile.id));

    const read = await GET(profileRequest({ cookie }));
    assert.deepEqual(await read.json(), { profile: null });

    const stale = await PUT(
      profileRequest({
        method: "PUT",
        cookie,
        body: { name: "Acme", expectedUpdatedAt: profile.updatedAt },
      }),
    );
    await expectError(stale, 409, "BusinessProfileConflictError");
  });
});
