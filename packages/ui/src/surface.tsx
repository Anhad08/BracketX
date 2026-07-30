import type { ReactNode } from "react";

import { cn } from "./lib/cn";

/**
 * The single panel primitive. Cards, panels, and list containers are all this,
 * so their border, radius, and background can never drift apart.
 */
export function Surface({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface shadow-panel",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SurfaceHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 border-b border-line px-4 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SurfaceBody({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("p-4", className)}>{children}</div>;
}
