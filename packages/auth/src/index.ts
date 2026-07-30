export { auth, type Auth, type Session } from "./auth";
export {
  ac,
  admin,
  member,
  owner,
  roles,
  statement,
  type BracketXRole,
} from "./permissions";

import { auth } from "./auth";

/**
 * Reads the session from request headers.
 *
 * Takes a `Headers` object rather than calling Next's `headers()` on purpose:
 * this package must stay framework-agnostic so the realtime service reserved in
 * ARCHITECTURE.md §6.1 can authenticate connections with the same code path.
 * Two session implementations would mean two ways to get authentication wrong.
 *
 * Returns null when unauthenticated. Turning that into an error is policy, and
 * policy lives in `@bracketx/core` — see `requireSession` there.
 */
export async function getSession(headers: Headers) {
  return auth.api.getSession({ headers });
}
