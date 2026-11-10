// Typed failures so route handlers can map them to HTTP without string
// matching. `status` is the intended response code; 404 is deliberate for
// workspaces the caller cannot see, so existence never leaks.
export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor(message = "Authentication required") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;

  constructor(message = "Insufficient workspace role") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class WorkspaceNotFoundError extends Error {
  readonly status = 404;

  constructor(message = "Workspace not found") {
    super(message);
    this.name = "WorkspaceNotFoundError";
  }
}

export class WorkspaceNotProvisionedError extends Error {
  readonly status = 409;

  constructor(message = "No active workspace membership") {
    super(message);
    this.name = "WorkspaceNotProvisionedError";
  }
}

export class WorkspaceSelectionRequiredError extends Error {
  readonly status = 409;

  constructor(message = "Multiple workspace memberships; an explicit workspace is required") {
    super(message);
    this.name = "WorkspaceSelectionRequiredError";
  }
}

// Mutating routes check their own Origin: Better Auth's origin protection only
// covers /api/auth/*.
export class InvalidOriginError extends Error {
  readonly status = 403;

  constructor(message = "Untrusted request origin") {
    super(message);
    this.name = "InvalidOriginError";
  }
}

const NO_STORE = { "cache-control": "no-store" } as const;

function json(error: Error, status: number) {
  // Stable name only: internal messages and driver details never reach a client.
  return Response.json({ error: error.name }, { status, headers: NO_STORE });
}

/**
 * Maps the typed auth/workspace failures to HTTP responses. Unknown errors are
 * rethrown so a programming failure still surfaces as a 500 instead of being
 * disguised as a client error.
 */
export function errorResponse(error: unknown): Response {
  if (error instanceof UnauthorizedError) return json(error, 401);
  if (error instanceof ForbiddenError) return json(error, 403);
  if (error instanceof InvalidOriginError) return json(error, 403);
  if (error instanceof WorkspaceNotFoundError) return json(error, 404);
  if (error instanceof WorkspaceNotProvisionedError) return json(error, 409);
  if (error instanceof WorkspaceSelectionRequiredError) return json(error, 409);
  throw error;
}
