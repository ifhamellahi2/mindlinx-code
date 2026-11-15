import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { and, eq, isNull } from "drizzle-orm";
import { client, db } from "@/db";
import { businessProfiles, users, workspaces } from "@/db/schema";
import {
  getBusinessProfile,
  saveBusinessProfile,
  type BusinessProfileDto,
  type SaveBusinessProfileResult,
} from "@/lib/business-profile/repository";
import {
  parseBusinessProfileInput,
  type BusinessProfileInput,
} from "@/lib/business-profile/validation";

// Hard guard: these tests write workspaces and business profiles. They must
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

const TOKEN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function parse(input: unknown): BusinessProfileInput {
  const result = parseBusinessProfileInput(input);
  assert.equal(result.ok, true, `expected valid input: ${JSON.stringify(result)}`);
  return (result as { ok: true; data: BusinessProfileInput }).data;
}

function fieldsOf(input: unknown): Record<string, string> {
  const result = parseBusinessProfileInput(input);
  assert.equal(result.ok, false, `expected invalid input: ${JSON.stringify(input)}`);
  return (result as { ok: false; fields: Record<string, string> }).fields;
}

function saved(result: SaveBusinessProfileResult): BusinessProfileDto {
  assert.equal(result.status, "saved", "expected a saved profile");
  return (result as { status: "saved"; profile: BusinessProfileDto }).profile;
}

async function makeWorkspace(prefix: string) {
  const [user] = await db
    .insert(users)
    .values({ email: `${prefix}-${randomUUID()}@example.invalid`, name: `${prefix} User` })
    .returning({ id: users.id });
  const [workspace] = await db
    .insert(workspaces)
    .values({
      name: `${prefix} workspace`,
      slug: `ws-${randomUUID().replaceAll("-", "")}`,
      createdBy: user.id,
    })
    .returning({ id: workspaces.id });

  return { userId: user.id, workspaceId: workspace.id };
}

describe("business profile validation", () => {
  it("accepts a minimal draft and normalizes empty optional fields", () => {
    const data = parse({
      name: "  Acme Labs  ",
      website: "",
      industry: "",
      description: "",
      expectedUpdatedAt: null,
    });

    assert.equal(data.name, "Acme Labs");
    assert.equal(data.website, null);
    assert.equal(data.industry, null);
    assert.equal(data.description, null);
    assert.deepEqual(data.details, {
      targetCustomers: null,
      geographies: null,
      differentiators: null,
      goals: null,
    });
    assert.equal(data.complete, false);
    assert.equal(data.expectedUpdatedAt, null);
  });

  it("requires a non-empty business name", () => {
    assert.ok(fieldsOf({ name: "" }).name);
    assert.ok(fieldsOf({ name: "   " }).name);
    assert.ok(fieldsOf({}).name);
    assert.ok(fieldsOf({ name: 42 }).name);
  });

  it("rejects completion without a description", () => {
    assert.ok(fieldsOf({ name: "Acme", complete: true, description: "   " }).description);
    assert.ok(fieldsOf({ name: "Acme", complete: true }).description);
  });

  it("accepts completion with a description", () => {
    const data = parse({ name: "Acme", description: "We sell things.", complete: true });
    assert.equal(data.complete, true);
    assert.equal(data.description, "We sell things.");
  });

  it("rejects unsafe, credentialed, and malformed websites", () => {
    const invalid = [
      "javascript:alert(1)",
      "data:text/html,hello",
      "file:///etc/passwd",
      "ftp://example.com",
      "https://user:password@example.com",
      "not a url",
    ];

    for (const website of invalid) {
      assert.ok(fieldsOf({ name: "Acme", website }).website, `expected rejection: ${website}`);
    }
  });

  it("normalizes bare domains and http(s) URLs", () => {
    assert.equal(parse({ name: "Acme", website: "example.com" }).website, "https://example.com/");
    assert.equal(
      parse({ name: "Acme", website: "HTTPS://Example.COM/Path#fragment" }).website,
      "https://example.com/Path",
    );
    assert.equal(
      parse({ name: "Acme", website: "http://example.com" }).website,
      "http://example.com/",
    );
  });

  it("rejects over-length values instead of truncating them", () => {
    assert.ok(fieldsOf({ name: "a".repeat(121) }).name);
    assert.ok(fieldsOf({ name: "Acme", description: "a".repeat(4001) }).description);
    assert.ok(
      fieldsOf({ name: "Acme", details: { goals: "a".repeat(1001) } })["details.goals"],
    );
  });

  it("rejects unknown top-level and nested keys", () => {
    assert.ok(fieldsOf({ name: "Acme", workspaceId: randomUUID() }).body);
    assert.ok(fieldsOf({ name: "Acme", details: { revenue: "$1M" } }).details);
  });

  it("strips control characters but keeps multiline text", () => {
    const data = parse({
      name: "Ac\u0000me",
      description: "Line one\r\nLine two\u0007\r\n\r\n\tIndented",
    });

    assert.equal(data.name, "Acme");
    assert.equal(data.description, "Line one\nLine two\n\n\tIndented");
  });

  it("validates the optimistic concurrency token", () => {
    assert.ok(fieldsOf({ name: "Acme", expectedUpdatedAt: "2026-01-01" }).expectedUpdatedAt);
    assert.ok(
      fieldsOf({ name: "Acme", expectedUpdatedAt: "2026-01-01T00:00:00Z" }).expectedUpdatedAt,
    );
    assert.equal(
      parse({ name: "Acme", expectedUpdatedAt: "2026-11-16T10:00:00.123456Z" })
        .expectedUpdatedAt,
      "2026-11-16T10:00:00.123456Z",
    );
  });

  it("requires complete to be a boolean", () => {
    assert.ok(fieldsOf({ name: "Acme", complete: "yes" }).complete);
  });
});

