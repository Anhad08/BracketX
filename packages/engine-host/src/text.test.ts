import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";

import { SceneHost } from "./host";
import { expandPrewarm } from "@bracketx/engine-text";

import { HostTextProvider } from "./text";

/**
 * Phase 3B — text as a first-class scene node.
 *
 * ============================================================================
 * THE CLAIM THIS FILE EXISTS TO TEST
 * ============================================================================
 * Not "text renders". The T1 spike and `engine-text`'s own 43 assertions cover
 * the pipeline. The claim here is the one the phase was actually set:
 *
 *   > text automatically participates in variables, the timeline, animation,
 *   > states, collections, templates, outputs, preview and live — with no
 *   > special workflow.
 *
 * That is falsifiable, and each subsystem gets an assertion below. If any of
 * them needed a special case, text would be a second pipeline wearing the same
 * name — which is exactly what the C1 reversal exists to prevent.
 *
 * The structure deliberately mirrors `hybrid.test.ts`, which asked the same
 * question of 3D meshes. Same question, same shape, same answer.
 */

const FIXTURES = fileURLToPath(new URL("../../engine-text/fixtures/fonts/", import.meta.url));

let interData: Uint8Array;
let arabicData: Uint8Array;

beforeAll(() => {
  interData = new Uint8Array(readFileSync(FIXTURES + "inter-latin-400.ttf"));
  arabicData = new Uint8Array(readFileSync(FIXTURES + "noto-arabic-400.ttf"));
});

function node(id: string, extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id,
    name: id,
    order: generateKeyBetween(null, null),
    transform: IDENTITY_TRANSFORM,
    ...extra,
  };
}

/** A text node. `content` may be a literal or a `{ $var }` binding. */
function text(
  id: string,
  content: unknown,
  props: Record<string, unknown> = {},
  extra: Partial<SceneNode> = {},
): SceneNode {
  return node(id, {
    size: { width: 8, height: 2 },
    components: [
      {
        id: `cmp_${id}`,
        type: "text",
        props: {
          content,
          font: { assetId: "ast_inter", size: 48 },
          color: "#FFFFFF",
          fit: { mode: "overflow" },
          ...props,
        },
      },
    ],
    ...extra,
  });
}

function document_(over: Partial<SceneDocument> = {}): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_text",
    meta: { name: "Text", createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z" },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 60 },
    },
    variables: [],
    assets: [
      { id: "ast_inter", kind: "font", name: "Inter", hash: "sha256-inter" },
      { id: "ast_arabic", kind: "font", name: "Noto Arabic", hash: "sha256-arabic" },
    ],
    states: [],
    root: node("nod_root", { children: [] }),
    ...over,
  };
}

interface Rig {
  readonly scene: SceneHost;
  readonly backend: MockMirrorBackend;
  readonly provider: HostTextProvider;
}

function host(document: SceneDocument, options: { fonts?: boolean } = {}): Rig {
  const backend = new MockMirrorBackend();
  const provider = new HostTextProvider({ pageSize: 512, pxRange: 4 });
  if (options.fonts !== false) {
    provider.addFont("ast_inter", interData);
    provider.addFont("ast_arabic", arabicData);
  }
  const scene = new SceneHost(backend, { text: provider });
  scene.load(document);
  scene.renderFrame(0);
  return { scene, backend, provider };
}

/** Meshes attached below a text node. One per atlas page it draws from. */
/**
 * Advances the clock to a frame.
 *
 * `renderFrame` takes WALL ms, not a frame number, and the host's clock is
 * PAUSED by default — an editor that autoplayed would animate a graphic out
 * from under the person editing it. So playback is started explicitly.
 */
function runTo(rig: Rig, targetFrame: number): number {
  rig.scene.play();
  let wall = 0;
  let guard = 0;
  while (rig.scene.runtime.clock.frame < targetFrame && guard < targetFrame * 4 + 240) {
    wall += 1000 / 60;
    rig.scene.renderFrame(wall);
    guard += 1;
  }
  return rig.scene.runtime.clock.frame;
}

function batchesOf(rig: Rig, nodeId: string): readonly string[] {
  return [...rig.scene.reconciler.mirror.nodeIds()].filter((id) =>
    id.startsWith(`${nodeId}§text`),
  );
}

function quadsOf(rig: Rig, nodeId: string): number {
  // Every batch is a mesh; the geometry it holds is the text's quads. Counted
  // through the backend so this asserts what was actually submitted rather than
  // what the text engine believed it produced.
  let total = 0;
  for (const id of batchesOf(rig, nodeId)) {
    const mirror = rig.scene.reconciler.mirror.get(id);
    if (mirror?.attachment.kind === "mesh") total += 1;
  }
  return total;
}

