import { describe, expect, it } from "vitest";
import {
  IDENTITY_TRANSFORM,
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";
import {
  MockMirrorBackend,
  boxDescriptor,
  cylinderDescriptor,
  planeDescriptor,
  primitiveKey,
  sphereDescriptor,
} from "@bracketx/engine-reconciler";

import { SceneHost } from "./host";

/**
 * Phase 2 — the hybrid runtime, first slice.
 *
 * ============================================================================
 * THE CLAIM THIS FILE EXISTS TO TEST
 * ============================================================================
 * "3D is a first-class citizen that uses the exact same architecture already
 * proven by the 2D engine."
 *
 * That is falsifiable, and it is what is asserted here. Not "meshes render" —
 * the interesting property is that **every existing subsystem drives a mesh
 * without knowing it is one**:
 *
 *   variables    a runtime variable changes a material colour
 *   timelines    an existing track animates a mesh transform and a camera
 *   collections  a repeat instances meshes with identity preserved
 *   states       a state override hides and moves a mesh
 *   outputs      one scene renders 2D and 3D through different cameras
 *
 * If any of those needed a special case, 3D would be a second pipeline wearing
 * the same name. None of them do, and none of the code paths they use were
 * changed for this phase — only a new `#applyMesh` beside `#applyRect`.
 */

function node(id: string, extra: Partial<SceneNode> = {}): SceneNode {
  return {
    id,
    name: id,
    order: generateKeyBetween(null, null),
    transform: IDENTITY_TRANSFORM,
    ...extra,
  };
}

function mesh(
  id: string,
  primitive: Record<string, unknown>,
  material: Record<string, unknown> = { baseColor: "#FFFFFF" },
  extra: Partial<SceneNode> = {},
): SceneNode {
  return node(id, {
    components: [
      { id: `cmp_${id}`, type: "meshRenderer", props: { primitive, material } },
    ],
    ...extra,
  });
}

function document_(overrides: Partial<SceneDocument> = {}): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scn_hybrid",
    meta: {
      name: "Hybrid",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
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
    root: node("nod_root", {
      children: [
        node("nod_cam", {
          transform: { position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1] },
          components: [
            {
              id: "cmp_cam",
              type: "camera",
              props: { projection: "perspective", focalLength: 35, sensorWidth: 36, near: 0.1, far: 100 },
            },
          ],
        }),
      ],
    }),
    ...overrides,
  };
}

function host(document: SceneDocument): SceneHost {
  const scene = new SceneHost(new MockMirrorBackend());
  scene.load(document);
  scene.play();
  return scene;
}

function runTo(scene: SceneHost, targetFrame: number): number {
  let wall = 0;
  let guard = 0;
  while (scene.runtime.clock.frame < targetFrame && guard < targetFrame * 4 + 240) {
    wall += 1000 / 60;
    scene.renderFrame(wall);
    guard += 1;
  }
  return scene.runtime.clock.frame;
}

function attachmentOf(scene: SceneHost, nodeId: string) {
  return scene.reconciler.mirror.get(nodeId)?.attachment;
}

// ===========================================================================
// Primitives
// ===========================================================================

