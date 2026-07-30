"use client";

import * as LabelPrimitive from "@radix-ui/react-label";
import { useId, type ReactNode } from "react";

import { cn } from "./lib/cn";

export function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        "text-sm font-medium text-fg-muted select-none",
        "peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export interface FieldProps {
  label: string;
  /** Rendered by a function so the control receives the generated ids. */
  children: (props: {
    id: string;
    "aria-describedby": string | undefined;
    "aria-invalid": true | undefined;
  }) => ReactNode;
  hint?: string;
  error?: string;
  className?: string;
}

/**
 * A labelled form control with hint and error text.
 *
 * The wiring of `id` / `aria-describedby` / `aria-invalid` lives here so no
 * individual form can forget it. Getting this right once is the reason forms
 * across BracketX are accessible by default rather than by review.
 */
export function Field({ label, children, hint, error, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>

      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })}

      {hint && !error && (
        <p id={hintId} className="text-xs text-fg-subtle">
          {hint}
        </p>
      )}

      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/** Form-level error, for failures that belong to no single field. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-md border border-danger/40 bg-danger/10 px-3 py-2",
        "text-sm text-danger",
      )}
    >
      {children}
    </div>
  );
}
