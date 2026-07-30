import type { ReactNode } from "react";

import { cn } from "./lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Shown wherever a collection is legitimately empty.
 *
 * Always paired with the action that resolves it — an empty list with no way
 * out is a dead end, and this is the first screen a new user sees.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 px-6 py-16 text-center",
        className,
      )}
    >
      {icon ? (
        <div
          className={cn(
            "mb-1 flex size-11 items-center justify-center rounded-lg",
            "border border-line bg-surface-2 text-fg-subtle",
            "[&_svg]:size-5",
          )}
        >
          {icon}
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description ? (
          <p className="max-w-sm text-sm text-fg-muted">{description}</p>
        ) : null}
      </div>

      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