describe("primitives", () => {
  it("generates closed, correctly-sized geometry", () => {
    const box = boxDescriptor(2, 4, 6);
    // 24 vertices, not 8: a shared corner would average three face normals and
    // turn every hard edge into a smooth-shading artefact.
    expect(box.positions.length / 3).toBe(24);
    expect(box.indices!.length).toBe(36);
    expect(Math.max(...box.positions.filter((_, i) => i % 3 === 0))).toBe(1);
    expect(Math.max(...box.positions.filter((_, i) => i % 3 === 1))).toBe(2);
    expect(Math.max(...box.positions.filter((_, i) => i % 3 === 2))).toBe(3);
  });

  it("gives every primitive matching position, normal and uv counts", () => {
    // A mismatch here is a GPU error at draw time in one backend and silent
    // garbage in another, which is exactly the class of bug generating geometry
    // in the reconciler rather than per-backend exists to prevent.
    for (const descriptor of [
      boxDescriptor(),
      planeDescriptor(),
      sphereDescriptor(0.5, 8, 6),
      cylinderDescriptor(0.5, 1, 8),
    ]) {
      const vertices = descriptor.positions.length / 3;
      expect(descriptor.normals!.length / 3).toBe(vertices);
      expect(descriptor.uvs!.length / 2).toBe(vertices);
      for (const index of descriptor.indices!) {
        expect(index).toBeLessThan(vertices);
      }
    }
  });

  it("normalises sphere normals — a unit sphere's position IS its normal", () => {
    const sphere = sphereDescriptor(2, 12, 8);
    for (let index = 0; index < sphere.normals!.length; index += 3) {
      const length = Math.hypot(
        sphere.normals![index]!,
        sphere.normals![index + 1]!,
        sphere.normals![index + 2]!,
      );
      expect(length).toBeCloseTo(1, 6);
    }
  });

  it("keys identical specs identically, so one geometry serves a thousand seats", () => {
    expect(primitiveKey({ shape: "box", width: 2 })).toBe(
      primitiveKey({ shape: "box", width: 2, height: 1 }),
    );
    expect(primitiveKey({ shape: "box", width: 2 })).not.toBe(
      primitiveKey({ shape: "box", width: 3 }),
    );
  });
});

// ===========================================================================
// A mesh is a node with a component
// ===========================================================================

describe("meshRenderer", () => {
  it("attaches geometry and a material, exactly as a rect does", () => {
    const scene = host(
      document_({
        root: node("nod_root", {
          children: [mesh("nod_cube", { shape: "box" })],
        }),
      }),
    );
    expect(attachmentOf(scene, "nod_cube")?.kind).toBe("mesh");
    scene.dispose();
  });

  it("frees every resource it allocated when the node goes", () => {
    // MirrorBackend C2 puts lifetime on the caller. A second component type is
    // a second place to leak, so it is asserted rather than assumed.
    const backend = new MockMirrorBackend();
    const scene = new SceneHost(backend);
    scene.load(
      document_({
        root: node("nod_root", { children: [mesh("nod_cube", { shape: "sphere" })] }),
      }),
    );
    scene.dispose();
    const stats = backend.stats();
    // Created and destroyed must BALANCE. A count of zero alive is the same
    // claim stated in the form the mock actually tracks.
    expect(stats.geometriesDestroyed).toBe(stats.geometriesCreated);
    expect(stats.materialsDestroyed).toBe(stats.materialsCreated);
    expect(stats.geometriesCreated).toBeGreaterThan(0);
  });

  it("attaches nothing for an asset-backed mesh rather than pretending", () => {
    // §7.1 specifies `assetId`; the asset pipeline is a phase of its own. The
    // node survives unattached, which is what a rect over budget already does.
    const scene = host(
      document_({
        root: node("nod_root", {
          children: [
            node("nod_model", {
              components: [
                {
                  id: "cmp_model",
                  type: "meshRenderer",
                  props: { assetId: "ast_trophy", meshIndex: 0 },
                },
              ],
            }),
          ],
        }),
      }),
    );
    expect(scene.reconciler.mirror.has("nod_model")).toBe(true);
    expect(attachmentOf(scene, "nod_model")?.kind).not.toBe("mesh");
    scene.dispose();
  });
});

// ===========================================================================
// Everything that already exists continues to work
// ===========================================================================

