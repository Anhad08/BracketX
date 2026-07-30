import { auth } from "@bracketx/auth";
import { and, eq, member, organization } from "@bracketx/db";

import type { Ctx } from "./context";
import { NotFoundError } from "./errors";
import { createWorkspaceSchema } from "./schemas";

export type Membership = {
  organizationId: string;
  userId: string;
  /** Raw comma-separated role string. Read it with `parseRoles`. */
  role: string;
};

/**
 * THE authorisation enforcement point (ARCHITECTURE.md §5).
 *
 * Every function that touches workspace-scoped data calls this first. There is
 * exactly one of these on purpose: a second implementation is a second chance
 * to get tenant isolation wrong.
 *
 * Throws NotFoundError — never ForbiddenError — when the caller is not a
 * member. See errors.ts for why that distinction leaks data if reversed.
 */
export async function assertMemberOfOrganization(
  ctx: Ctx,
  organizationId: string,
): Promise<Membership> {
  const rows = await ctx.db
    .select({
      organizationId: member.organizationId,
      userId: member.userId,
      role: member.role,
    })
    .from(member)
    .where(
      and(
        eq(member.organizationId, organizationId),
        eq(member.userId, ctx.userId),
      ),
    )
    .limit(1);

  const membership = rows[0];
  if (!membership) {
    throw new NotFoundError("Workspace not found.");
  }

  return membership;
}

/**
 * Resolves the session's active workspace to a verified membership.
 *
 * `session.activeOrganizationId` has no foreign key in Better Auth's schema, so
 * it can outlive the organization it names or survive the user's removal from
 * it. This function is the reason that is not a security hole.
 */
export async function resolveActiveWorkspace(
  ctx: Ctx,
): Promise<Membership | null> {
  if (!ctx.activeOrganizationId) return null;

  try {
    return await assertMemberOfOrganization(ctx, ctx.activeOrganizationId);
  } catch {
    // Stale pointer: the org was deleted, or the user was removed from it.
    // Treat it as "no workspace selected" rather than an error — the caller
    // should send the user to the workspace picker.
    return null;
  }
}

export async function listWorkspacesForUser(ctx: Ctx) {
  return ctx.db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      role: member.role,
      createdAt: organization.createdAt,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, ctx.userId));
}

export async function getWorkspaceBySlug(ctx: Ctx, slug: string) {
  const rows = await ctx.db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
    })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);

  const workspace = rows[0];
  if (!workspace) {
    throw new NotFoundError("Workspace not found.");
  }

  // Existence is not access. This converts "exists but not yours" into the
  // same 404 a non-existent slug produces.
  await assertMemberOfOrganization(ctx, workspace.id);

  return workspace;
}

/**
 * Creates a workspace through Better Auth rather than by inserting rows.
 *
 * Going via the plugin API is not ceremony: it creates the `member` row for the
 * creator with `creatorRole`, enforces organizationLimit, and fires the
 * before/after hooks. A raw Drizzle insert would produce an organization with
 * no members — invisible to its own creator.
 */
export async function createWorkspace(
  input: unknown,
  headers: Headers,
): Promise<{ id: string; name: string; slug: string }> {
  const { name, slug } = createWorkspaceSchema.parse(input);

  const created = await auth.api.createOrganization({
    body: { name, slug },
    headers,
  });

  if (!created) {
    throw new Error("Workspace creation returned no organization.");
  }

  return { id: created.id, name: created.name, slug: created.slug };
}
