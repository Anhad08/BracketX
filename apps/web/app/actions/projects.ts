"use server";

import { createProject, getWorkspaceBySlug, requireSession } from "@bracketx/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { toActionState } from "./errors";
import type { ActionState } from "./state";

export async function createProjectAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workspaceSlug = String(formData.get("workspaceSlug") ?? "");
  let projectSlug: string;

  try {
    const ctx = await requireSession(await headers());

    // The slug from the form is only a lookup key. getWorkspaceBySlug asserts
    // membership and 404s otherwise, so a forged value cannot reach into
    // another tenant's workspace.
    const workspace = await getWorkspaceBySlug(ctx, workspaceSlug);

    const project = await createProject(ctx, {
      organizationId: workspace.id,
      name: formData.get("name"),
      slug: formData.get("slug"),
    });

    projectSlug = project.slug;
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath(`/w/${workspaceSlug}`);
  redirect(`/w/${workspaceSlug}/${projectSlug}`);
}