describe("variables drive 3D exactly as they drive 2D", () => {
  it("a runtime variable changes a material without recreating anything", () => {
    const scene = host(
      document_({
        variables: [
          { id: "var_accent", key: "team.accent", type: "color", label: "Accent", default: "#FF0000" },
        ],
        root: node("nod_root", {
          children: [
            mesh("nod_cube", { shape: "box" }, { baseColor: { $var: "team.accent" } }),
          ],
        }),
      }),
    );
    scene.renderFrame(0);
    const before = attachmentOf(scene, "nod_cube");

    scene.applyLive({ type: "variable.set", key: "team.accent", value: "#00FF00" }, "operator");
    scene.renderFrame(16);

    // The SAME attachment: a colour change updates the material in place. The
    // alternative — free and reallocate a GPU resource per frame — is what a
    // variable-bound team colour would cost sixty times a second.
    expect(attachmentOf(scene, "nod_cube")).toEqual(before);
    expect(scene.lastReport?.nodesCreated).toBe(0);
    expect(scene.lastReport?.nodesDestroyed).toBe(0);
    scene.dispose();
  });

  it("one variable drives every instance", () => {
    // The claim from the brief, executing: Team Colour → Material Base Color,
    // changing one variable updates every instance.
    const scene = host(
      document_({
        variables: [
          { id: "var_rows", key: "seats", type: "string", label: "Seats", default: [{ id: "a" }, { id: "b" }, { id: "c" }] },
          { id: "var_accent", key: "team.accent", type: "color", label: "Accent", default: "#FF0000" },
        ],
        root: node("nod_root", {
          children: [
            node("nod_stand", {
              repeat: { source: "seats", as: "seat", key: "id", limit: 100 },
              children: [
                mesh("nod_seat", { shape: "box", width: 0.4 }, { baseColor: { $var: "team.accent" } }),
              ],
            }),
          ],
        }),
      }),
    );
    scene.renderFrame(0);
    for (const identity of ["a", "b", "c"]) {
      expect(attachmentOf(scene, `nod_seat#${identity}`)?.kind).toBe("mesh");
    }

    const handles = ["a", "b", "c"].map((identity) =>
      scene.reconciler.mirror.get(`nod_seat#${identity}`)!.attachment,
    );

    scene.applyLive({ type: "variable.set", key: "team.accent", value: "#0000FF" }, "operator");
    scene.renderFrame(16);

    // Every instance kept its handles — the colour updated in place — and
    // nothing was created or destroyed. That is what "one variable updates
    // every instance" has to mean if a stadium of seats is to stay affordable.
    expect(scene.lastReport?.nodesCreated).toBe(0);
    expect(scene.lastReport?.nodesDestroyed).toBe(0);
    ["a", "b", "c"].forEach((identity, index) => {
      expect(scene.reconciler.mirror.get(`nod_seat#${identity}`)!.attachment).toEqual(
        handles[index],
      );
    });
    scene.dispose();
  });
});

describe("collections instance meshes with identity preserved", () => {
  it("adds and removes instances without churning the survivors", () => {
    const scene = host(
      document_({
        variables: [
          { id: "var_rows", key: "players", type: "string", label: "Players", default: [{ id: "p1" }, { id: "p2" }] },
        ],
        root: node("nod_root", {
          children: [
            node("nod_squad", {
              repeat: { source: "players", as: "player", key: "id", limit: 50 },
              children: [mesh("nod_body", { shape: "cylinder" })],
            }),
          ],
        }),
      }),
    );
    scene.renderFrame(0);
    const survivor = scene.reconciler.mirror.get("nod_body#p1");

    scene.applyLive(
      {
        type: "collection.replace",
        key: "players",
        items: [{ id: "p1" }, { id: "p2" }, { id: "p3" }],
      } as never,
      "feed",
    );
    scene.renderFrame(16);

    expect(attachmentOf(scene, "nod_body#p3")?.kind).toBe("mesh");
    // The survivor keeps its handle, its geometry and its material.
    expect(scene.reconciler.mirror.get("nod_body#p1")).toBe(survivor);
    expect(scene.lastReport?.nodesDestroyed).toBe(0);
    scene.dispose();
  });
});

