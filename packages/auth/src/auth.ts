import { db, schema } from "@bracketx/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";

import { ac, roles } from "./permissions";

/**
 * The Better Auth instance. This is also the file the schema generator reads:
 *
 *   pnpm --filter @bracketx/auth auth:generate
 *
 * which writes packages/db/src/schema/auth.ts.
 *
 * `secret` and `baseURL` are intentionally not passed — Better Auth reads
 * BETTER_AUTH_SECRET and BETTER_AUTH_URL from the environment itself. Passing
 * them explicitly would make the generator fail whenever a developer runs it
 * without a populated .env, which is exactly when they most need it to work.
 *
 * Not enabled, both of which default to false:
 *   - `teams`                → avoids the `team` and `teamMember` tables.
 *     Workspace *is* organization; a third tier is not in the roadmap.
 *   - `dynamicAccessControl` → avoids the `organizationRole` table. Our roles
 *     are code-defined in ./permissions.ts, which is reviewable in a PR.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),

  emailAndPassword: {
    enabled: true,
  },

  plugins: [
    organization({
      ac,
      roles,
      creatorRole: "owner",
      schema: {
        organization: {
          additionalFields: {
            /**
             * Better Auth's `organization` table has createdAt but no
             * updatedAt. Added here so workspace renames and settings changes
             * are attributable.
             *
             * `input: false` keeps it out of the create/update request body —
             * a client must not be able to set it.
             */
            updatedAt: {
              type: "date",
              required: false,
              input: false,
              defaultValue: () => new Date(),
              onUpdate: () => new Date(),
            },
          },
        },
      },
    }),

    // Must stay last: it wraps the response to set cookies in Next.js
    // server actions and route handlers.
    nextCookies(),
  ],
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
