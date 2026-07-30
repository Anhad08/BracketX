import {
  EmptyState,
  PageContainer,
  PageHeader,
  Surface,
} from "@bracketx/ui";
import { getWorkspaceBySlug, listProjects } from "@bracketx/core";
import { ChevronRight, MonitorPlay } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "../../../components/app-shell";
import { loadShellData } from "../../session";
import { CreateProjectDialog } from "./create-project-dialog";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ workspace: string }>;
}): Promise<Metadata> {
  const { workspace } = await params;
  return { title: workspace };
}

export default async function ProjectsPage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace: slug } = await params;
  const { ctx, user, workspaces } = await loadShellData();

  // getWorkspaceBySlug asserts membership and throws NotFoundError for both a
  // missing workspace and one the user cannot see, so this single catch covers
  // "does not exist" and "not yours" identically — which is the point.
  let workspace;
  try {
    workspace = await getWorkspaceBySlug(ctx, slug);
  } catch {
    notFound();
  }

  const projects = await listProjects(ctx, workspace.id);

  return (
    <AppShell
      user={user}
      workspace={{
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
      }}
      workspaces={workspaces}
    >
      <PageContainer>
        <PageHeader
          title="Projects"
          description="Each project is one graphics package — a show, a season, or an event."
          actions={
            projects.length > 0 ? (
              <CreateProjectDialog workspaceSlug={workspace.slug} />
            ) : undefined
          }
        />

        {projects.length === 0 ? (
          <Surface>
            <EmptyState
              icon={<MonitorPlay />}
              title="No projects yet"
              description="Create your first project to open the editor."
              action={<CreateProjectDialog workspaceSlug={workspace.slug} />}
            />
          </Surface>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/w/${workspace.slug}/${project.slug}`}
                  className={[
                    "group flex h-full items-center gap-3 rounded-lg border",
                    "border-line bg-surface px-4 py-3.5 transition-colors",
                    "hover:border-line-strong hover:bg-surface-2",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {project.name}
                    </p>
                    <p className="truncate font-mono text-xs text-fg-subtle">
                      {project.slug}
                    </p>
                  </div>
                  <ChevronRight
                    className={[
                      "size-4 shrink-0 text-fg-subtle transition-colors",
                      "group-hover:text-fg-muted",
                    ].join(" ")}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PageContainer>
    </AppShell>
  );
}
