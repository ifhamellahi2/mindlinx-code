import { ensureWorkspaceContextForUser, requireSessionFromHeaders } from "@/lib/auth-context";
import { errorResponse } from "@/lib/auth-errors";
import { assertTrustedOrigin } from "@/lib/http/origin";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * First authenticated endpoint and the recovery point for a failed sign-up
 * provisioning hook. Identity comes only from the verified session; the user
 * id is never read from the request.
 */
export async function POST(request: Request) {
  try {
    assertTrustedOrigin(request);

    const { user } = await requireSessionFromHeaders(request.headers);
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;

    // Heals a missing initial workspace when no explicit workspace is asked for;
    // with an explicit id it only resolves membership (404 when invisible).
    const context = await ensureWorkspaceContextForUser(user.id, workspaceId);
    return Response.json(context, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
