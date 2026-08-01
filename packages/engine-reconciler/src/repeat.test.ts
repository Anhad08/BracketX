import { describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  validateDocument,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";

import { MockMirrorBackend } from "./mock-backend";
import { Reconciler } from "./reconciler";
import { expandRepeat, identityOf, readCollection } from "./repeat";
import { ScopedVariables, dependencyKeyOf, readScoped } from "./scope";
import type { VariableSource } from "./resolve";

/**
 * Collections and instancing. Project Alpha A2 / Phase 4.
 *
 * The capability every list needs — rosters, leaderboards, brackets, tickers,
 * agendas, set lists. The engine knows none of those words; it knows how to
 * instantiate a template per item.
 */

/** A variable source over a plain record. */
function source(values: Record<string, unknown>): VariableSource {
  return { read: (key) => values[key] };
}

/** Container with a one-node template, repeating over `players`. */
function rosterDocument(key?: string): SceneDocument {
  const template: SceneNode = {
    id: "nod_row",
    name: "Row",
    order: generateKeyBetween(null, null),
    transform: IDENTITY_TRANSFORM,
    components: [
      {
        id: "cmp_row",
        type: "rect",
        props: { width: 4, height: 0.5, fill: { $var: "player.color" } },
      },
    ],
  };

  const container: SceneNode = {
    id: "nod_roster",
    name: "Roster",
    order: generateKeyBetween(null, null),
    transform: IDENTITY_TRANSFORM,
    repeat: key ? { source: "players", as: "player", key } : { source: "players", as: "player" },
    children: [template],
  };

  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_roster",
    meta: {
      name: "Roster",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [],
    assets: [],
    states: [],
    root: {
      id: "nod_root",
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      children: [container],
    },
  };
}

const PLAYERS = [
  { id: "p1", name: "Alex", color: "#FF0000" },
  { id: "p2", name: "Sam", color: "#00FF00" },
  { id: "p3", name: "Jo", color: "#0000FF" },
];

// ---------------------------------------------------------------------------
// Pure expansion
// ---------------------------------------------------------------------------

describe("expansion", () => {
  it("instantiates the template once per item", () => {
    const document = rosterDocument("id");
    const container = document.root.children![0]!;
    const instances = expandRepeat(container, PLAYERS, "id");

    expect(instances).toHaveLength(3);
    expect(instances.map((i) => i.identity)).toEqual(["p1", "p2", "p3"]);
    expect(instances[0]!.nodes[0]!.id).toBe("nod_row#p1");
  });

  it("suffixes every descendant, not just the instance root", () => {
    // Two instances of a template containing a child would otherwise both
    // claim that child's id, and the mirror enforces uniqueness.
    const nested: SceneNode = {
      id: "nod_outer",
      name: "Outer",
      order: generateKeyBetween(null, null),
      transform: IDENTITY_TRANSFORM,
      children: [
        {
          id: "nod_inner",
          name: "Inner",
          order: generateKeyBetween(null, null),
          transform: IDENTITY_TRANSFORM,
        },
      ],
    };
    const container: SceneNode = {
      id: "nod_c",
      name: "C",
      order: generateKeyBetween(null, null),
      repeat: { source: "items", as: "item" },
      children: [nested],
    };

    const instances = expandRepeat(container, [{}, {}], undefined);
    expect(instances[0]!.nodes[0]!.children![0]!.id).toBe("nod_inner#0");
    expect(instances[1]!.nodes[0]!.children![0]!.id).toBe("nod_inner#1");
  });

  it("falls back to index when the key is missing or unusable", () => {
    expect(identityOf({ id: "a" }, 0, "id")).toBe("a");
    expect(identityOf({ id: 7 }, 0, "id")).toBe("7");
    expect(identityOf({}, 3, "id")).toBe("3");
    expect(identityOf("scalar", 2, "id")).toBe("2");
    expect(identityOf({ id: "" }, 5, "id")).toBe("5");
    expect(identityOf({ id: "a" }, 0, undefined)).toBe("0");
  });

  it("disambiguates a duplicate key rather than producing duplicate ids", () => {
    // A feed repeating a row must not throw a mirror violation mid-show.
    const container = rosterDocument("id").root.children![0]!;
    const instances = expandRepeat(
      container,
      [{ id: "same" }, { id: "same" }],
      "id",
    );
    const ids = instances.map((i) => i.nodes[0]!.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("treats a missing or malformed collection as empty", () => {
    // A feed that has not arrived, or returned an object, renders an empty
    // list. It does not take the show down.
    expect(readCollection(undefined)).toEqual([]);
    expect(readCollection(null)).toEqual([]);
    expect(readCollection({ not: "an array" })).toEqual([]);
    expect(readCollection("string")).toEqual([]);
  });

  it("caps instances at the declared limit", () => {
    expect(readCollection([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Scoped resolution
// ---------------------------------------------------------------------------

describe("scoped variables", () => {
  it("resolves the item and its fields inside an instance", () => {
    const scope = new ScopedVariables(source({ theme: "dark" }), "player", {
      name: "Alex",
      team: { city: "Leeds" },
    });

    expect(readScoped(scope, "player.name")).toBe("Alex");
    expect(readScoped(scope, "player.team.city")).toBe("Leeds");
    expect(scope.read("theme")).toBe("dark");
  });

  it("does not leak the scoped name outside the instance", () => {
    const outer = source({ theme: "dark" });
    const scope = new ScopedVariables(outer, "player", { name: "Alex" });

    expect(scope.read("player.name")).toBe("Alex");
    expect(outer.read("player")).toBeUndefined();
  });

  it("keeps the parent live so a document variable still reaches instances", () => {
    const values: Record<string, unknown> = { theme: "dark" };
    const scope = new ScopedVariables(source(values), "player", {});
    values.theme = "light";
    expect(scope.read("theme")).toBe("light");
  });

  it("resolves a path that points at nothing to undefined, not an error", () => {
    // A binding pointing at nothing renders its fallback and the show goes on.
    const scope = new ScopedVariables(source({}), "player", { name: "Alex" });
    expect(readScoped(scope, "player.missing.deep")).toBeUndefined();
    expect(readScoped(scope, "absent.field")).toBeUndefined();
  });

  it("refuses prototype-pollution paths", () => {
    const scope = new ScopedVariables(source({}), "item", {});
    expect(readScoped(scope, "item.__proto__.polluted")).toBeUndefined();
    expect(readScoped(scope, "item.constructor.name")).toBeUndefined();
  });

  it("records the root key as the dependency", () => {
    // The index must agree with the resolver about what a dependency is, or a
    // collection change never matches and instances silently stop updating.
    expect(dependencyKeyOf("player.team.city")).toBe("player");
    expect(dependencyKeyOf("score")).toBe("score");
  });
});

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

describe("projection", () => {
  it("builds one mirror subtree per item", () => {
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    reconciler.build(rosterDocument("id"), source({ players: PLAYERS }));

    // root + container + 3 instances
    expect(backend.snapshot().nodes).toHaveLength(5);
  });

  it("binds each instance to its own item", () => {
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    reconciler.build(rosterDocument("id"), source({ players: PLAYERS }));

    // Three distinct fills means three distinct scopes resolved.
    expect(backend.snapshot().resourceCounts.materials).toBe(3);
  });

  it("renders nothing for an empty collection but keeps the container", () => {
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    reconciler.build(rosterDocument("id"), source({ players: [] }));

    expect(backend.snapshot().nodes).toHaveLength(2);
  });

  it("adds instances when the collection grows", () => {
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    const values: Record<string, unknown> = { players: PLAYERS.slice(0, 2) };
    const variables = source(values);

    reconciler.build(rosterDocument("id"), variables);
    expect(backend.snapshot().nodes).toHaveLength(4);

    values.players = PLAYERS;
    const report = reconciler.invalidateVariables(["players"], variables);

    expect(report.nodesCreated).toBe(1);
    expect(backend.snapshot().nodes).toHaveLength(5);
  });

  it("removes instances when the collection shrinks", () => {
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    const values: Record<string, unknown> = { players: PLAYERS };
    const variables = source(values);

    reconciler.build(rosterDocument("id"), variables);
    values.players = PLAYERS.slice(0, 1);
    const report = reconciler.invalidateVariables(["players"], variables);

    expect(report.nodesDestroyed).toBe(2);
    expect(backend.snapshot().nodes).toHaveLength(3);
  });

  it("keeps handles stable for surviving instances", () => {
    // THE point of keyed identity. A leaderboard reordering must not destroy
    // and rebuild every row — that drops GPU resources and restarts animation.
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    const values: Record<string, unknown> = { players: PLAYERS };
    const variables = source(values);

    reconciler.build(rosterDocument("id"), variables);
    const before = backend.snapshot().nodes.length;

    // Reorder, same members.
    values.players = [PLAYERS[2], PLAYERS[0], PLAYERS[1]];
    const report = reconciler.invalidateVariables(["players"], variables);

    expect(report.nodesCreated).toBe(0);
    expect(report.nodesDestroyed).toBe(0);
    expect(backend.snapshot().nodes).toHaveLength(before);
  });

  it("re-resolves a survivor whose item contents changed", () => {
    // A score updating in place: same identity, different value.
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    const values: Record<string, unknown> = { players: PLAYERS };
    const variables = source(values);

    reconciler.build(rosterDocument("id"), variables);

    values.players = [
      { id: "p1", name: "Alex", color: "#FFFFFF" },
      PLAYERS[1],
      PLAYERS[2],
    ];
    const report = reconciler.invalidateVariables(["players"], variables);

    expect(report.nodesCreated).toBe(0);
    expect(report.dirty.material).toBeGreaterThan(0);
  });

  it("rebuilds on reorder when there is no key", () => {
    // Without a key, identity is the index, so a reorder is indistinguishable
    // from every item changing. Correct, wasteful, and why `key` exists.
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    const values: Record<string, unknown> = { players: PLAYERS };
    const variables = source(values);

    reconciler.build(rosterDocument(), variables);
    values.players = [PLAYERS[2], PLAYERS[0], PLAYERS[1]];
    const report = reconciler.invalidateVariables(["players"], variables);

    // Same count, so nothing is created or destroyed — but every instance is
    // re-resolved because its item changed underneath a stable index.
    expect(report.nodesCreated).toBe(0);
    expect(report.dirty.material).toBeGreaterThan(0);
  });

  it("does not touch instances when an unrelated variable changes", () => {
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    const variables = source({ players: PLAYERS, unrelated: 1 });

    reconciler.build(rosterDocument("id"), variables);
    const report = reconciler.invalidateVariables(["unrelated"], variables);

    expect(report.nodesCreated).toBe(0);
    expect(report.nodesDestroyed).toBe(0);
  });

  it("frees instance resources on teardown", () => {
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    reconciler.build(rosterDocument("id"), source({ players: PLAYERS }));
    reconciler.teardown();

    expect(backend.snapshot().nodes).toEqual([]);
    expect(backend.snapshot().resourceCounts.materials).toBe(0);
  });

  it("stays consistent with the document after expansion", () => {
    // The verifier re-derives independently. Expansion must not put the mirror
    // somewhere the document cannot explain.
    const backend = new MockMirrorBackend();
    const reconciler = new Reconciler(backend);
    reconciler.build(rosterDocument("id"), source({ players: PLAYERS }));

    // Instances are derived, not authored, so the document has 3 nodes and the
    // mirror has 5. The verifier knows about expansion or it does not run.
    expect(backend.snapshot().nodes.map((n) => n.path)).toContain("0/0");
  });
});

describe("document validity", () => {
  it("a document using repeat still validates", () => {
    // Additive under SCENE_FORMAT §13 rule 4 — no version bump.
    const result = validateDocument(rosterDocument("id"));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});
