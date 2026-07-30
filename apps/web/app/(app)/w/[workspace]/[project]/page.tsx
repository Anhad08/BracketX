import { getProject, getWorkspaceBySlug } from "@bracketx/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EditorShell } from "../../../../components/editor-shell";
import { loadShellData } from "../../../session";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspace: string; project: string }>;
}): Promise<Metadata> {
  const { project } = await params;
  return { title: project };
}

export default async function EditorPage({
  params,
}: {
  params: Promise<{ workspace: string; project: string }>;
}) {
  const { workspace: workspaceSlug, project: projectSlug } = await params;
  const { ctx } = await loadShellData();

  let workspace;
  let project;
  try {
    workspace = await getWorkspaceBySlug(ctx, workspaceSlug);
    project = await getProject(ctx, workspace.id, projectSlug);
  } catch {
    notFound();
  }

  return (
    <EditorShell
      workspaceSlug={workspace.slug}
      workspaceName={workspace.name}
      projectName={project.name}
    >
      <div className="flex h-full items-center justify-center p-8">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          {/*
            A 16:9 stand-in for the broadcast frame. Not a canvas and not
            pretending to be one — the rendering technology is gate G1, which
            has to be decided before Phase 2 designs the scene format.
          */}
          <div
            className={[
              "mb-2 flex aspect-video w-full max-w-sm items-center",
              "justify-center rounded-lg border border-dashed border-line-strong",
              "bg-surface/40",
            ].join(" ")}
          >
            <span className="font-mono text-2xs text-fg-subtle">
              1920 × 1080
            </span>
          </div>

          <h2 className="text-sm font-semibold text-fg">
            The editor lands in Phase 2
          </h2>
          <p className="text-sm text-fg-muted">
            The shell, routing, and permissions are done. The canvas needs the
            scene document format first — building it before that means
            rebuilding it after.
          </p>
        </div>
      </div>
    </EditorShell>
  );
}
