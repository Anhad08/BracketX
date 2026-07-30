"use client";

import { Slot, Slottable } from "@radix-ui/react-slot";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "./lib/cn";
import { Spinner } from "./spinner";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger"
  | "link";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-strong active:bg-accent " +
    "disabled:hover:bg-accent",
  secondary:
    "bg-surface-2 text-fg border border-line hover:bg-overlay " +
    "hover:border-line-strong disabled:hover:bg-surface-2",
  ghost:
    "bg-transparent text-fg-muted hover:bg-surface-2 hover:text-fg " +
    "disabled:hover:bg-transparent",
  danger:
    "bg-danger text-danger-fg hover:bg-danger-strong disabled:hover:bg-danger",
  link: "bg-transparent text-accent underline-offset-4 hover:underline p-0 h-auto",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
  icon: "h-9 w-9 p-0",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders the child element instead of a <button>, e.g. to wrap a Link. */
  asChild?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
}

export function Button({
  className,
  variant = "secondary",
  size = "md",
  asChild = false,
  loading = false,
  leadingIcon,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      // A loading button that stays clickable submits twice. Disable on both.
      disabled={disabled || loading}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-medium",
        "whitespace-nowrap transition-colors duration-100",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {/*
        Slottable marks which child `asChild` should merge into. Without it,
        React.Children.count sees the icon slot even when it renders nothing,
        so Slot receives two children and throws "Expected a single React
        element child" — meaning every asChild button without an icon breaks.
      */}
      {loading ? <Spinner /> : leadingIcon}
      <Slottable>{children}</Slottable>
    </Component>
  );
}
