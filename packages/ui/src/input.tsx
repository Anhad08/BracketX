"use client";

import type { InputHTMLAttributes } from "react";

import { cn } from "./lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "h-9 w-full rounded-md border bg-canvas px-3 text-sm text-fg",
        "border-line placeholder:text-fg-subtle",
        "transition-colors duration-100",
        "hover:border-line-strong",
        "focus:border-accent focus:outline-none focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        // Driven by aria-invalid so the error style cannot drift out of sync
        // with what assistive technology is told.
        "aria-invalid:border-danger aria-invalid:focus:border-danger",
        className,
      )}
      {...props}
    />
  );
}
