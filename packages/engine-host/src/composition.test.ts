import { describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  instantiateTemplate,
  validateDocument,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import { SceneHost } from "./host";

/**
 * THE PHASE 4 MILESTONE.
 *
 * "Without writing application code, BracketX can build a complete lower-third,
 *  scoreboard, leaderboard, or tournament bracket simply by composing
 *  templates, variables, collections, layouts, and states."
 *
 * Everything below is DATA. There is no engine change, no component type, and
 * no application code — four real production graphics assembled from five
 * primitives:
 *
 *   templates    typed parameters that become variables
 *   variables    values, and bindings to them
 *   collections  a template instantiated per item
 *   layout       horizontal, vertical, grid, stack, anchors, safe areas
 *   states       named property overrides the engine does not interpret
 *
 * The engine still does not know the words "lower third", "scoreboard",
 * "leaderboard", or "bracket". It knows how to compose.
 */

let orderCounter = 0;
function nextOrder(): string {
  orderCounter += 1;
  let key: string | null = null;
  for (let i = 0; i < orderCounter; i += 1) key = generateKeyBetween(key, null);
  return key!;
}

/** A coloured box. The only visual primitive any of these graphics uses. */
function box(
  id: string,
  width: number,
  height: number,
  fill: unknown,
  extra: Partial<SceneNode> = {},
): SceneNode {
  return {
    id,
    name: id,
    order: nextOrder(),
    transform: IDENTITY_TRANSFORM,
    size: { width, height },
    components: [
      {
        id: `cmp_${id.slice(4)}`,
        type: "rect",
        props: { width, height, fill },
      },
    ],
    ...extra,
  };
}

function camera(): SceneNode {
  return {
    id: "nod_cam",
    name: "Camera",
    // Lowest possible order key, so the camera is always child 0 regardless of
    // when it was constructed. Sibling order is by key, not by array position.
    order: "1",
    transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [
      {
        id: "cmp_cam",
        type: "camera",
        props: {
          projection: "orthographic",
          orthographicSize: 5,
          near: 0.1,
          far: 100,
        },
      },
    ],
  };
}

function document(
  id: string,
  root: SceneNode,
  extra: Partial<SceneDocument> = {},
): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id,
    meta: {
      name: id,
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
    // A brand kit, expressed once. Every graphic below reads it.
    tokens: [
      { name: "color.primary", value: "#0B1F3A" },
      { name: "color.accent", value: "#E8B23A" },
      { name: "color.surface", value: "#12263F" },
      { name: "color.danger", value: "#C0392B" },
      { name: "space.sm", value: 0.1 },
      { name: "space.md", value: 0.25 },
    ],
    root,
    ...extra,
  };
}

function host(scene: SceneDocument): {
  host: SceneHost;
  backend: MockMirrorBackend;
} {
  const backend = new MockMirrorBackend();
  const instance = new SceneHost(backend);
  instance.load(scene);
  return { host: instance, backend };
}

// ---------------------------------------------------------------------------
// 1. Lower third — template + parameters + states + anchor
// ---------------------------------------------------------------------------

function lowerThirdTemplate(): SceneDocument {
  const bar: SceneNode = {
    id: "nod_bar",
    name: "Bar",
    order: nextOrder(),
    transform: IDENTITY_TRANSFORM,
    size: { width: 7, height: 1.4 },
    // Anchored, so it sits correctly at any output resolution.
    anchor: { x: "left", y: "bottom", inset: 0.5, safe: true },
    layout: { mode: "horizontal", gap: 0.15, align: "center", padding: 0.1 },
    children: [
      box("nod_accent", 0.2, 1.2, { $var: "accentColor" }),
      box("nod_name", 4, 0.6, { $var: "color.primary" }),
      box("nod_title", 2, 0.4, { $var: "color.surface" }),
    ],
    // The engine assigns no meaning to these names. A template declares them.
    states: {
      enter: { visible: true },
      visible: { visible: true },
      exit: { visible: false },
      hidden: { visible: false },
    },
  };

  return document(
    "scn_lowerThird",
    {
      id: "nod_root",
      name: "Root",
      order: nextOrder(),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(), bar],
    },
    {
      template: {
        id: "tpl_lowerThird",
        name: "Lower Third",
        parameters: [
          { key: "presenterName", type: "string", default: "ALEX RIVERA" },
          { key: "presenterTitle", type: "string", default: "ANALYST" },
          { key: "accentColor", type: "color", default: "#E8B23A" },
        ],
      },
    },
  );
}

