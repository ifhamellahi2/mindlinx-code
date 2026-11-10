import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { UnauthorizedError } from "@/lib/auth-errors";

export type ProvisionedWorkspace = {
  userId: string;
  workspaceId: string;
  role: "owner";
};

function workspaceName(name: string) {
  const trimmed = name.trim();
  return trimmed ? `${trimmed}'s workspace` : "Personal workspace";
}

/**
 * Creates the one initial workspace for a user, or returns the existing one.
 *
 * The `workspaces.initial_for_user_id` marker (not membership count) is the
 * idempotency key: a user may belong to many workspaces, and an invited user
 * may have memberships without ever having been provisioned. The partial unique
 * index makes a second initial workspace impossible even if two callers race.
 *
 * Soft-deleted initial workspaces are returned unchanged. Provisioning never
 * resurrects or replaces one; recovery is a separate, explicit operation.
 */
export async function provisionInitialWorkspace(userId: string): Promise<ProvisionedWorkspace> {
  return db.transaction(async (tx) => {
    // Serialises concurrent provisioning for the same user (docs/auth.md).
    const [user] = await tx
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) throw new UnauthorizedError("User no longer exists");

    const [existing] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.initialForUserId, userId))
      .limit(1);
    if (existing) return { userId, workspaceId: existing.id, role: "owner" };

    const [created] = await tx
      .insert(workspaces)
      .values({
        name: workspaceName(user.name),
        // Random, so the slug does not leak the user id. Collision space is
        // 122 bits; the marker below, not the slug, carries idempotency.
        slug: `ws-${randomUUID().replaceAll("-", "")}`,
        createdBy: userId,
        initialForUserId: userId,
      })
      .onConflictDoNothing({
        target: workspaces.initialForUserId,
        where: sql`${workspaces.initialForUserId} is not null`,
      })
      .returning({ id: workspaces.id });

    if (created) {
      await tx.insert(workspaceMembers).values({
        workspaceId: created.id,
        userId,
        role: "owner",
      });
      return { userId, workspaceId: created.id, role: "owner" };
    }

    // Another caller won the insert. Its workspace and membership commit in
    // the same transaction, so this re-read is complete.
    const [winner] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.initialForUserId, userId))
      .limit(1);
    if (!winner) throw new Error("Initial workspace conflict without an existing row");
    return { userId, workspaceId: winner.id, role: "owner" };
  });
}
