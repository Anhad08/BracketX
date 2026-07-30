// Importing this from a client component is a build error, not a runtime
// surprise. It reaches the domain layer and therefore the database driver.
import "server-only";

import { isDomainError } from "@bracketx/core";
import { ZodError } from "zod";

import type { ActionState } from "./state";

/**
 * Turns anything thrown by the domain layer into something a form can render.
 *
 * Zod issues become per-field messages. Domain errors carry their own
 * user-facing message. Anything else is logged server-side and replaced with a
 * generic message — an unexpected error must never put a stack trace or SQL on
 * the page (ARCHITECTURE.md §7).
 */
export function toActionState(error: unknown): ActionState {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of error.issues) {
      const key = issue.path[0];
      if (typeof key === "string" && !fieldErrors[key]) {
        fieldErrors[key] = issue.message;
      }
    }
    return { fieldErrors, error: "Please fix the highlighted fields." };
  }

  if (isDomainError(error)) {
    return { error: error.message };
  }

  console.error("[action] unhandled error:", error);
  return { error: "Something went wrong. Please try again." };
}
