import { z } from "zod";

/**
 * Every input crosses one of these before reaching domain logic
 * (ARCHITECTURE.md ADR-005). Types are inferred from the schemas rather than
 * declared alongside them, so the two cannot drift.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const slugSchema = z
  .string()
  .min(2, "Must be at least 2 characters.")
  .max(48, "Must be 48 characters or fewer.")
  .regex(
    SLUG_PATTERN,
    "Use lowercase letters, numbers, and single hyphens between them.",
  );

export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(100, "Must be 100 characters or fewer.");

export const createWorkspaceSchema = z.object({
  name: nameSchema,
  slug: slugSchema,
});

export const createProjectSchema = z.object({
  /**
   * Note: `organizationId` is accepted here for validation shape only. Callers
   * must never pass a client-supplied value straight through — membership is
   * re-derived from the session server-side (ARCHITECTURE.md §7).
   */
  organizationId: z.string().min(1),
  name: nameSchema,
  slug: slugSchema,
});

export const projectIdSchema = z.string().min(1);

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
