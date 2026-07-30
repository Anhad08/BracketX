import { describe, expect, it } from "vitest";

import { KNOWN_ROLES, can, isKnownRole, parseRoles, policy } from "./policy";

describe("parseRoles", () => {
  it("reads a single role", () => {
    expect(parseRoles("owner")).toEqual(["owner"]);
  });

  it("splits the comma-separated form Better Auth stores", () => {
    expect(parseRoles("admin,member")).toEqual(["admin", "member"]);
  });

  it("tolerates whitespace around entries", () => {
    expect(parseRoles(" admin , member ")).toEqual(["admin", "member"]);
  });

  it("returns empty for null, undefined, and empty string", () => {
    expect(parseRoles(null)).toEqual([]);
    expect(parseRoles(undefined)).toEqual([]);
    expect(parseRoles("")).toEqual([]);
  });

  it("drops empty segments from a trailing or doubled comma", () => {
    expect(parseRoles("owner,,")).toEqual(["owner"]);
  });
});

describe("isKnownRole", () => {
  it("accepts the three configured roles", () => {
    expect(KNOWN_ROLES.slice().sort()).toEqual(["admin", "member", "owner"]);
    for (const role of KNOWN_ROLES) expect(isKnownRole(role)).toBe(true);
  });

  it("rejects unknown roles", () => {
    expect(isKnownRole("operator")).toBe(false);
    expect(isKnownRole("")).toBe(false);
  });

  it("is not fooled by inherited Object properties", () => {
    // `roles` is a plain object; a naive `roles[role] !== undefined` check
    // would treat these as valid and grant permissions off Object.prototype.
    expect(isKnownRole("constructor")).toBe(false);
    expect(isKnownRole("toString")).toBe(false);
    expect(isKnownRole("__proto__")).toBe(false);
  });
});

describe("can — fails closed", () => {
  it("denies when no role is held", () => {
    expect(can(null, { project: ["read"] })).toBe(false);
    expect(can("", { project: ["read"] })).toBe(false);
  });

  it("denies for an unknown role rather than throwing", () => {
    expect(() => can("operator", { project: ["read"] })).not.toThrow();
    expect(can("operator", { project: ["read"] })).toBe(false);
  });

  it("ignores unknown roles but honours known ones alongside them", () => {
    expect(can("operator,owner", { project: ["delete"] })).toBe(true);
  });

  it("denies prototype-pollution style role strings", () => {
    expect(can("__proto__", { project: ["read"] })).toBe(false);
    expect(can("constructor", { project: ["delete"] })).toBe(false);
  });
});

describe("project permissions by role", () => {
  it("owner can do everything to projects", () => {
    expect(policy.canCreateProject("owner")).toBe(true);
    expect(policy.canReadProject("owner")).toBe(true);
    expect(policy.canUpdateProject("owner")).toBe(true);
    expect(policy.canDeleteProject("owner")).toBe(true);
  });

  it("admin can do everything to projects", () => {
    expect(policy.canCreateProject("admin")).toBe(true);
    expect(policy.canReadProject("admin")).toBe(true);
    expect(policy.canUpdateProject("admin")).toBe(true);
    expect(policy.canDeleteProject("admin")).toBe(true);
  });

  it("member is read-only on projects", () => {
    expect(policy.canReadProject("member")).toBe(true);
    expect(policy.canCreateProject("member")).toBe(false);
    expect(policy.canUpdateProject("member")).toBe(false);
    expect(policy.canDeleteProject("member")).toBe(false);
  });
});

describe("workspace permissions by role", () => {
  it("only owner may delete the workspace", () => {
    expect(policy.canDeleteWorkspace("owner")).toBe(true);
    expect(policy.canDeleteWorkspace("admin")).toBe(false);
    expect(policy.canDeleteWorkspace("member")).toBe(false);
  });

  it("owner and admin may invite; member may not", () => {
    expect(policy.canInviteMember("owner")).toBe(true);
    expect(policy.canInviteMember("admin")).toBe(true);
    expect(policy.canInviteMember("member")).toBe(false);
  });
});

describe("multiple roles are additive", () => {
  it("takes the union of permissions across held roles", () => {
    // member alone cannot delete; owner can. Holding both should allow it.
    expect(policy.canDeleteProject("member")).toBe(false);
    expect(policy.canDeleteProject("member,owner")).toBe(true);
  });
});