describe("business profile repository", () => {
  it("creates a draft and reads it back", async () => {
    const { workspaceId } = await makeWorkspace("bp-create");
    const created = saved(
      await saveBusinessProfile(workspaceId, parse({ name: "Acme", expectedUpdatedAt: null })),
    );

    assert.equal(created.name, "Acme");
    assert.equal(created.completedAt, null);
    assert.match(created.updatedAt, TOKEN);

    const read = await getBusinessProfile(workspaceId);
    assert.equal(read?.id, created.id);
    assert.equal(read?.updatedAt, created.updatedAt);
  });

  it("updates without changing the profile id and bumps the token", async () => {
    const { workspaceId } = await makeWorkspace("bp-update");
    const created = saved(
      await saveBusinessProfile(workspaceId, parse({ name: "Acme", expectedUpdatedAt: null })),
    );

    const updated = saved(
      await saveBusinessProfile(
        workspaceId,
        parse({
          name: "Acme Labs",
          description: "We sell widgets.",
          expectedUpdatedAt: created.updatedAt,
        }),
      ),
    );

    assert.equal(updated.id, created.id);
    assert.equal(updated.name, "Acme Labs");
    assert.notEqual(updated.updatedAt, created.updatedAt);
  });

  it("moves draft to complete and back, preserving the first completion time", async () => {
    const { workspaceId } = await makeWorkspace("bp-lifecycle");
    const draft = saved(
      await saveBusinessProfile(workspaceId, parse({ name: "Acme", expectedUpdatedAt: null })),
    );

    const complete = saved(
      await saveBusinessProfile(
        workspaceId,
        parse({
          name: "Acme",
          description: "We sell widgets.",
          complete: true,
          expectedUpdatedAt: draft.updatedAt,
        }),
      ),
    );
    assert.match(complete.completedAt ?? "", TOKEN);

    const edited = saved(
      await saveBusinessProfile(
        workspaceId,
        parse({
          name: "Acme Labs",
          description: "We sell widgets.",
          complete: true,
          expectedUpdatedAt: complete.updatedAt,
        }),
      ),
    );
    assert.equal(edited.completedAt, complete.completedAt);

    const reopened = saved(
      await saveBusinessProfile(
        workspaceId,
        parse({ name: "Acme Labs", expectedUpdatedAt: edited.updatedAt }),
      ),
    );
    assert.equal(reopened.completedAt, null);
  });

  it("does not touch updated_at when the submitted data is unchanged", async () => {
    const { workspaceId } = await makeWorkspace("bp-noop");
    const created = saved(
      await saveBusinessProfile(workspaceId, parse({ name: "Acme", expectedUpdatedAt: null })),
    );

    const unchanged = saved(
      await saveBusinessProfile(
        workspaceId,
        parse({ name: "Acme", expectedUpdatedAt: created.updatedAt }),
      ),
    );

    assert.equal(unchanged.updatedAt, created.updatedAt);
  });

  it("treats a stale token with identical data as an idempotent retry", async () => {
    const { workspaceId } = await makeWorkspace("bp-idempotent");
    const created = saved(
      await saveBusinessProfile(workspaceId, parse({ name: "Acme", expectedUpdatedAt: null })),
    );

    // The client never saw the first response, so it retries the original request.
    const retried = saved(
      await saveBusinessProfile(workspaceId, parse({ name: "Acme", expectedUpdatedAt: null })),
    );

    assert.equal(retried.id, created.id);
    assert.equal(retried.updatedAt, created.updatedAt);

    const stale = saved(
      await saveBusinessProfile(
        workspaceId,
        parse({
          name: "Acme",
          description: "Same content",
          expectedUpdatedAt: created.updatedAt,
        }),
      ),
    );
    const staleRetry = saved(
      await saveBusinessProfile(
        workspaceId,
        parse({
          name: "Acme",
          description: "Same content",
          expectedUpdatedAt: created.updatedAt,
        }),
      ),
    );
    assert.equal(staleRetry.updatedAt, stale.updatedAt);
  });

  it("rejects a stale token whose data differs", async () => {
    const { workspaceId } = await makeWorkspace("bp-conflict");
    const created = saved(
      await saveBusinessProfile(workspaceId, parse({ name: "Acme", expectedUpdatedAt: null })),
    );

    const winner = saved(
      await saveBusinessProfile(
        workspaceId,
        parse({ name: "Acme A", expectedUpdatedAt: created.updatedAt }),
      ),
    );
    assert.equal(winner.name, "Acme A");

    const loser = await saveBusinessProfile(
      workspaceId,
      parse({ name: "Acme B", expectedUpdatedAt: created.updatedAt }),
    );
    assert.equal(loser.status, "conflict");

    const stored = await getBusinessProfile(workspaceId);
    assert.equal(stored?.name, "Acme A");
  });

  it("allows only one writer when two updates race", async () => {
    const { workspaceId } = await makeWorkspace("bp-race");
    const created = saved(
      await saveBusinessProfile(workspaceId, parse({ name: "Acme", expectedUpdatedAt: null })),
    );

    const results = await Promise.all([
      saveBusinessProfile(
        workspaceId,
        parse({ name: "Acme A", expectedUpdatedAt: created.updatedAt }),
      ),
      saveBusinessProfile(
        workspaceId,
        parse({ name: "Acme B", expectedUpdatedAt: created.updatedAt }),
      ),
    ]);

    const statuses = results.map((result) => result.status).sort();
    assert.deepEqual(statuses, ["conflict", "saved"]);
  });

  it("creates exactly one profile when first saves race", async () => {
    const { workspaceId } = await makeWorkspace("bp-create-race");
    const input = parse({ name: "Acme", expectedUpdatedAt: null });

    const results = await Promise.all(
      Array.from({ length: 8 }, () => saveBusinessProfile(workspaceId, input)),
    );

    assert.equal(results.filter((result) => result.status === "saved").length, 8);
    const ids = new Set(results.map((result) => saved(result).id));
    assert.equal(ids.size, 1);

    const rows = await db
      .select({ id: businessProfiles.id })
      .from(businessProfiles)
      .where(
        and(
          eq(businessProfiles.workspaceId, workspaceId),
          isNull(businessProfiles.deletedAt),
        ),
      );
    assert.equal(rows.length, 1);
  });

  it("rejects a second create with different data", async () => {
    const { workspaceId } = await makeWorkspace("bp-duplicate");
    saved(await saveBusinessProfile(workspaceId, parse({ name: "Acme", expectedUpdatedAt: null })));

    const second = await saveBusinessProfile(
      workspaceId,
      parse({ name: "Other", expectedUpdatedAt: null }),
    );
    assert.equal(second.status, "conflict");
  });

  it("excludes soft-deleted profiles and creates a fresh row after deletion", async () => {
    const { workspaceId } = await makeWorkspace("bp-soft-delete");
    const created = saved(
      await saveBusinessProfile(workspaceId, parse({ name: "Acme", expectedUpdatedAt: null })),
    );

    await db
      .update(businessProfiles)
      .set({ deletedAt: new Date() })
      .where(eq(businessProfiles.id, created.id));

    assert.equal(await getBusinessProfile(workspaceId), null);

    const recreated = saved(
      await saveBusinessProfile(workspaceId, parse({ name: "Acme 2", expectedUpdatedAt: null })),
    );
    assert.notEqual(recreated.id, created.id);

    const rows = await db
      .select({ id: businessProfiles.id, deletedAt: businessProfiles.deletedAt })
      .from(businessProfiles)
      .where(eq(businessProfiles.workspaceId, workspaceId));
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.deletedAt === null).length, 1);
  });

  it("never reads or updates another workspace's profile", async () => {
    const a = await makeWorkspace("bp-tenant-a");
    const b = await makeWorkspace("bp-tenant-b");

    const profileA = saved(
      await saveBusinessProfile(a.workspaceId, parse({ name: "Acme A", expectedUpdatedAt: null })),
    );

    assert.equal(await getBusinessProfile(b.workspaceId), null);

    const profileB = saved(
      await saveBusinessProfile(b.workspaceId, parse({ name: "Acme B", expectedUpdatedAt: null })),
    );
    assert.notEqual(profileB.id, profileA.id);

    // A token from workspace A cannot update workspace B.
    const crossTenant = await saveBusinessProfile(
      b.workspaceId,
      parse({ name: "Hijacked", expectedUpdatedAt: profileA.updatedAt }),
    );
    assert.equal(crossTenant.status, "conflict");

    assert.equal((await getBusinessProfile(a.workspaceId))?.name, "Acme A");
    assert.equal((await getBusinessProfile(b.workspaceId))?.name, "Acme B");
  });
});