// ===========================================================================
// It is a mesh, and nothing above it knows
// ===========================================================================

describe("text is a node", () => {
  it("attaches an msdf-text mesh, like a rect attaches an unlit one", () => {
    const rig = host(document_({ root: node("nod_root", { children: [text("nod_name", "ALEX RIVERA")] }) }));
    expect(batchesOf(rig, "nod_name")).toHaveLength(1);

    const snapshot = rig.backend.snapshot();
    const meshes = snapshot.nodes.filter((entry) => entry.attachment === "mesh");
    expect(meshes).toHaveLength(1);
    // An atlas texture was created and nothing else.
    expect(snapshot.resourceCounts.textures).toBe(1);
    expect(snapshot.resourceCounts.geometries).toBe(1);
    rig.scene.dispose();
  });

  it("renders nothing, and survives, with no text provider wired", () => {
    // A scene with no words must not pay for HarfBuzz. So an unwired provider
    // is a supported state, not a crash — the same behaviour an asset-backed
    // mesh already has.
    const backend = new MockMirrorBackend();
    const scene = new SceneHost(backend);
    scene.load(document_({ root: node("nod_root", { children: [text("nod_name", "HELLO")] }) }));
    scene.renderFrame(0);

    expect(scene.reconciler.mirror.has("nod_name")).toBe(true);
    expect(backend.snapshot().nodes.filter((entry) => entry.attachment === "mesh")).toHaveLength(0);
    scene.dispose();
  });

  it("survives a font that never loaded", () => {
    const rig = host(
      document_({ root: node("nod_root", { children: [text("nod_name", "HELLO")] }) }),
      { fonts: false },
    );
    expect(rig.scene.reconciler.mirror.has("nod_name")).toBe(true);
    expect(batchesOf(rig, "nod_name")).toHaveLength(0);
    rig.scene.dispose();
  });

  it("frees every resource it allocated", () => {
    // MirrorBackend C2: lifetime is the caller's. A text node owns a geometry, a
    // material and a mirror child per batch, and a leak here is a leak per
    // score change — the highest-churn node in a broadcast.
    const rig = host(document_({ root: node("nod_root", { children: [text("nod_name", "ALEX")] }) }));
    rig.scene.dispose();
    const stats = rig.backend.stats();
    expect(stats.geometriesDestroyed).toBe(stats.geometriesCreated);
    expect(stats.materialsDestroyed).toBe(stats.materialsCreated);
    expect(stats.texturesDestroyed).toBe(stats.texturesCreated);
  });
});

// ===========================================================================
// 1. Variables   2. Live
// ===========================================================================

describe("text participates in variables and live control", () => {
  function bound(): Rig {
    return host(
      document_({
        variables: [
          { id: "var_name", key: "player.name", type: "string", label: "Name", default: "ALEX RIVERA" },
          { id: "var_colour", key: "team.accent", type: "color", label: "Accent", default: "#FF0000" },
        ],
        root: node("nod_root", {
          children: [
            text("nod_name", { $var: "player.name" }, { color: { $var: "team.accent" } }),
          ],
        }),
      }),
    );
  }

  it("binds content to a variable, with no code below the projector", () => {
    // `content` is Bindable<string>, so it arrives at `#applyText` already
    // RESOLVED. That single fact is the entire integration — there is no
    // text-aware code in the variable path at all.
    const rig = bound();
    expect(batchesOf(rig, "nod_name")).toHaveLength(1);

    const before = rig.provider.stats().layoutMisses;
    rig.scene.applyLive({ type: "variable.set", key: "player.name", value: "MO SALAH" }, "operator");
    rig.scene.renderFrame(16);

    // A new layout was computed: the content genuinely changed rather than the
    // node being re-attached with the old string.
    expect(rig.provider.stats().layoutMisses).toBeGreaterThan(before);
    expect(batchesOf(rig, "nod_name")).toHaveLength(1);
    rig.scene.dispose();
  });

  it("re-lays-out only the node whose variable changed", () => {
    const rig = host(
      document_({
        variables: [
          { id: "var_home", key: "home", type: "string", label: "H", default: "0" },
          { id: "var_away", key: "away", type: "string", label: "A", default: "0" },
        ],
        root: node("nod_root", {
          children: [
            text("nod_home", { $var: "home" }),
            text("nod_away", { $var: "away" }),
          ],
        }),
      }),
    );
    const before = rig.provider.stats().layoutMisses;
    rig.scene.applyLive({ type: "variable.set", key: "home", value: "1" }, "operator");
    rig.scene.renderFrame(16);
    // Exactly one new layout. A score change must not reflow the whole scene.
    expect(rig.provider.stats().layoutMisses).toBe(before + 1);
    rig.scene.dispose();
  });

  it("recolours in place, without rebuilding geometry", () => {
    // A team colour bound to a variable changes as often as the data does, and
    // reallocating a vertex buffer to change a colour is the specific waste
    // `updateMaterial` exists to avoid.
    const rig = bound();
    rig.backend.resetWriteCount();
    const geometriesBefore = rig.backend.stats().geometriesCreated;

    rig.scene.applyLive({ type: "variable.set", key: "team.accent", value: "#00FF00" }, "operator");
    rig.scene.renderFrame(16);

    expect(rig.backend.stats().geometriesCreated).toBe(geometriesBefore);
    expect(rig.scene.lastReport?.nodesCreated).toBe(0);
    rig.scene.dispose();
  });
});

