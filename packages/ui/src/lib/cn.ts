import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names, letting later Tailwind utilities win over earlier ones.
 *
 * Without the merge step, a caller passing `px-6` to a component whose base is
 * `px-3` gets both and the outcome depends on stylesheet order rather than on
 * what they asked for.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
