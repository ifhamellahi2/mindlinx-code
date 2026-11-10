import { ensureWorkspaceContextForUser, requireSessionFromHeaders } from "@/lib/auth-context";
import { errorResponse, InvalidOriginError } from "@/lib/auth-errors";
import { env } from "@/lib/env.server";

const NO_STORE = { "cache-control": "no-store" } as const;
const TRUSTED_ORIGIN = new URL(env.BETTER_AUTH_URL).origin;

// Better Auth's origin check covers /api/auth/* only, so this route guards itself.
function assertTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) throw new InvalidOriginError("Missing Origin header");

  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    throw new InvalidOriginError("Malformed Origin header");
  }
  if (normalized !== TRUSTED_ORIGIN) throw new InvalidOriginError();
}

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
