import { roles, statement } from "@bracketx/auth";

/**
 * Pure permission logic — no database, no session, no I/O.
 *
 * Kept separate from the data-access functions so the rules can be tested
 * exhaustively without a Postgres instance, and so the realtime service
 * reserved in ARCHITECTURE.md §6.1 can evaluate the same rules without pulling
 * in a database client.
 */

export type Resource = keyof typeof statement;

export type PermissionRequest = {
  [K in Resource]?: readonly string[];
};

export const KNOWN_ROLES = Object.keys(roles) as ReadonlyArray<
  keyof typeof roles
>;

export type KnownRole = (typeof KNOWN_ROLES)[number];

/**
 * Better Auth stores a member's roles as a comma-separated string, so this is
 * the only correct way to read `member.role`. Splitting on comma is not a
 * convenience — a member with "admin,member" is a single row.
 */
export function parseRoles(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((role) => role.trim())
    .filter((role) => role.length > 0);
}

export function isKnownRole(role: string): role is KnownRole {
  return Object.prototype.hasOwnProperty.call(roles, role);
}

/**
 * Does a member holding `rawRole` satisfy `request`?
 *
 * Unknown roles contribute nothing rather than throwing. `member.role` is free
 * text with no database constraint, so a typo or a role removed from
 * permissions.ts must fail closed, not crash the request.
 */
export function can(
  rawRole: string | null | undefined,
  request: PermissionRequest,
): boolean {
  const held = parseRoles(rawRole);
  if (held.length === 0) return false;

  return held.some((role) => {
    if (!isKnownRole(role)) return false;
    return roles[role].authorize(request as never).success;
  });
}

/** Convenience wrappers for the checks Phase 0 actually performs. */
export const policy = {
  canCreateProject: (role: string | null | undefined) =>
    can(role, { project: ["create"] }),
  canReadProject: (role: string | null | undefined) =>
    can(role, { project: ["read"] }),
  canUpdateProject: (role: string | null | undefined) =>
    can(role, { project: ["update"] }),
  canDeleteProject: (role: string | null | undefined) =>
    can(role, { project: ["delete"] }),
  canDeleteWorkspace: (role: string | null | undefined) =>
    can(role, { organization: ["delete"] }),
  canInviteMember: (role: string | null | undefined) =>
    can(role, { invitation: ["create"] }),
} as const;
