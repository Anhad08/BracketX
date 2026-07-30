import { describe, expect, it } from "vitest";

import type { Ctx } from "./context";
import { ForbiddenError, NotFoundError } from "./errors";
import { assertMemberOfOrganization, resolveActiveWorkspace } from "./workspaces";

/**
 * A minimal stand-in for the Drizzle query builder.
 *
 * These tests exist to pin the tenant-isolation rules, which are pure decision
 * logic sitting on top of one query. Faking the builder keeps them fast and
 * dependency-free; the queries themselves get integration coverage once a
 * Postgres instance is available in CI.
 */
function fakeDb(rows: unknown[]): Ctx["db"] {
  const settled = Promise.resolve(rows);
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => chain,
    then: (...args: Parameters<Promise<unknown>["then"]>) =>
      settled.then(...args),
  });
  return { select: () => chain } as unknown as Ctx["db"];
}

function ctx(rows: unknown[], overrides: Partial<Ctx> = {}): Ctx {
  return {
    db: fakeDb(rows),
    userId: "user_alice",
    activeOrganizationId: null,
    ...overrides,
  };
}

/** Runs a promise and returns whatever it threw, or undefined if it resolved. */
async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error;
  }
}

const ALICE_IN_ACME = {
  organizationId: "org_acme",
  userId: "user_alice",
  role: "owner",
};

describe("assertMemberOfOrganization", () => {
  it("returns the membership when the user belongs to the workspace", async () => {
    const membership = await assertMemberOfOrganization(
      ctx([ALICE_IN_ACME]),
      "org_acme",
    );
    expect(membership).toEqual(ALICE_IN_ACME);
  });

  it("throws NotFoundError when the user is not a member", async () => {
    await expect(
      assertMemberOfOrganization(ctx([]), "org_acme"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws 404, never 403, for a workspace owned by someone else", async () => {
    // Phase 0 exit criterion 3. A 403 would confirm the workspace exists,
    // letting an outsider enumerate real workspaces. This assertion is the
    // regression guard for that leak.
    const error = await captureError(
      assertMemberOfOrganization(ctx([]), "org_belonging_to_bob"),
    );

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).not.toBeInstanceOf(ForbiddenError);
    expect((error as NotFoundError).httpStatus).toBe(404);
  });

  it("does not leak the workspace id in the error message", async () => {
    const error = await captureError(
      assertMemberOfOrganization(ctx([]), "org_secret_customer"),
    );

    expect((error as Error).message).not.toContain("org_secret_customer");
  });
});

describe("resolveActiveWorkspace", () => {
  it("returns null when no workspace is selected", async () => {
    expect(await resolveActiveWorkspace(ctx([ALICE_IN_ACME]))).toBeNull();
  });

  it("returns the membership when the active workspace is still valid", async () => {
    const membership = await resolveActiveWorkspace(
      ctx([ALICE_IN_ACME], { activeOrganizationId: "org_acme" }),
    );
    expect(membership).toEqual(ALICE_IN_ACME);
  });

  it("returns null for a stale activeOrganizationId instead of throwing", async () => {
    // session.activeOrganizationId has no foreign key in Better Auth's schema,
    // so it outlives a deleted organization and survives the user being
    // removed from one. Trusting it would grant access to a workspace the user
    // no longer belongs to; throwing would break the workspace picker.
    const membership = await resolveActiveWorkspace(
      ctx([], { activeOrganizationId: "org_deleted_or_revoked" }),
    );
    expect(membership).toBeNull();
  });
});
