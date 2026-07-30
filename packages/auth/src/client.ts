import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ac, roles } from "./permissions";

/**
 * Browser-side auth client.
 *
 * `ac` and `roles` are passed so that client-side permission checks use the
 * exact same definitions as the server. They are a UI affordance only — every
 * check is re-run server-side in `@bracketx/core`. A permission check that only
 * happens in the browser is not a permission check.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
  plugins: [organizationClient({ ac, roles })],
});

export const { signIn, signUp, signOut, useSession } = authClient;