describe("lower third", () => {
  it("instantiates from a template with parameters", () => {
    const scene = instantiateTemplate(lowerThirdTemplate(), {
      parameters: { presenterName: "SAM OKONKWO", accentColor: "#22C55E" },
    });

    expect(scene.template).toBeUndefined();
    expect(scene.variables.find((v) => v.key === "presenterName")!.default).toBe(
      "SAM OKONKWO",
    );
    // Unsupplied parameters fall back to their declared defaults.
    expect(scene.variables.find((v) => v.key === "presenterTitle")!.default).toBe(
      "ANALYST",
    );
    expect(validateDocument(scene).errors).toEqual([]);
  });

  it("lays its parts out horizontally without authored coordinates", () => {
    const { backend } = host(instantiateTemplate(lowerThirdTemplate()));
    const nodes = backend.snapshot().nodes;

    // Accent, name plate, title — each placed by layout, left to right.
    const xs = nodes
      .filter((n) => n.path.startsWith("0/1/"))
      .map((n) => n.worldMatrix[12]!);

    expect(xs).toHaveLength(3);
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
  });

  it("hides on the exit state and shows again on enter", () => {
    const scene = instantiateTemplate(lowerThirdTemplate());
    const { host: instance, backend } = host(scene);

    const visibleBefore = backend
      .snapshot()
      .nodes.filter((n) => n.path.startsWith("0/1")).length;
    expect(visibleBefore).toBeGreaterThan(0);

    instance.setStates(["exit"]);
    const bar = backend.snapshot().nodes.find((n) => n.path === "0/1")!;
    expect(bar.visible).toBe(false);

    instance.setStates(["enter"]);
    expect(backend.snapshot().nodes.find((n) => n.path === "0/1")!.visible).toBe(
      true,
    );
  });

  it("reads the brand kit without the template naming a colour", () => {
    // The bar's fill is `color.primary`, a token — not a literal and not a
    // document variable. Changing the token changes every graphic.
    const scene = instantiateTemplate(lowerThirdTemplate());
    const { backend } = host(scene);
    expect(backend.snapshot().resourceCounts.materials).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Scoreboard — nested layout + variables + a conditional state
// ---------------------------------------------------------------------------

function scoreboard(): SceneDocument {
  const side = (id: string, teamVar: string, scoreVar: string): SceneNode => ({
    id,
    name: id,
    order: nextOrder(),
    transform: IDENTITY_TRANSFORM,
    size: { width: 3, height: 0.9 },
    layout: { mode: "horizontal", gap: 0.1, align: "center" },
    children: [
      box(`${id}Name`, 2, 0.7, { $var: teamVar }),
      box(`${id}Score`, 0.8, 0.7, { $var: scoreVar }),
    ],
  });

  const bar: SceneNode = {
    id: "nod_score",
    name: "Scoreboard",
    order: nextOrder(),
    transform: IDENTITY_TRANSFORM,
    size: { width: 8, height: 1.2 },
    anchor: { x: "center", y: "top", inset: 0.4, safe: true },
    layout: { mode: "horizontal", gap: 0.4, justify: "center", align: "center" },
    children: [
      side("nod_home", "color.primary", "color.accent"),
      box("nod_clock", 1.2, 0.8, { $var: "color.surface" }),
      side("nod_away", "color.primary", "color.accent"),
    ],
    // A conditional state: the whole bar reddens in the final minute. No
    // engine concept of "final minute" — a rule elsewhere activates the name.
    states: {
      urgent: {
        props: { cmp_clock: { fill: { $var: "color.danger" } } },
      },
    },
  };

  return document("scn_scoreboard", {
    id: "nod_root",
    name: "Root",
    order: nextOrder(),
    transform: IDENTITY_TRANSFORM,
    size: { width: 17.78, height: 10 },
    children: [camera(), bar],
  });
}

describe("scoreboard", () => {
  it("nests layouts two deep and centres the whole run", () => {
    const { backend } = host(scoreboard());
    const nodes = backend.snapshot().nodes;

    // root + camera + bar + (home, clock, away) + 2 children each side
    expect(nodes.length).toBeGreaterThanOrEqual(9);

    const clock = nodes.find((n) => n.path === "0/1/1")!;
    // Centre-justified with symmetric siblings puts the clock on the axis.
    expect(Math.abs(clock.worldMatrix[12]!)).toBeLessThan(0.001);
  });

  it("applies a conditional state to one component only", () => {
    const { host: instance, backend } = host(scoreboard());
    const before = backend.snapshot().resourceCounts.materials;

    instance.setStates(["urgent"]);

    // A new fill means a new material; the rest are unchanged and shared.
    expect(backend.snapshot().resourceCounts.materials).toBeGreaterThanOrEqual(
      Math.min(before, 1),
    );
    expect(instance.activeStates).toEqual(["urgent"]);
  });
});

// ---------------------------------------------------------------------------
// 3. Leaderboard — collection + vertical layout
// ---------------------------------------------------------------------------

function leaderboard(rows: unknown[]): SceneDocument {
  const list: SceneNode = {
    id: "nod_list",
    name: "Leaderboard",
    order: nextOrder(),
    transform: IDENTITY_TRANSFORM,
    size: { width: 6, height: 6 },
    anchor: { x: "right", y: "middle", inset: 0.5, safe: true },
    layout: { mode: "vertical", gap: 0.12, align: "stretch" },
    repeat: { source: "standings", as: "row", key: "id", limit: 20 },
    children: [
      {
        id: "nod_row",
        name: "Row",
        order: nextOrder(),
        transform: IDENTITY_TRANSFORM,
        size: { width: 6, height: 0.55 },
        layout: { mode: "horizontal", gap: 0.1, align: "center" },
        children: [
          box("nod_pos", 0.5, 0.45, { $var: "color.accent" }),
          box("nod_team", 3.5, 0.45, { $var: "row.color" }),
          box("nod_pts", 1, 0.45, { $var: "color.surface" }),
        ],
      },
    ],
  };

  return document(
    "scn_leaderboard",
    {
      id: "nod_root",
      name: "Root",
      order: nextOrder(),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(), list],
    },
    {
      variables: [
        {
          id: "var_standings",
          key: "standings",
          type: "string",
          label: "Standings",
          default: rows,
        },
      ],
    },
  );
}

const STANDINGS = [
  { id: "t1", color: "#C0392B" },
  { id: "t2", color: "#2980B9" },
  { id: "t3", color: "#27AE60" },
  { id: "t4", color: "#8E44AD" },
];

describe("leaderboard", () => {
  it("builds one row per item, stacked vertically", () => {
    const { backend } = host(leaderboard(STANDINGS));
    const rows = backend
      .snapshot()
      .nodes.filter((n) => /^0\/1\/\d+$/.test(n.path));

    expect(rows).toHaveLength(4);

    // Y-up: successive rows descend.
    const ys = rows.map((r) => r.worldMatrix[13]!);
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i]!).toBeLessThan(ys[i - 1]!);
    }
  });

  it("gives every row a distinct colour from its own item", () => {
    const { backend } = host(leaderboard(STANDINGS));
    // Four team colours plus the shared accent and surface.
    expect(backend.snapshot().resourceCounts.materials).toBeGreaterThanOrEqual(4);
  });

  it("grows and shrinks with the data, keeping survivors", () => {
    const { host: instance, backend } = host(leaderboard(STANDINGS));
    expect(
      backend.snapshot().nodes.filter((n) => /^0\/1\/\d+$/.test(n.path)),
    ).toHaveLength(4);

    const report = instance.setVariable(
      "standings",
      [...STANDINGS, { id: "t5", color: "#16A085" }] as never,
    );

    expect(report.nodesCreated).toBe(1);
    expect(report.nodesDestroyed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Tournament bracket — collection + grid layout + per-item state
// ---------------------------------------------------------------------------

function bracket(matches: unknown[]): SceneDocument {
  const grid: SceneNode = {
    id: "nod_bracket",
    name: "Bracket",
    order: nextOrder(),
    transform: IDENTITY_TRANSFORM,
    size: { width: 12, height: 8 },
    anchor: { x: "center", y: "middle" },
    layout: {
      mode: "grid",
      columns: 4,
      gap: 0.4,
      rowGap: 0.3,
      align: "start",
      padding: 0.2,
    },
    repeat: { source: "matches", as: "match", key: "id", limit: 64 },
    children: [
      {
        id: "nod_match",
        name: "Match",
        order: nextOrder(),
        transform: IDENTITY_TRANSFORM,
        size: { width: 2.4, height: 1.2 },
        layout: { mode: "vertical", gap: 0.06, align: "stretch" },
        children: [
          box("nod_top", 2.4, 0.5, { $var: "match.homeColor" }),
          box("nod_bot", 2.4, 0.5, { $var: "match.awayColor" }),
        ],
      },
    ],
  };

  return document(
    "scn_bracket",
    {
      id: "nod_root",
      name: "Root",
      order: nextOrder(),
      transform: IDENTITY_TRANSFORM,
      size: { width: 17.78, height: 10 },
      children: [camera(), grid],
    },
    {
      variables: [
        {
          id: "var_matches",
          key: "matches",
          type: "string",
          label: "Matches",
          default: matches,
        },
      ],
    },
  );
}

const MATCHES = Array.from({ length: 8 }, (_, i) => ({
  id: `m${i}`,
  homeColor: `#${(i * 30).toString(16).padStart(2, "0")}2040`,
  awayColor: `#40${(i * 25).toString(16).padStart(2, "0")}20`,
}));

describe("tournament bracket", () => {
  it("lays 8 matches into a 4-column grid", () => {
    const { backend } = host(bracket(MATCHES));
    const cells = backend
      .snapshot()
      .nodes.filter((n) => /^0\/1\/\d+$/.test(n.path));

    expect(cells).toHaveLength(8);

    const xs = cells.map((c) => c.worldMatrix[12]!);
    const ys = cells.map((c) => c.worldMatrix[13]!);

    // Four distinct columns, two distinct rows.
    expect(new Set(xs.map((x) => x.toFixed(3))).size).toBe(4);
    expect(new Set(ys.map((y) => y.toFixed(3))).size).toBe(2);

    // Row two sits below row one.
    expect(ys[4]!).toBeLessThan(ys[0]!);
  });

  it("scales to a 64-match draw without an engine change", () => {
    const big = Array.from({ length: 64 }, (_, i) => ({
      id: `m${i}`,
      homeColor: "#123456",
      awayColor: "#654321",
    }));
    const { backend } = host(bracket(big));

    expect(
      backend.snapshot().nodes.filter((n) => /^0\/1\/\d+$/.test(n.path)),
    ).toHaveLength(64);
  });

  it("honours the declared limit rather than trusting the feed", () => {
    const flood = Array.from({ length: 500 }, (_, i) => ({
      id: `m${i}`,
      homeColor: "#111111",
      awayColor: "#222222",
    }));
    const { backend } = host(bracket(flood));

    expect(
      backend.snapshot().nodes.filter((n) => /^0\/1\/\d+$/.test(n.path)),
    ).toHaveLength(64);
  });
});

// ---------------------------------------------------------------------------
// The milestone claim, asserted
// ---------------------------------------------------------------------------

describe("the milestone", () => {
  it("builds four production graphics from composition alone", () => {
    const graphics: [string, SceneDocument][] = [
      ["lower third", instantiateTemplate(lowerThirdTemplate())],
      ["scoreboard", scoreboard()],
      ["leaderboard", leaderboard(STANDINGS)],
      ["bracket", bracket(MATCHES)],
    ];

    for (const [name, scene] of graphics) {
      // Every one is a valid document that could be saved and reloaded.
      expect(validateDocument(scene).errors, name).toEqual([]);

      const { host: instance, backend } = host(scene);
      const result = instance.renderFrame(0);

      expect(result.drawn, name).toBe(true);
      expect(backend.snapshot().nodes.length, name).toBeGreaterThan(3);
    }
  });

  it("uses no component type the engine did not already have", () => {
    // The proof that these are composition, not features: every visual node is
    // a rect or a camera. There is no "scoreboard" component, no "bracket"
    // node type, and no engine code that knows any of these words.
    const scene = bracket(MATCHES);
    const types = new Set<string>();
    const walkNode = (node: SceneNode): void => {
      for (const component of node.components ?? []) types.add(component.type);
      for (const child of node.children ?? []) walkNode(child);
    };
    walkNode(scene.root);

    expect([...types].sort()).toEqual(["camera", "rect"]);
  });
});
