"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export interface DialogContentProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * A modal dialog.
 *
 * Radix supplies the focus trap, scroll lock, Escape handling, and
 * `aria-labelledby`/`aria-describedby` wiring — all of which are easy to
 * hand-roll incorrectly and expensive to discover missing.
 *
 * `title` is required, not optional: a dialog without an accessible name is
 * announced as an unnamed group.
 */
export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-canvas/75 backdrop-blur-[2px]",
          "animate-fade-in",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md",
          "-translate-x-1/2 -translate-y-1/2 animate-scale-in",
          "rounded-xl border border-line bg-surface shadow-modal",
          "focus:outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="text-base font-semibold text-fg">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-sm text-fg-muted">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>

          <DialogPrimitive.Close
            aria-label="Close"
            className={cn(
              "-mr-1 -mt-1 rounded-md p-1.5 text-fg-subtle",
              "transition-colors hover:bg-surface-2 hover:text-fg",
            )}
          >
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
