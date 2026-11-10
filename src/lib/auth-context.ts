import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { workspaceMembers, workspaces } from "@/db/schema";
import {
  ForbiddenError,
  UnauthorizedError,
  WorkspaceNotFoundError,
  WorkspaceNotProvisionedError,
  WorkspaceSelectionRequiredError,
} from "@/lib/auth-errors";
import { auth } from "@/lib/auth";
import { provisionInitialWorkspace } from "@/lib/workspace-provisioning";

export type WorkspaceRole = "owner" | "admin" | "member";

export type WorkspaceContext = {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
};

export type WorkspaceMembership = {
  workspaceId: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
};

export type Session = typeof auth.$Infer.Session;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Better Auth verifies the signed cookie against the database-backed session
// row. The returned user id is the only identity this module trusts.
export async function getSessionFromHeaders(requestHeaders: Headers): Promise<Session | null> {
  return auth.api.getSession({ headers: requestHeaders });
}

export async function requireSessionFromHeaders(requestHeaders: Headers): Promise<Session> {
  const session = await getSessionFromHeaders(requestHeaders);
  if (!session) throw new UnauthorizedError();
  return session;
}

export async function requireSession(): Promise<Session> {
  return requireSessionFromHeaders(await headers());
}

// `role` is text constrained by workspace_members_role_check to these values.
function asRole(role: string): WorkspaceRole {
  return role as WorkspaceRole;
}

export async function listWorkspaceMemberships(userId: string): Promise<WorkspaceMembership[]> {
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)))
    .orderBy(asc(workspaces.createdAt));

  return rows.map((row) => ({ ...row, role: asRole(row.role) }));
}

/**
 * Read-only workspace resolution for an already-authenticated user.
 *
 * With an explicit id, membership is the only proof accepted; anything else is
 * a 404 so a non-member cannot probe which workspaces exist. Without an id,
 * multiple memberships are rejected rather than resolved arbitrarily.
 */
export async function resolveWorkspaceContext(
  userId: string,
  workspaceId?: string,
): Promise<WorkspaceContext> {
  if (workspaceId !== undefined) {
    // A malformed id must not reach PostgreSQL (uuid cast error) and must look
    // exactly like a workspace the caller cannot see.
    if (!UUID_RE.test(workspaceId)) throw new WorkspaceNotFoundError();

    const [row] = await db
      .select({ workspaceId: workspaces.id, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.workspaceId, workspaceId),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);

    if (!row) throw new WorkspaceNotFoundError();
    return { userId, workspaceId: row.workspaceId, role: asRole(row.role) };
  }

  const memberships = await listWorkspaceMemberships(userId);
  if (memberships.length === 0) throw new WorkspaceNotProvisionedError();
  if (memberships.length > 1) throw new WorkspaceSelectionRequiredError();
  return { userId, workspaceId: memberships[0].workspaceId, role: memberships[0].role };
}

export async function getWorkspaceContext(workspaceId?: string): Promise<WorkspaceContext> {
  const { user } = await requireSession();
  return resolveWorkspaceContext(user.id, workspaceId);
}

/**
 * Heals a failed sign-up hook: provisions the personal workspace, then
 * resolves. Only runs without an explicit workspace, so an invited user acting
 * inside an existing workspace never gets an unwanted personal one.
 */
export async function ensureWorkspaceContextForUser(
  userId: string,
  workspaceId?: string,
): Promise<WorkspaceContext> {
  if (workspaceId === undefined) await provisionInitialWorkspace(userId);
  return resolveWorkspaceContext(userId, workspaceId);
}

export async function ensureWorkspaceContext(workspaceId?: string): Promise<WorkspaceContext> {
  const { user } = await requireSession();
  return ensureWorkspaceContextForUser(user.id, workspaceId);
}

const ROLE_RANK: Record<WorkspaceRole, number> = { member: 1, admin: 2, owner: 3 };

export function hasRole(context: WorkspaceContext, minimum: WorkspaceRole): boolean {
  return ROLE_RANK[context.role] >= ROLE_RANK[minimum];
}

export function requireRole(context: WorkspaceContext, minimum: WorkspaceRole): WorkspaceContext {
  if (!hasRole(context, minimum)) throw new ForbiddenError();
  return context;
}
