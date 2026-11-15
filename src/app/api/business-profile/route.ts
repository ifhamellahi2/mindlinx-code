import {
  resolveWorkspaceContext,
  requireRole,
  requireSessionFromHeaders,
} from "@/lib/auth-context";
import { errorResponse } from "@/lib/auth-errors";
import {
  BusinessProfileConflictError,
  PayloadTooLargeError,
  ValidationError,
} from "@/lib/business-profile/errors";
import {
  getBusinessProfile,
  saveBusinessProfile,
} from "@/lib/business-profile/repository";
import { parseBusinessProfileInput } from "@/lib/business-profile/validation";
import { assertTrustedOrigin } from "@/lib/http/origin";

const NO_STORE = { "cache-control": "no-store" } as const;

// The largest legitimate payload is well under 16 KB of text; 32 KB leaves room
// for JSON escaping while still rejecting an unbounded body before parsing.
const MAX_BODY_BYTES = 32 * 1024;

async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }

  const text = await request.text();
  // Content-Length can be absent or lie (chunked transfer), so check the bytes
  // that actually arrived before handing anything to JSON.parse.
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) throw new PayloadTooLargeError();

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError({ body: "Request body must be valid JSON." });
  }
}

/** The current workspace's live profile, or `{ profile: null }`. */
export async function GET(request: Request) {
  try {
    // No workspace id is accepted from the request; membership is resolved from
    // the verified session alone.
    const { user } = await requireSessionFromHeaders(request.headers);
    const context = await resolveWorkspaceContext(user.id);

    const profile = await getBusinessProfile(context.workspaceId);
    return Response.json({ profile }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Creates, updates, completes, or reopens the workspace's profile. */
export async function PUT(request: Request) {
  try {
    assertTrustedOrigin(request);

    const { user } = await requireSessionFromHeaders(request.headers);
    const context = await resolveWorkspaceContext(user.id);
    // Every workspace role may read and edit the profile; the check is explicit
    // so a future role change cannot silently grant write access.
    requireRole(context, "member");

    const parsed = parseBusinessProfileInput(await readJsonBody(request));
    if (!parsed.ok) throw new ValidationError(parsed.fields);

    const result = await saveBusinessProfile(context.workspaceId, parsed.data);
    if (result.status === "conflict") {
      // 409, never a silent overwrite of another member's edit.
      throw new BusinessProfileConflictError();
    }

    return Response.json({ profile: result.profile }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
