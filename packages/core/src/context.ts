import { getSession } from "@bracketx/auth";
import { db as defaultDb, type Database } from "@bracketx/db";

import { UnauthorizedError } from "./errors";

/**
 * Everything domain logic needs to answer a request.
 *
 * `db` is injectable so tests and, later, the realtime service can supply their
 * own instance instead of reaching for a module-level singleton.
 */
export type Ctx = {
  db: Database;
  userId: string;
  /**
   * The workspace the session currently has selected, if any.
   *
   * Untrusted. Better Auth stores this on the session with no foreign key, so
   * it may point at a deleted organization or one the user has since been
   * removed from. Always pass it through assertMemberOfOrganization before
   * acting on it.
   */
  activeOrganizationId: string | null;
};

/**
 * Builds a Ctx from request headers, or throws.
 *
 * This is the policy layer that `@bracketx/auth` deliberately does not provide:
 * auth retrieves a session or null, and core decides that null is an error.
 */
export async function requireSession(
  headers: Headers,
  db: Database = defaultDb,
): Promise<Ctx> {
  const session = await getSession(headers);

  if (!session?.user?.id) {
    throw new UnauthorizedError();
  }

  return {
    db,
    userId: session.user.id,
    activeOrganizationId: session.session.activeOrganizationId ?? null,
  };
}
