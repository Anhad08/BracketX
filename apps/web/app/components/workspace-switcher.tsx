"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  WorkspaceMark,
} from "@bracketx/ui";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import Link from "next/link";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
};

export function WorkspaceSwitcher({
  current,
  workspaces,
}: {
  current: WorkspaceSummary;
  workspaces: WorkspaceSummary[];
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={[
          "flex h-8 items-center gap-2 rounded-md px-2 text-sm",
          "text-fg transition-colors hover:bg-surface-2",
        ].join(" ")}
      >
        <WorkspaceMark name={current.name} />
        <span className="max-w-[12rem] truncate font-medium">
          {current.name}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" />
      </DropdownMenuTrigger>

      <DropdownMenuContent className="min-w-[15rem]">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>

        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} asChild>
            <Link href={`/w/${workspace.slug}`}>
              <WorkspaceMark name={workspace.name} />
              <span className="truncate">{workspace.name}</span>
              {workspace.id === current.id ? (
                <Check className="ml-auto text-accent" />
              ) : null}
            </Link>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/workspaces?new=1">
            <Plus />
            New workspace
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
