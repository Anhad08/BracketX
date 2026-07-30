"use server";

import { createWorkspace } from "@bracketx/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { toActionState } from "./errors";
import type { ActionState } from "./state";

/**
 * Creates a workspace and sends the user into it.
 *
 * All the real work — validation, the Better Auth organization call, creating
 * the owner membership — is in @bracketx/core. This function only reads the
 * form, calls core, and decides where to navigate (ARCHITECTURE.md §4).
 */
export async function createWorkspaceAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let slug: string;

  try {
    const workspace = await createWorkspace(
      {
        name: formData.get("name"),
        slug: formData.get("slug"),
      },
      await headers(),
    );
    slug = workspace.slug;
  } catch (error) {
    return toActionState(error);
  }

  revalidatePath("/workspaces");
  redirect(`/w/${slug}`);
}
