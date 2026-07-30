"use client";

import * as Primitive from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";

import { cn } from "./lib/cn";

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;

export function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-[12rem] overflow-hidden rounded-lg p-1",
          "border border-line bg-overlay shadow-popover",
          "animate-slide-down",
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: React.ComponentProps<typeof Primitive.Item> & { destructive?: boolean }) {
  return (
    <Primitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md",
        "px-2 py-1.5 text-sm text-fg-muted outline-none",
        // Radix drives highlight via data-highlighted, which follows both
        // pointer and keyboard — so arrow-key navigation looks identical to
        // hover instead of only working for the mouse.
        "data-highlighted:bg-surface-2 data-highlighted:text-fg",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        destructive && "text-danger data-highlighted:text-danger",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Primitive.CheckboxItem>) {
  return (
    <Primitive.CheckboxItem
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md",
        "py-1.5 pl-2 pr-2 text-sm text-fg-muted outline-none",
        "data-highlighted:bg-surface-2 data-highlighted:text-fg",
        className,
      )}
      {...props}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check className="size-3.5 text-accent" />
        </Primitive.ItemIndicator>
      </span>
      {children}
    </Primitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn(
        "px-2 py-1.5 text-2xs font-semibold uppercase tracking-wider",
        "text-fg-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Separator>) {
  return (
    <Primitive.Separator
      className={cn("-mx-1 my-1 h-px bg-line", className)}
      {...props}
    />
  );
}
