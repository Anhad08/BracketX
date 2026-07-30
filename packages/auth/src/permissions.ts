import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * BracketX permission statement.
 *
 * `defaultStatements` is spread rather than re-typed. Better Auth 1.6.25 ships
 * FIVE default resources — `organization`, `member`, `invitation`, `team`, and
 * `ac` — not the three its docs page lists. Re-declaring them by hand would
 * silently drop `team`/`ac` and break the built-in role checks that reference
 * them.
 *
 * Resources are added here as they are built. Assets (Phase 1) and scenes
 * (Phase 2) are deliberately absent: declaring permissions for things that do
 * not exist is guesswork we would have to migrate away from.
 */
export const statement = {
  ...defaultStatements,
  project: ["create", "read", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);

/**
 * Roles extend Better Auth's built-ins rather than replacing them, so upstream
 * changes to owner/admin/member semantics are inherited instead of forked.
 */
export const owner = ac.newRole({
  ...ownerAc.statements,
  project: ["create", "read", "update", "delete"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  project: ["create", "read", "update", "delete"],
});

/**
 * `member` is read-only on projects, matching Better Auth's own `memberAc`,
 * which grants nothing but `ac: ["read"]`.
 *
 * An `operator` role — someone who runs a show live but cannot delete projects
 * or touch billing — is the likely fourth role. It is deferred until
 * PRODUCT.md/P3 settles single- vs multi-operator, because that answer decides
 * whether operator is a workspace role or a per-project one.
 */
export const member = ac.newRole({
  ...memberAc.statements,
  project: ["read"],
});

export const roles = { owner, admin, member };

export type BracketXRole = keyof typeof roles;
