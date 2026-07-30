import { connect, resetDatabase } from "@bracketx/db/testing";
import { and, eq, member, organization, project, user } from "@bracketx/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Ctx } from "./context";
import { NotFoundError } from "./errors";
import { createProject, getProject, listProjects } from "./projects";
import { assertMemberOfOrganization, listWorkspacesForUser } from "./workspaces";

/**
 * The Golden Path, run against a real PostgreSQL server.
 *
 *   create user -> create workspace -> create project -> fetch project
 *   -> delete user -> project still exists
 *
 * The last two steps are the point. `project.created_by_id` is ON DELETE SET
 * NULL rather than CASCADE because a project belongs to the workspace, not to
 * whoever happened to create it. Deleting a departing employee must not delete
 * their team's work. That is a claim about database behaviour, so only a real
 * database can prove it.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required. Run via: pnpm --filter @bracketx/core test:integration",
  );
}

const { db, pool } = connect(url);

/** Fixtures are inserted directly: this suite tests data behaviour, not auth. */
async function createUser(id: string, email: string) {
  const now = new Date();
  await db.insert(user).values({
    id,
    name: id,
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function createWorkspace(id: string, slug: string, ownerId: string) {
  await db.insert(organization).values({
    id,
    name: slug,
    slug,
    createdAt: new Date(),
  });
  await db.insert(member).values({
    id: `mem_${id}_${ownerId}`,
    organizationId: id,
    userId: ownerId,
    role: "owner",
    createdAt: new Date(),
  });
  return id;
}

function ctxFor(userId: string, activeOrganizationId: string | null = null): Ctx {
  return { db, userId, activeOrganizationId };
}

/**
 * Digs the PostgreSQL SQLSTATE out of a Drizzle error.
 *
 * Drizzle wraps driver errors in its own "Failed query: ..." Error and hangs
 * the original off `cause`, so matching on message text tests the wrapper
 * rather than the database. SQLSTATE codes are stable and exact.
 */
function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 10; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^\d{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function sqlStateOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return sqlState(error);
  }
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

beforeAll(async () => {
  await resetDatabase(db);
});

beforeEach(async () => {
  await resetDatabase(db);
});

afterAll(async () => {
  await pool.end();
});

describe("Golden Path", () => {
  it("carries a user from sign-up through to a project that outlives them", async () => {
    // 1. Create User
    const alice = await createUser("user_alice", "alice@bracketx.test");

    const users = await db.select().from(user).where(eq(user.id, alice));
    expect(users).toHaveLength(1);
    expect(users[0]!.email).toBe("alice@bracketx.test");

    // 2. Create Workspace
    const acme = await createWorkspace("org_acme", "acme", alice);

    const workspaces = await listWorkspacesForUser(ctxFor(alice));
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]).toMatchObject({ slug: "acme", role: "owner" });

    // 3. Create Project
    const created = await createProject(ctxFor(alice), {
      organizationId: acme,
      name: "Season Opener",
      slug: "season-opener",
    });

    expect(created.name).toBe("Season Opener");
    expect(created.organizationId).toBe(acme);
    expect(created.createdById).toBe(alice);
    expect(created.id).toBeTruthy();
    expect(created.createdAt).toBeInstanceOf(Date);

    // 4. Fetch Project
    const fetched = await getProject(ctxFor(alice), acme, "season-opener");
    expect(fetched.id).toBe(created.id);
    expect(fetched.name).toBe("Season Opener");

    // 5. Delete User
    await db.delete(user).where(eq(user.id, alice));
    expect(await db.select().from(user).where(eq(user.id, alice))).toHaveLength(
      0,
    );

    // 6. Verify Project still exists — with authorship released, not the row.
    const survivors = await db
      .select()
      .from(project)
      .where(eq(project.id, created.id));

    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.name).toBe("Season Opener");
    expect(survivors[0]!.organizationId).toBe(acme);
    expect(survivors[0]!.createdById).toBeNull(); // ON DELETE SET NULL

    // The workspace itself is untouched by the user's deletion.
    const orgs = await db
      .select()
      .from(organization)
      .where(eq(organization.id, acme));
    expect(orgs).toHaveLength(1);
  });

  it("removes the membership when the user is deleted, but not the workspace", async () => {
    const alice = await createUser("user_alice", "alice@bracketx.test");
    const acme = await createWorkspace("org_acme", "acme", alice);

    expect(
      await db.select().from(member).where(eq(member.organizationId, acme)),
    ).toHaveLength(1);

    await db.delete(user).where(eq(user.id, alice));

    // member cascades (it is a link row and meaningless without the user)...
    expect(
      await db.select().from(member).where(eq(member.organizationId, acme)),
    ).toHaveLength(0);
    // ...but the workspace does not.
    expect(
      await db.select().from(organization).where(eq(organization.id, acme)),
    ).toHaveLength(1);
  });

  it("cascades projects when the workspace itself is deleted", async () => {
    const alice = await createUser("user_alice", "alice@bracketx.test");
    const acme = await createWorkspace("org_acme", "acme", alice);
    await createProject(ctxFor(alice), {
      organizationId: acme,
      name: "Doomed",
      slug: "doomed",
    });

    await db.delete(organization).where(eq(organization.id, acme));

    // Deleting a workspace must not strand its projects.
    expect(
      await db.select().from(project).where(eq(project.organizationId, acme)),
    ).toHaveLength(0);
  });
});

