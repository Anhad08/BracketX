import type { ReactNode } from "react";

import { cn } from "./lib/cn";

export type BadgeTone = "neutral" | "accent" | "live" | "success" | "warning";

const TONES: Record<BadgeTone, string> = {
  neutral: "border-line bg-surface-2 text-fg-muted",
  accent: "border-accent/40 bg-accent-soft text-fg",
  // Reserved for on-air state. See the note in styles.css.
  live: "border-live/50 bg-live/15 text-live",
  success: "border-success/40 bg-success/12 text-success",
  warning: "border-warning/40 bg-warning/12 text-warning",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
        "text-2xs font-medium",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
