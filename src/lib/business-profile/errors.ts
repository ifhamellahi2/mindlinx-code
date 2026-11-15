export class ValidationError extends Error {
  readonly status = 400;
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>, message = "Invalid business profile input") {
    super(message);
    this.name = "ValidationError";
    this.fields = fields;
  }
}

export class PayloadTooLargeError extends Error {
  readonly status = 413;

  constructor(message = "Request body is too large") {
    super(message);
    this.name = "PayloadTooLargeError";
  }
}

// A stale optimistic token, or a retry whose data no longer matches what was
// stored. The client reloads; nothing is overwritten.
export class BusinessProfileConflictError extends Error {
  readonly status = 409;

  constructor(message = "Business profile was changed by another request") {
    super(message);
    this.name = "BusinessProfileConflictError";
  }
}
