import {
  EmptyState,
  PageContainer,
  PageHeader,
  Surface,
  WorkspaceMark,
} from "@bracketx/ui";
import { ChevronRight, LayoutGrid } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "../../components/app-shell";
import { loadShellData } from "../session";
import { CreateWorkspaceDialog } from "./create-workspace-dialog";

export const metadata: Metadata = { title: "Workspaces" };

// Session-dependent: never statically rendered or cached across users.
export const dynamic = "force-dynamic";

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const { new: openNew } = await searchParams;
  const { user, workspaces } = await loadShellData();

  return (
    <AppShell user={user}>
      <PageContainer className="max-w-3xl">
        <PageHeader
          title="Workspaces"
          description="A workspace holds your projects, brand assets, and team."
          actions={
            workspaces.length > 0 ? (
              <CreateWorkspaceDialog defaultOpen={openNew === "1"} />
            ) : undefined
          }
        />

        {workspaces.length === 0 ? (
          <Surface>
            <EmptyState
              icon={<LayoutGrid />}
              title="No workspaces yet"
              description="Create one to start building graphics. You can add teammates later."
              action={<CreateWorkspaceDialog defaultOpen={openNew === "1"} />}
            />
          </Surface>
        ) : (
          <ul className="flex flex-col gap-2">
            {workspaces.map((workspace) => (
              <li key={workspace.id}>
                <Link
                  href={`/w/${workspace.slug}`}
                  className={[
                    "group flex items-center gap-3 rounded-lg border px-4 py-3",
                    "border-line bg-surface transition-colors",
                    "hover:border-line-strong hover:bg-surface-2",
                  ].join(" ")}
                >
                  <WorkspaceMark name={workspace.name} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {workspace.name}
                    </p>
                    <p className="truncate font-mono text-xs text-fg-subtle">
                      /{workspace.slug}
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