describe("tenant isolation against a real database", () => {
  it("hides another workspace's project behind a 404", async () => {
    const alice = await createUser("user_alice", "alice@bracketx.test");
    const bob = await createUser("user_bob", "bob@bracketx.test");
    const acme = await createWorkspace("org_acme", "acme", alice);
    await createWorkspace("org_globex", "globex", bob);

    await createProject(ctxFor(alice), {
      organizationId: acme,
      name: "Secret",
      slug: "secret",
    });

    // Bob is a real, authenticated user — just not a member of Acme.
    await expect(
      getProject(ctxFor(bob), acme, "secret"),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(
      assertMemberOfOrganization(ctxFor(bob), acme),
    ).rejects.toBeInstanceOf(NotFoundError);

    await expect(listProjects(ctxFor(bob), acme)).rejects.toBeInstanceOf(
      NotFoundError,
    );

    expect(await listWorkspacesForUser(ctxFor(bob))).toHaveLength(1);
  });

  it("scopes identical project slugs per workspace", async () => {
    const alice = await createUser("user_alice", "alice@bracketx.test");
    const bob = await createUser("user_bob", "bob@bracketx.test");
    const acme = await createWorkspace("org_acme", "acme", alice);
    const globex = await createWorkspace("org_globex", "globex", bob);

    // The same slug in two workspaces is legal and must not collide.
    const a = await createProject(ctxFor(alice), {
      organizationId: acme,
      name: "Finals",
      slug: "finals",
    });
    const b = await createProject(ctxFor(bob), {
      organizationId: globex,
      name: "Finals",
      slug: "finals",
    });

    expect(a.id).not.toBe(b.id);

    // Each side sees only its own, proving the query filters on organizationId
    // and not on slug alone.
    expect((await getProject(ctxFor(alice), acme, "finals")).id).toBe(a.id);
    expect((await getProject(ctxFor(bob), globex, "finals")).id).toBe(b.id);
  });

  it("rejects a duplicate slug within one workspace", async () => {
    const alice = await createUser("user_alice", "alice@bracketx.test");
    const acme = await createWorkspace("org_acme", "acme", alice);

    await createProject(ctxFor(alice), {
      organizationId: acme,
      name: "Finals",
      slug: "finals",
    });

    await expect(
      createProject(ctxFor(alice), {
        organizationId: acme,
        name: "Finals Again",
        slug: "finals",
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it("refuses to create a project in a workspace the caller does not belong to", async () => {
    const alice = await createUser("user_alice", "alice@bracketx.test");
    const bob = await createUser("user_bob", "bob@bracketx.test");
    const acme = await createWorkspace("org_acme", "acme", alice);

    await expect(
      createProject(ctxFor(bob), {
        organizationId: acme,
        name: "Trojan",
        slug: "trojan",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Nothing was written before the membership check ran.
    expect(
      await db.select().from(project).where(eq(project.organizationId, acme)),
    ).toHaveLength(0);
  });
});

describe("database constraints hold", () => {
  it("enforces the composite unique at the database level", async () => {
    const alice = await createUser("user_alice", "alice@bracketx.test");
    const acme = await createWorkspace("org_acme", "acme", alice);

    await db.insert(project).values({
      id: "proj_1",
      organizationId: acme,
      name: "One",
      slug: "dupe",
    });

    // Bypasses the application's pre-check entirely — this is the constraint
    // itself talking, which is what must hold under a race.
    expect(
      await sqlStateOf(
        db.insert(project).values({
          id: "proj_2",
          organizationId: acme,
          name: "Two",
          slug: "dupe",
        }),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it("enforces globally unique organization slugs", async () => {
    const alice = await createUser("user_alice", "alice@bracketx.test");
    await createWorkspace("org_acme", "acme", alice);

    // Documented consequence of Better Auth's schema: workspace slugs are
    // first-come-first-served across all customers.
    expect(
      await sqlStateOf(
        db.insert(organization).values({
          id: "org_other",
          name: "Acme Rival",
          slug: "acme",
          createdAt: new Date(),
        }),
      ),
    ).toBe(UNIQUE_VIOLATION);
  });

  it("refuses a project pointing at a non-existent workspace", async () => {
    expect(
      await sqlStateOf(
        db.insert(project).values({
          id: "proj_orphan",
          organizationId: "org_does_not_exist",
          name: "Orphan",
          slug: "orphan",
        }),
      ),
    ).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("stores timestamps as timestamptz and round-trips them", async () => {
    const alice = await createUser("user_alice", "alice@bracketx.test");
    const acme = await createWorkspace("org_acme", "acme", alice);

    const created = await createProject(ctxFor(alice), {
      organizationId: acme,
      name: "Timed",
      slug: "timed",
    });

    const rows = await db
      .select()
      .from(project)
      .where(and(eq(project.id, created.id), eq(project.slug, "timed")));

    const row = rows[0]!;
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(Number.isNaN(row.createdAt.getTime())).toBe(false);
    // Within a minute of now — proves the DB default fired and no timezone
    // shift occurred on the way back out.
    expect(Math.abs(Date.now() - row.createdAt.getTime())).toBeLessThan(60_000);
  });
});
