import { Separator } from "@bracketx/ui";
import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "./brand";
import { UserMenu } from "./user-menu";
import {
  WorkspaceSwitcher,
  type WorkspaceSummary,
} from "./workspace-switcher";

export type ShellUser = {
  name: string;
  email: string;
  image?: string | null;
};

/**
 * The chrome every signed-in dashboard screen lives inside.
 *
 * Pages render content, never their own navigation or page padding — that is
 * what keeps spacing and structure identical across screens instead of
 * per-page approximations of the same layout.
 *
 * The editor deliberately does not use this; see EditorShell.
 */
export function AppShell({
  user,
  workspace,
  workspaces,
  children,
}: {
  user: ShellUser;
  workspace?: WorkspaceSummary;
  workspaces?: WorkspaceSummary[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header
        className={[
          "sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 px-4",
          "border-b border-line bg-canvas/85 backdrop-blur-md",
        ].join(" ")}
      >
        <Link
          href="/workspaces"
          className="rounded-md px-1 py-0.5 text-sm"
          aria-label="BracketX home"
        >
          <Logo />
        </Link>

        {workspace && workspaces ? (
          <>
            <Separator
              orientation="vertical"
              className="h-5 bg-line-strong"
              decorative
            />
            <WorkspaceSwitcher current={workspace} workspaces={workspaces} />
          </>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          <UserMenu
            name={user.name}
            email={user.email}
            image={user.image ?? null}
          />
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
