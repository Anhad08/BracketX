/**
 * The shape every server action returns to `useActionState`.
 *
 * CLIENT-SAFE BY DESIGN — this module must import nothing.
 *
 * Client components need `idle` as the initial state, so anything imported
 * here ends up in the browser bundle. When this lived alongside the error
 * mapper it dragged @bracketx/core → @bracketx/auth → @bracketx/db → `pg` into
 * the client build, i.e. the Postgres driver was being shipped to the browser.
 * The server-side mapper lives in ./errors.ts, which is marked `server-only`.
 */
export type ActionState = {
  /** Form-level failure, shown above the fields. */
  error?: string;
  /** Field name → message, keyed to match the input's `name`. */
  fieldErrors?: Record<string, string>;
};

export const idle: ActionState = {};
