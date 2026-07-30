/**
 * Typed domain errors. `core` throws these; apps translate them to HTTP status
 * or UI state (ARCHITECTURE.md §7). A raw Drizzle or Postgres error must never
 * reach a user.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** No session at all. The caller should sign in. */
export class UnauthorizedError extends DomainError {
  readonly code = "unauthorized";
  readonly httpStatus = 401;

  constructor(message = "Authentication required.") {
    super(message);
  }
}

/**
 * Authenticated, and known to be a member, but lacking the permission for this
 * specific action.
 *
 * Do NOT use this for non-membership — see NotFoundError.
 */
export class ForbiddenError extends DomainError {
  readonly code = "forbidden";
  readonly httpStatus = 403;

  constructor(message = "You do not have permission to do that.") {
    super(message);
  }
}

/**
 * The resource does not exist *or* the caller is not a member of the workspace
 * that owns it.
 *
 * Collapsing those two cases is deliberate. Returning 403 for a resource that
 * exists but belongs to someone else confirms its existence, which leaks
 * customer data across tenants — a stranger could enumerate workspace slugs and
 * learn which are real. Phase 0 exit criterion 3 requires 404 here.
 */
export class NotFoundError extends DomainError {
  readonly code = "not_found";
  readonly httpStatus = 404;

  constructor(message = "Not found.") {
    super(message);
  }
}

/** A uniqueness constraint would be violated, e.g. a duplicate project slug. */
export class ConflictError extends DomainError {
  readonly code = "conflict";
  readonly httpStatus = 409;

  constructor(message = "That already exists.") {
    super(message);
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}
