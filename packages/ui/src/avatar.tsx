"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "./lib/cn";

/** Up to two initials. More than that stops being legible at 32px. */
export function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export interface AvatarProps {
  name: string;
  src?: string | null;
  className?: string;
}

export function Avatar({ name, src, className }: AvatarProps) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex size-7 shrink-0 select-none items-center",
        "justify-center overflow-hidden rounded-full bg-surface-2",
        className,
      )}
    >
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt=""
          className="size-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        className={cn(
          "flex size-full items-center justify-center",
          "text-2xs font-semibold text-fg-muted",
        )}
      >
        {initialsFrom(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/**
 * Workspace mark. Square rather than round so a workspace is never mistaken
 * for a person at a glance in the switcher.
 */
export function WorkspaceMark({ name, className }: AvatarProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-sm",
        "bg-accent-soft text-2xs font-bold text-fg",
        className,
      )}
    >
      {initialsFrom(name).slice(0, 2)}
    </span>
  );
}
