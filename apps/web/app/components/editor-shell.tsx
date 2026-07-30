import { Badge, Button, Separator } from "@bracketx/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "./brand";

/**
 * Editor chrome: a full-height, non-scrolling frame with fixed panel regions.
 *
 * Separate from AppShell rather than a variant of it, because the two have
 * opposite jobs. The dashboard is a scrolling document with a comfortable
 * max width; the editor is a fixed viewport where the centre region is the
 * only thing that ever scrolls, so the canvas can own its space.
 *
 * The regions are laid out now and left empty on purpose — Phase 2 fills the
 * left and right rails, Phases 3–5 fill the centre. Establishing the frame
 * first means none of that work has to negotiate with layout later.
 */
export function EditorShell({
  workspaceSlug,
  workspaceName,
  projectName,
  left,
  right,
  children,
}: {
  workspaceSlug: string;
  workspaceName: string;
  projectName: string;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      {/* Top bar */}
      <header
        className={[
          "flex h-12 shrink-0 items-center gap-3 border-b border-line",
          "bg-surface px-3",
        ].join(" ")}
      >
        <Button
          asChild
          variant="ghost"
          size="icon"
          aria-label={`Back to ${workspaceName}`}
        >
          <Link href={`/w/${workspaceSlug}`}>
            <ArrowLeft />
          </Link>
        </Button>

        <Separator orientation="vertical" className="h-5" decorative />

        <Logo className="text-sm" />

        <Separator orientation="vertical" className="h-5" decorative />

        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-fg">
            {projectName}
          </span>
          <Badge>Draft</Badge>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {/*
            Reserved for the on-air indicator and Take controls. Not a live
            product yet, so nothing here claims to be one — a fake "On Air"
            badge in a broadcast tool is worse than an empty toolbar.
          */}
          <Button size="sm" variant="secondary" disabled>
            Preview
          </Button>
          <Button size="sm" variant="primary" disabled>
            Go live
          </Button>
        </div>
      </header>

      {/* Body: rail · canvas · inspector */}
      <div className="flex min-h-0 flex-1">
        <aside
          className={[
            "hidden w-60 shrink-0 flex-col border-r border-line",
            "bg-surface md:flex",
          ].join(" ")}
        >
          {left ?? <RailPlaceholder label="Scenes" phase="Phase 2" />}
        </aside>

        {/* The only scrollable region. */}
        <div className="min-w-0 flex-1 overflow-auto">{children}</div>

        <aside
          className={[
            "hidden w-72 shrink-0 flex-col border-l border-line",
            "bg-surface lg:flex",
          ].join(" ")}
        >
          {right ?? <RailPlaceholder label="Inspector" phase="Phase 2" />}
        </aside>
      </div>

      {/* Status bar */}
      <footer
        className={[
          "flex h-7 shrink-0 items-center gap-3 border-t border-line",
          "bg-surface px-3 text-2xs text-fg-subtle",
        ].join(" ")}
      >
        <span>{workspaceName}</span>
        <span aria-hidden>/</span>
        <span className="text-fg-muted">{projectName}</span>
        <span className="ml-auto font-mono">1920 × 1080 · 60fps</span>
      </footer>
    </div>
  );
}

function RailPlaceholder({ label, phase }: { label: string; phase: string }) {
  return (
    <>
      <div
        className={[
          "flex h-9 shrink-0 items-center border-b border-line px-3",
          "text-2xs font-semibold uppercase tracking-wider text-fg-subtle",
        ].join(" ")}
      >
        {label}
      </div>
      <div className="flex flex-1 items-center justify-center p-4">
        <p className="text-center text-xs text-fg-subtle">{phase}</p>
      </div>
    </>
  );
}