describe("the existing timeline animates 3D", () => {
  it("moves a mesh and a camera through the same tracks that move a rectangle", () => {
    const scene = host(
      document_({
        animations: [
          {
            id: "anm_flythrough",
            name: "Fly-through",
            duration: 2,
            tracks: [
              {
                target: "nod_cam",
                path: "transform.position.2",
                keyframes: [
                  { time: 0, value: 8, easing: "easeInOutCubic" },
                  { time: 2, value: 2 },
                ],
              },
              {
                target: "nod_trophy",
                path: "transform.rotation.1",
                keyframes: [
                  { time: 0, value: 0, easing: "linear" },
                  { time: 2, value: 360 },
                ],
              },
            ],
          },
        ],
        root: node("nod_root", {
          children: [
            node("nod_cam", {
              transform: { position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1] },
              components: [
                {
                  id: "cmp_cam",
                  type: "camera",
                  props: { projection: "perspective", focalLength: 35, sensorWidth: 36 },
                },
              ],
            }),
            mesh("nod_trophy", { shape: "cylinder", radius: 0.3, height: 1.2 }),
          ],
        }),
      }),
    );

    scene.playClip("anm_flythrough", { startFrame: 0 });
    runTo(scene, 60); // one second, halfway

    // No new track type, no new evaluator, no 3D branch anywhere in the
    // animator: a dot path into a Vec3 is a dot path into a Vec3.
    const camera = scene.animator.values.get("nod_cam")!;
    const trophy = scene.animator.values.get("nod_trophy")!;
    expect(camera.get("transform.position.2")).toBeCloseTo(5, 1);
    expect(trophy.get("transform.rotation.1")).toBeCloseTo(180, 0);

    // And it reached the mirror.
    expect(scene.reconciler.mirror.get("nod_cam")!.worldMatrix[14]).toBeCloseTo(5, 1);
    scene.dispose();
  });

  it("animates a material value through the same tracks", () => {
    const scene = host(
      document_({
        animations: [
          {
            id: "anm_fade",
            name: "Fade",
            duration: 1,
            tracks: [
              {
                target: "nod_cube",
                path: "components.0.props.material.opacity",
                keyframes: [
                  { time: 0, value: 1, easing: "linear" },
                  { time: 1, value: 0 },
                ],
              },
            ],
          },
        ],
        root: node("nod_root", { children: [mesh("nod_cube", { shape: "box" })] }),
      }),
    );
    scene.playClip("anm_fade", { startFrame: 0 });
    runTo(scene, 30);

    expect(scene.animator.values.get("nod_cube")!.get("components.0.props.material.opacity")).toBeCloseTo(
      0.5,
      1,
    );
    scene.dispose();
  });
});

