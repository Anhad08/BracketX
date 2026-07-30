import { getSession } from "@bracketx/auth";
import { listWorkspacesForUser, requireSession } from "@bracketx/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Loads the signed-in user and their workspaces for the shell.
 *
 * The middleware only checks that a cookie exists; this is where the session is
 * actually validated against the database. Every signed-in page goes through
 * here, so an invalid or expired session cannot render protected chrome.
 */
export async function loadShellData() {
  const requestHeaders = await headers();
  const session = await getSession(requestHeaders);

  if (!session?.user) {
    redirect("/sign-in");
  }

  const ctx = await requireSession(requestHeaders);
  const workspaces = await listWorkspacesForUser(ctx);

  return {
    ctx,
    user: {
      name: session.user.name,
      email: session.user.email,
      image: session.user.image ?? null,
    },
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    })),
  };
}