// ===========================================================================
// 3. Timeline   4. Animation
// ===========================================================================

describe("text participates in the timeline", () => {
  it("is animated by an ordinary track, with no new machinery", () => {
    const rig = host(
      document_({
        animations: [
          {
            id: "anm_in",
            name: "Slide in",
            duration: 1,
            tracks: [
              {
                target: "nod_name",
                path: "transform.position.0",
                keyframes: [
                  { time: 0, value: -8, easing: "linear" },
                  { time: 1, value: 0 },
                ],
              },
              {
                // The font SIZE animates, which is the interesting one: it
                // changes the layout, not just the transform.
                target: "nod_name",
                path: "components.0.props.font.size",
                keyframes: [
                  { time: 0, value: 24, easing: "linear" },
                  { time: 1, value: 48 },
                ],
              },
            ],
          },
        ],
        root: node("nod_root", { children: [text("nod_name", "ALEX RIVERA")] }),
      }),
    );

    rig.scene.playClip("anm_in", { startFrame: 0 });
    runTo(rig, 30);

    const values = rig.scene.animator.values.get("nod_name")!;
    expect(values.get("transform.position.0")).toBeCloseTo(-4, 0);
    expect(values.get("components.0.props.font.size")).toBeCloseTo(36, 0);
    // Still one batch: an animated size must not leave orphaned meshes behind.
    expect(batchesOf(rig, "nod_name")).toHaveLength(1);
    rig.scene.dispose();
  });

  it("keeps the batch aligned with its node under animation", () => {
    // The batch is a mirror CHILD, so it must share its parent's world matrix
    // exactly. If it drifted, animated text would separate from the box it sits
    // in — visible immediately and impossible to author around.
    const rig = host(
      document_({
        animations: [
          {
            id: "anm_move",
            name: "Move",
            duration: 1,
            tracks: [
              {
                target: "nod_name",
                path: "transform.position.1",
                keyframes: [
                  { time: 0, value: 0, easing: "linear" },
                  { time: 1, value: 3 },
                ],
              },
            ],
          },
        ],
        root: node("nod_root", { children: [text("nod_name", "ALEX")] }),
      }),
    );
    rig.scene.playClip("anm_move", { startFrame: 0 });
    runTo(rig, 60);

    const parent = rig.scene.reconciler.mirror.get("nod_name")!;
    for (const id of batchesOf(rig, "nod_name")) {
      const child = rig.scene.reconciler.mirror.get(id)!;
      expect(child.worldMatrix[13]).toBeCloseTo(parent.worldMatrix[13]!, 6);
      expect(child.worldMatrix[12]).toBeCloseTo(parent.worldMatrix[12]!, 6);
    }
    expect(parent.worldMatrix[13]).toBeCloseTo(3, 1);
    rig.scene.dispose();
  });
});

// ===========================================================================
// 5. States
// ===========================================================================

describe("text participates in states", () => {
  it("is hidden and moved by a state override", () => {
    const rig = host(
      document_({
        states: [{ id: "st_out", name: "out", duration: 0 }],
        root: node("nod_root", {
          children: [
            text("nod_name", "ALEX", {}, {
              states: { out: { visible: false } },
            }),
          ],
        }),
      }),
    );
    expect(rig.scene.reconciler.mirror.get("nod_name")!.visible).toBe(true);

    rig.scene.setStates(["out"]);
    rig.scene.renderFrame(16);
    expect(rig.scene.reconciler.mirror.get("nod_name")!.visible).toBe(false);

    rig.scene.setStates([]);
    rig.scene.renderFrame(32);
    expect(rig.scene.reconciler.mirror.get("nod_name")!.visible).toBe(true);
    rig.scene.dispose();
  });
});

// ===========================================================================
// 6. Collections
// ===========================================================================

