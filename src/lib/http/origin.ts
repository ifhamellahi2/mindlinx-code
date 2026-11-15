import { InvalidOriginError } from "@/lib/auth-errors";
import { env } from "@/lib/env.server";

const TRUSTED_ORIGIN = new URL(env.BETTER_AUTH_URL).origin;

/**
 * Better Auth's origin check covers /api/auth/* only, so every other mutating
 * endpoint guards itself. Shared by all such routes; do not loosen.
 */
export function assertTrustedOrigin(request: Request) {
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
