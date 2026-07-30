import { and, eq, project } from "@bracketx/db";

import type { Ctx } from "./context";
import { ConflictError, ForbiddenError, NotFoundError } from "./errors";
import { policy } from "./policy";
import { createProjectSchema } from "./schemas";
import { assertMemberOfOrganization } from "./workspaces";

export async function listProjects(ctx: Ctx, organizationId: string) {
  const membership = await assertMemberOfOrganization(ctx, organizationId);

  if (!policy.canReadProject(membership.role)) {
    throw new ForbiddenError("You cannot view projects in this workspace.");
  }

  return ctx.db
    .select()
    .from(project)
    .where(eq(project.organizationId, organizationId));
}

export async function getProject(
  ctx: Ctx,
  organizationId: string,
  slug: string,
) {
  const membership = await assertMemberOfOrganization(ctx, organizationId);

  if (!policy.canReadProject(membership.role)) {
    throw new ForbiddenError("You cannot view projects in this workspace.");
  }

  const rows = await ctx.db
    .select()
    .from(project)
    .where(
      // Scoped by organizationId as well as slug. Querying on slug alone would
      // return another tenant's project whenever slugs collide, which they
      // will — `project.slug` is only unique *within* an organization.
      and(eq(project.organizationId, organizationId), eq(project.slug, slug)),
    )
    .limit(1);

  const found = rows[0];
  if (!found) {
    throw new NotFoundError("Project not found.");
  }

  return found;
}

export async function createProject(ctx: Ctx, input: unknown) {
  const parsed = createProjectSchema.parse(input);

  // The client-supplied organizationId is only ever a lookup key. This call is
  // what makes it safe: an id the caller is not a member of yields a 404 before
  // anything is written.
  const membership = await assertMemberOfOrganization(
    ctx,
    parsed.organizationId,
  );

  if (!policy.canCreateProject(membership.role)) {
    throw new ForbiddenError("You cannot create projects in this workspace.");
  }

  const existing = await ctx.db
    .select({ id: project.id })
    .from(project)
    .where(
      and(
        eq(project.organizationId, parsed.organizationId),
        eq(project.slug, parsed.slug),
      ),
    )
    .limit(1);

  if (existing[0]) {
    throw new ConflictError(
      `A project with the slug "${parsed.slug}" already exists in this workspace.`,
    );
  }

  const inserted = await ctx.db
    .insert(project)
    .values({
      organizationId: parsed.organizationId,
      name: parsed.name,
      slug: parsed.slug,
      createdById: ctx.userId,
    })
    .returning();

  const created = inserted[0];
  if (!created) {
    throw new Error("Project insert returned no row.");
  }

  return created;
}

export async function deleteProject(
  ctx: Ctx,
  organizationId: string,
  projectId: string,
) {
  const membership = await assertMemberOfOrganization(ctx, organizationId);

  if (!policy.canDeleteProject(membership.role)) {
    throw new ForbiddenError("You cannot delete projects in this workspace.");
  }

  const deleted = await ctx.db
    .delete(project)
    .where(
      and(eq(project.id, projectId), eq(project.organizationId, organizationId)),
    )
    .returning({ id: project.id });

  if (!deleted[0]) {
    throw new NotFoundError("Project not found.");
  }

  return deleted[0];
}