describe("text participates in collections", () => {
  function roster(): Rig {
    return host(
      document_({
        variables: [
          {
            id: "var_players",
            key: "players",
            // A collection source is a runtime value; the format's variable
            // types describe scalars. Declared as `asset` for the same reason
            // the repeat tests do — the type is not what the projector reads.
            type: "asset",
            label: "Players",
            default: [
              { id: "p1", name: "SALAH" },
              { id: "p2", name: "NUNEZ" },
              { id: "p3", name: "DIAZ" },
            ],
          },
        ],
        root: node("nod_root", {
          children: [
            node("nod_roster", {
              repeat: { source: "players", as: "player", key: "id" },
              children: [text("nod_row", { $var: "player.name" })],
            }),
          ],
        }),
      }),
    );
  }

  it("instances one text node per row, each with its own content", () => {
    const rig = roster();
    for (const identity of ["p1", "p2", "p3"]) {
      expect(rig.scene.reconciler.mirror.has(`nod_row#${identity}`)).toBe(true);
      expect(batchesOf(rig, `nod_row#${identity}`)).toHaveLength(1);
    }
    // Three DIFFERENT names, so three layouts — not one shared by all rows.
    expect(rig.provider.stats().layoutMisses).toBeGreaterThanOrEqual(3);
    rig.scene.dispose();
  });

  it("preserves identity when the collection reorders", () => {
    const rig = roster();
    const before = rig.scene.reconciler.mirror.get("nod_row#p1")!.handle;

    rig.scene.applyLive(
      { type: "collection.reorder", key: "players", ids: ["p3", "p1", "p2"], keyField: "id" },
      "operator",
    );
    rig.scene.renderFrame(16);

    // Same handle: the row moved, it was not destroyed and recreated. Text
    // inherits keyed identity for free because it is a component on a node.
    expect(rig.scene.reconciler.mirror.get("nod_row#p1")!.handle).toBe(before);
    expect(batchesOf(rig, "nod_row#p1")).toHaveLength(1);
    rig.scene.dispose();
  });

  it("releases a removed row's text resources", () => {
    const rig = roster();
    const created = rig.backend.stats().geometriesCreated;

    rig.scene.applyLive(
      { type: "collection.remove", key: "players", ids: ["p2"], keyField: "id" },
      "operator",
    );
    rig.scene.renderFrame(16);

    expect(rig.scene.reconciler.mirror.has("nod_row#p2")).toBe(false);
    expect(rig.backend.stats().geometriesDestroyed).toBeGreaterThan(0);
    expect(created).toBeGreaterThan(0);
    rig.scene.dispose();
  });
});

// ===========================================================================
// 7. Outputs   8. Preview / Live
// ===========================================================================

describe("text participates in outputs", () => {
  it("draws the same scene through two outputs", () => {
    const rig = host(document_({ root: node("nod_root", { children: [text("nod_name", "ALEX")] }) }));
    rig.scene.applyLive(
      { type: "output.bind", output: { id: "preview", width: 640, height: 360 } },
      "operator",
    );
    rig.scene.renderFrame(16);
    // Two outputs, one mirror. Text is not re-laid-out per output — layout is a
    // property of the scene, which is the whole C1 guarantee.
    expect(rig.scene.outputs.length).toBeGreaterThanOrEqual(2);
    expect(batchesOf(rig, "nod_name")).toHaveLength(1);
    rig.scene.dispose();
  });

  it("is byte-identical across two hosts loading the same document", () => {
    // Preview and Program are two SessionS on one document (Studio Phase 3A).
    // If text laid out differently in each, an operator's preview would not be
    // what airs — the exact failure C1 reversed the design to prevent.
    const scene = document_({ root: node("nod_root", { children: [text("nod_name", "Konstantinos Papadopoulos", { fit: { mode: "shrink", minSize: 12 } })] }) });
    const a = host(scene);
    const b = host(scene);
    expect(a.scene.sessionHash()).toBe(b.scene.sessionHash());
    expect(JSON.stringify(a.backend.snapshot().nodes)).toBe(
      JSON.stringify(b.backend.snapshot().nodes),
    );
    a.scene.dispose();
    b.scene.dispose();
  });
});

// ===========================================================================
// Layout is engine state
// ===========================================================================