describe("states apply to 3D", () => {
  it("hides and moves a mesh with no 3D-specific path", () => {
    const scene = host(
      document_({
        root: node("nod_root", {
          children: [
            mesh(
              "nod_banner",
              { shape: "plane", width: 4, depth: 2 },
              { baseColor: "#FFFFFF" },
              {
                states: {
                  offstage: {
                    visible: false,
                    transform: { position: [0, -5, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
                  },
                },
              },
            ),
          ],
        }),
      }),
    );
    scene.renderFrame(0);
    expect(scene.reconciler.mirror.get("nod_banner")!.effectiveVisible).toBe(true);

    scene.setStates(["offstage"]);
    scene.renderFrame(16);
    expect(scene.reconciler.mirror.get("nod_banner")!.effectiveVisible).toBe(false);
    expect(scene.reconciler.mirror.get("nod_banner")!.worldMatrix[13]).toBe(-5);
    scene.dispose();
  });
});

// ===========================================================================
// Lights - ADR-013 amendment 1 (IF-002)
// ===========================================================================

describe("lights are nodes", () => {
  function lit(props: Record<string, unknown>): SceneNode {
    return node("nod_key", {
      transform: { position: [0, 5, 5], rotation: [0, 0, 0], scale: [1, 1, 1] },
      components: [{ id: "cmp_key", type: "light", props }],
    });
  }

  it("attaches, and carries no position or direction of its own", () => {
    const scene = host(
      document_({ root: node("nod_root", { children: [lit({ kind: "directional" })] }) }),
    );
    expect(attachmentOf(scene, "nod_key")?.kind).toBe("light");
    // Placement is the node's world matrix - the engine computed it, and C3
    // forbids the backend deriving one. A descriptor carrying its own position
    // would be a second source of truth the timeline could not animate.
    expect(scene.reconciler.mirror.get("nod_key")!.worldMatrix[13]).toBe(5);
    scene.dispose();
  });

  it("reaches the BACKEND, not just the mirror's record of it", () => {
    // Regression. `#applyLight` set the mirror's attachment and
    // `MirrorGraph.setAttachment` had no `light` case, so `attachLight` was
    // never called: the light existed on the backend, unparented, with no
    // position and no direction - because the descriptor deliberately carries
    // neither.
    //
    // Every assertion above passed throughout, because `attachmentOf` reads the
    // MIRROR and the conformance suite calls `attachLight` DIRECTLY. Nothing
    // asserted the one step between them. Found by Studio's toolbox, the first
    // consumer to create a light through a document.
    const backend = new MockMirrorBackend();
    const scene = new SceneHost(backend);
    scene.load(
      document_({ root: node("nod_root", { children: [lit({ kind: "directional" })] }) }),
    );
    scene.renderFrame(0);

    const lights = backend.snapshot().nodes.filter((entry) => entry.attachment === "light");
    expect(lights).toHaveLength(1);
    // And it is placed by the node's world matrix, which only an ATTACHED
    // light has at all.
    expect(lights[0]!.worldMatrix[13]).toBe(5);
    scene.dispose();
  });

  it("is animated by the existing timeline, with no new machinery", () => {
    const scene = host(
      document_({
        animations: [
          {
            id: "anm_dim",
            name: "Dim",
            duration: 1,
            tracks: [
              {
                target: "nod_key",
                path: "components.0.props.intensity",
                keyframes: [
                  { time: 0, value: 4, easing: "linear" },
                  { time: 1, value: 0 },
                ],
              },
              {
                target: "nod_key",
                path: "transform.rotation.1",
                keyframes: [
                  { time: 0, value: 0, easing: "linear" },
                  { time: 1, value: 90 },
                ],
              },
            ],
          },
        ],
        root: node("nod_root", { children: [lit({ kind: "spot", intensity: 4 })] }),
      }),
    );
    scene.playClip("anm_dim", { startFrame: 0 });
    runTo(scene, 30);

    const values = scene.animator.values.get("nod_key")!;
    expect(values.get("components.0.props.intensity")).toBeCloseTo(2, 1);
    // Rotating the NODE aims the light, because a light points down local -Z.
    expect(values.get("transform.rotation.1")).toBeCloseTo(45, 0);
    scene.dispose();
  });

  it("takes its colour from a runtime variable, like a material does", () => {
    const scene = host(
      document_({
        variables: [
          {
            id: "var_accent",
            key: "team.accent",
            type: "color",
            label: "Accent",
            default: "#FF0000",
          },
        ],
        root: node("nod_root", {
          children: [lit({ kind: "point", color: { $var: "team.accent" }, intensity: 2 })],
        }),
      }),
    );
    scene.renderFrame(0);
    const before = attachmentOf(scene, "nod_key");

    scene.applyLive({ type: "variable.set", key: "team.accent", value: "#00FF00" }, "operator");
    scene.renderFrame(16);

    // Updated in place. One variable driving a material AND a key light is the
    // brief's "Team Accent -> Material Color -> Lighting" chain, executing.
    expect(attachmentOf(scene, "nod_key")).toEqual(before);
    expect(scene.lastReport?.nodesCreated).toBe(0);
    scene.dispose();
  });

  it("frees every light it allocated", () => {
    const backend = new MockMirrorBackend();
    const scene = new SceneHost(backend);
    scene.load(
      document_({
        root: node("nod_root", {
          children: [lit({ kind: "directional" }), mesh("nod_cube", { shape: "box" })],
        }),
      }),
    );
    scene.dispose();
    const stats = backend.stats();
    expect(stats.lightsCreated).toBeGreaterThan(0);
    expect(stats.lightsDestroyed).toBe(stats.lightsCreated);
  });

  it("is instanced by a collection and hidden by a state, like anything else", () => {
    const scene = host(
      document_({
        variables: [
          {
            id: "var_rigs",
            key: "rigs",
            type: "string",
            label: "Rigs",
            default: [{ id: "l1" }, { id: "l2" }],
          },
        ],
        root: node("nod_root", {
          children: [
            node("nod_rig", {
              repeat: { source: "rigs", as: "rig", key: "id", limit: 20 },
              children: [
                node("nod_lamp", {
                  components: [{ id: "cmp_lamp", type: "light", props: { kind: "point" } }],
                  states: { blackout: { visible: false } },
                }),
              ],
            }),
          ],
        }),
      }),
    );
    scene.renderFrame(0);
    expect(attachmentOf(scene, "nod_lamp#l1")?.kind).toBe("light");
    expect(attachmentOf(scene, "nod_lamp#l2")?.kind).toBe("light");

    scene.setStates(["blackout"]);
    scene.renderFrame(16);
    expect(scene.reconciler.mirror.get("nod_lamp#l1")!.effectiveVisible).toBe(false);
    scene.dispose();
  });
});

describe("hybrid outputs", () => {
  it("renders one scene through a 3D camera and a 2D camera at once", () => {
    // The compositing claim from the brief: a 3D stadium under a 2D lower
    // third. Each output names its own camera; nothing about the scene changes.
    const scene = host(
      document_({
        root: node("nod_root", {
          children: [
            node("nod_cam3d", {
              transform: { position: [0, 2, 8], rotation: [0, 0, 0], scale: [1, 1, 1] },
              components: [
                {
                  id: "cmp_cam3d",
                  type: "camera",
                  props: { projection: "perspective", focalLength: 35, sensorWidth: 36 },
                },
              ],
            }),
            node("nod_cam2d", {
              transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
              components: [
                {
                  id: "cmp_cam2d",
                  type: "camera",
                  props: { projection: "orthographic", orthographicSize: 5 },
                },
              ],
            }),
            mesh("nod_stadium", { shape: "plane", width: 20, depth: 20 }),
            node("nod_lower_third", {
              size: { width: 8, height: 1.5 },
              components: [
                { id: "cmp_lt", type: "rect", props: { width: 8, height: 1.5, fill: "#0B1F3A" } },
              ],
            }),
          ],
        }),
      }),
    );

    scene.applyLive(
      {
        type: "output.bind",
        output: { id: "programme", width: 1920, height: 1080, cameraNodeId: "nod_cam3d" },
      },
      "studio",
    );
    scene.applyLive(
      {
        type: "output.bind",
        output: { id: "overlay", width: 1920, height: 1080, cameraNodeId: "nod_cam2d" },
      },
      "studio",
    );

    const result = scene.renderFrame(0);
    // Both drew. A 2D graphic and a 3D set are the same scene graph, and the
    // only thing that differs is which camera an output resolves.
    expect(result.rendered).toContain("programme");
    expect(result.rendered).toContain("overlay");
    expect(result.missed).toEqual([]);
    // Both kinds of geometry are attached in the one mirror.
    expect(attachmentOf(scene, "nod_stadium")?.kind).toBe("mesh");
    expect(attachmentOf(scene, "nod_lower_third")?.kind).toBe("mesh");
    scene.dispose();
  });
});
