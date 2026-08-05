/**
 * The content surface, against the real engine.
 *
 * These tests apply the transactions this module produces through
 * `applyTransaction` and invert them through `invertTransaction` — the same
 * functions DocumentStore uses. Nothing here asserts on a mock, because the
 * whole claim being tested is that a beginner typing a name is an ordinary
 * engine operation and not a special case.
 */
import { describe, expect, it } from "vitest";
import {
  applyTransaction,
  generateKeyBetween,
  invertTransaction,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  type SceneDocument,
  type SceneVariable,
} from "@bracketx/engine-scene";

import {
  resetSurfaceValue,
  setSurfaceValue,
  setSurfaceValues,
  surfaceOf,
  surfaceValue,
  unsatisfied,
} from "./studio/surface";

const VARS: readonly SceneVariable[] = [
  { id: "var_name", key: "talent.name", type: "string", label: "", default: "Amara Okonkwo" },
  { id: "var_role", key: "talent.role", type: "string", label: "", default: "Chief Correspondent" },
  { id: "var_logo", key: "partnerMark", type: "string", label: "", default: null },
];

const TIME = "2026-01-01T00:00:00.000Z";

/**
 * A document with variables but no template declaration yet.
 *
 * Built here rather than imported from the engine's fixtures: those are that
 * package's test helpers, and a Studio test reaching into them would couple two
 * suites that should be able to move independently.
 */
function plain(): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scene_surface",
    meta: { name: "Lower Third", createdAt: TIME, updatedAt: TIME },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 50 },
    },
    variables: VARS,
    assets: [],
    states: [],
    root: {
      id: "node_root",
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      components: [],
      children: [],
    },
  };
}

/** The same document, promoted to a template with labels and defaults. */
function templated(): SceneDocument {
  return {
    ...plain(),
    template: {
      id: "tpl_lower_third",
      name: "Lower Third",
      parameters: [
        { key: "talent.name", type: "string", label: "Name", default: "Presenter name", required: true },
        { key: "talent.role", type: "string", label: "Role", default: "Role" },
        { key: "partnerMark", type: "string", label: "Logo", required: false },
      ],
    },
  };
}

describe("the surface is derived, never declared twice", () => {
  it("reads a template's parameters, in the author's order", () => {
    const fields = surfaceOf(templated());
    expect(fields.map((f) => f.key)).toEqual(["talent.name", "talent.role", "partnerMark"]);
    expect(fields.map((f) => f.label)).toEqual(["Name", "Role", "Logo"]);
  });

  it("falls back to variables for a document that is not a template", () => {
    const fields = surfaceOf(plain());
    expect(fields.map((f) => f.key)).toEqual(["talent.name", "talent.role", "partnerMark"]);
    // Derived from the key's last segment: title-cased, and camelCase split
    // into words — `partnerMark` reads as "Partner Mark", not "PartnerMark".
    expect(fields.map((f) => f.label)).toEqual(["Name", "Role", "Partner Mark"]);
  });

  it("shows the variable's current value, not the template's default", () => {
    const fields = surfaceOf(templated());
    expect(fields[0]!.value).toBe("Amara Okonkwo");
    expect(fields[0]!.overridden).toBe(true);
  });

  it("marks a field that matches the template default as not overridden", () => {
    const doc = templated();
    const withDefault: SceneDocument = {
      ...doc,
      variables: doc.variables.map((v) =>
        v.key === "talent.role" ? { ...v, default: "Role" } : v,
      ),
    };
    const role = surfaceOf(withDefault).find((f) => f.key === "talent.role")!;
    expect(role.overridden).toBe(false);
  });

  it("carries `required` through from the parameter", () => {
    const fields = surfaceOf(templated());
    expect(fields.find((f) => f.key === "talent.name")!.required).toBe(true);
    expect(fields.find((f) => f.key === "partnerMark")!.required).toBe(false);
  });
});

describe("editing produces operations, not mutations", () => {
  it("typing a name applies through the engine and is readable back", () => {
    const before = plain();
    const txn = setSurfaceValue(before, "talent.name", "Bea Lam");
    expect(txn).not.toBeNull();
    const after = applyTransaction(before, txn!);

    expect(surfaceValue(after, "talent.name")).toBe("Bea Lam");
    // The document was not mutated — the source of truth is replaced, not edited.
    expect(surfaceValue(before, "talent.name")).toBe("Amara Okonkwo");
  });

  it("is undone by inverting the same transaction", () => {
    const before = plain();
    const txn = setSurfaceValue(before, "talent.name", "Bea Lam")!;
    const after = applyTransaction(before, txn);
    const undone = applyTransaction(after, invertTransaction(txn));

    expect(surfaceValue(undone, "talent.name")).toBe("Amara Okonkwo");
  });

  it("returns null for an unchanged value, so undo has no no-ops", () => {
    const doc = plain();
    expect(setSurfaceValue(doc, "talent.name", "Amara Okonkwo")).toBeNull();
  });

  it("throws for an unknown key rather than defining a stray variable", () => {
    const doc = plain();
    expect(() => setSurfaceValue(doc, "talent.nmae", "typo")).toThrow(/no variable named/);
    expect(doc.variables).toHaveLength(3);
  });

  it("groups several fields into one undo step", () => {
    const before = plain();
    const txn = setSurfaceValues(before, {
      "talent.name": "Tomás Ruiz",
      "talent.role": "Analyst",
      partnerMark: "BBS",
    })!;
    expect(txn.operations).toHaveLength(3);

    const after = applyTransaction(before, txn);
    expect(surfaceValue(after, "talent.name")).toBe("Tomás Ruiz");
    expect(surfaceValue(after, "partnerMark")).toBe("BBS");

    // One inversion restores all three.
    const undone = applyTransaction(after, invertTransaction(txn));
    expect(surfaceValue(undone, "talent.name")).toBe("Amara Okonkwo");
    expect(surfaceValue(undone, "partnerMark")).toBeNull();
  });

  it("omits unchanged fields from a batch", () => {
    const before = plain();
    const txn = setSurfaceValues(before, {
      "talent.name": "Amara Okonkwo", // unchanged
      "talent.role": "Analyst",
    })!;
    expect(txn.operations).toHaveLength(1);
  });

  it("returns null when a batch changes nothing at all", () => {
    const before = plain();
    expect(setSurfaceValues(before, { "talent.name": "Amara Okonkwo" })).toBeNull();
  });
});

describe("reset returns a field to the template default", () => {
  it("resets an overridden parameter", () => {
    const before = templated();
    const txn = resetSurfaceValue(before, "talent.name")!;
    const after = applyTransaction(before, txn);
    expect(surfaceValue(after, "talent.name")).toBe("Presenter name");
    expect(surfaceOf(after).find((f) => f.key === "talent.name")!.overridden).toBe(false);
  });

  it("does nothing for a document with no template", () => {
    expect(resetSurfaceValue(plain(), "talent.name")).toBeNull();
  });
});

describe("required fields gate readiness", () => {
  it("reports a required field that is empty", () => {
    const doc = templated();
    const blanked: SceneDocument = {
      ...doc,
      variables: doc.variables.map((v) => (v.key === "talent.name" ? { ...v, default: "" } : v)),
    };
    expect(unsatisfied(blanked).map((f) => f.key)).toEqual(["talent.name"]);
  });

  it("reports nothing when every required field is supplied", () => {
    expect(unsatisfied(templated())).toEqual([]);
  });

  it("does not treat an optional empty field as unsatisfied", () => {
    // partnerMark is null and optional.
    expect(unsatisfied(templated()).map((f) => f.key)).not.toContain("partnerMark");
  });
});