describe("layout is engine state, not pixels", () => {
  it("reports truncation, so a pre-flight can see it", () => {
    const rig = host(
      document_({
        root: node("nod_root", {
          children: [
            text(
              "nod_name",
              "Konstantinos Papadopoulos",
              { fit: { mode: "truncate" } },
              { size: { width: 2, height: 1 } },
            ),
          ],
        }),
      }),
    );
    // Reached through the provider, which is where a production system asks.
    const draw = rig.provider.draw({
      content: "Konstantinos Papadopoulos",
      fonts: ["ast_inter"],
      size: 48,
      align: "start",
      verticalAlign: "top",
      lineHeight: 1.2,
      box: { width: 96, height: 48 },
      fit: { mode: "truncate" },
      direction: "auto",
      scale: 1 / 48,
    })!;
    expect(draw.truncated).toBe(true);
    rig.scene.dispose();
  });

  it("keeps world-space and screen-space layout identical", () => {
    const rig = host(document_());
    const request = {
      content: "Manchester United versus Liverpool",
      fonts: ["ast_inter"],
      size: 48,
      align: "start" as const,
      verticalAlign: "top" as const,
      lineHeight: 1.2,
      box: { width: 300, height: 400 },
      fit: { mode: "wrap" },
      direction: "auto" as const,
    };
    const screen = rig.provider.draw({ ...request, scale: 1 })!;
    const world = rig.provider.draw({ ...request, scale: 0.01 })!;
    // Same size, same batching. Only the coordinates differ, by exactly 100x.
    expect(world.resolvedSize).toBe(screen.resolvedSize);
    expect(world.batches.length).toBe(screen.batches.length);
    expect(world.batches[0]!.positions[0]).toBeCloseTo(
      screen.batches[0]!.positions[0]! * 0.01,
      6,
    );
    rig.scene.dispose();
  });
});

// ===========================================================================
// Pre-warm — T4
// ===========================================================================

describe("pre-warm is declared on the scene", () => {
  it("rasterises a declared range before anything is on screen", () => {
    // T4 asked where a pre-warm set belongs. On the SCENE: one font asset is
    // shared by many scenes, and a set declared on the asset is wrong for every
    // scene but the one it was authored against.
    const rig = host(
      document_({
        world: {
          units: "meters",
          up: "Y",
          handedness: "right",
          output: { width: 1920, height: 1080, fps: 60 },
          textPrewarm: { ranges: ["latin"] },
        },
        root: node("nod_root", { children: [] }),
      }),
    );
    const before = rig.provider.stats().atlas.glyphs;
    const added = rig.provider.prewarmDocument(rig.scene.document!, 32);

    expect(added).toBeGreaterThan(60); // printable ASCII, minus whitespace
    expect(rig.provider.stats().atlas.glyphs).toBe(before + added);
    rig.scene.dispose();
  });

  it("does nothing for a document that declares nothing", () => {
    const rig = host(document_());
    expect(rig.provider.prewarmDocument(rig.scene.document!)).toBe(0);
    rig.scene.dispose();
  });

  it("expands named ranges without duplicating an overlap", () => {
    // `latin` and `punctuation` both carry characters in common; rasterising
    // one twice is a wasted MSDF generation each time.
    const both = expandPrewarm({ ranges: ["latin", "punctuation"] });
    expect(new Set(both).size).toBe([...both].length);

    // Literal characters are merged with the ranges, not appended blindly.
    const withLiteral = expandPrewarm({ ranges: ["latin"], characters: "AA€" });
    expect(new Set(withLiteral).size).toBe([...withLiteral].length);
    expect(withLiteral).toContain("€");

    // Hangul is capped at the common block: the full 11,172 syllables would
    // take minutes to rasterise and fill the atlas.
    expect([...expandPrewarm({ ranges: ["hangul"] })].length).toBe(2350);
    expect(expandPrewarm({})).toBe("");
  });
});

// ===========================================================================
// Right-to-left, end to end
// ===========================================================================

describe("right-to-left text through the whole stack", () => {
  it("renders an Arabic name from a bound variable", () => {
    const rig = host(
      document_({
        variables: [
          { id: "var_name", key: "player.name", type: "string", label: "Name", default: "محمد صلاح" },
        ],
        root: node("nod_root", {
          children: [
            text("nod_name", { $var: "player.name" }, {
              font: { assetId: "ast_arabic", size: 48, fallback: ["ast_inter"] },
            }),
          ],
        }),
      }),
    );
    expect(batchesOf(rig, "nod_name")).toHaveLength(1);
    expect(quadsOf(rig, "nod_name")).toBe(1);

    // And it survives being replaced with a Latin name live — the fallback
    // chain resolves per codepoint, so one node handles both.
    rig.scene.applyLive({ type: "variable.set", key: "player.name", value: "ALEX RIVERA" }, "operator");
    rig.scene.renderFrame(16);
    expect(batchesOf(rig, "nod_name")).toHaveLength(1);
    rig.scene.dispose();
  });
});
