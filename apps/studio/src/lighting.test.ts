/**
 * Lighting a scene, and the scene that arrives already lit.
 *
 * ============================================================================
 * THE FAILURES THESE CATCH
 * ============================================================================
 * All four are ways a lighting control feels like it is fighting you:
 *
 *   · pressing four looks in a row leaves twelve lights and a blown-out set
 *   · a look that claims to be selected after somebody dimmed one of its lights
 *   · an exposure field that accepts 0 and turns the picture black
 *   · a "3D scene" that opens square-on, with its whole point hidden
 */
import { describe, expect, it } from "vitest";
import { applyTransaction, childrenOf, type SceneNode } from "@bracketx/engine-scene";
import { environmentDescriptorOf } from "@bracketx/engine-reconciler";

import { testIdFactory } from "./studio/ids";
import { newDocument, newHybridDocument } from "./studio/project";
import {
  DEFAULT_LOOK,
  LOOKS,
  applyLook,
  exposureOf,
  lightsOf,
  lookOf,
  setExposure,
  setShadows,
  shadowsOn,
} from "./studio/lighting";

/**
 * ONE factory per test, always.
 *
 * `testIdFactory` is sequential, so two factories in one test hand out the
 * same ids and the second insert is refused for a node that "already exists".
 * That is the generator behaving correctly and the test being wrong — and it
 * is exactly the collision `newHybridDocument` would cause if it built its rig
 * from a fresh factory.
 */
function ids() {
  return testIdFactory();
}

function names(node: SceneNode): string[] {
  const out = [node.name];
  for (const child of childrenOf(node)) out.push(...names(child));
  return out;
}

// ===========================================================================
// The looks
// ===========================================================================

describe("the looks", () => {
  it("names each by what it looks like, never by lighting engineering", () => {
    for (const look of LOOKS) {
      expect(look.label).not.toMatch(/lumen|kelvin|falloff|ambient|directional/i);
      expect(look.hint.length).toBeGreaterThan(10);
      expect(look.lights.length).toBeGreaterThan(0);
    }
  });

  /**
   * A LIT OBJECT IN AN UNLIT SCENE RENDERS BLACK.
   *
   * Every look must therefore leave the scene lit. "Flat" is the one that
   * gives up modelling, and it is exactly the one where a mistake would be
   * easy to make — an empty rig would be indistinguishable from a broken
   * renderer.
   */
  it("leaves the scene lit, every one of them", () => {
    for (const look of LOOKS) {
      const total = look.lights.reduce((sum, light) => sum + light.intensity, 0);
      expect(total, look.label).toBeGreaterThan(0.5);
    }
  });
});

describe("applyLook", () => {
  it("puts real light nodes in the document, not a special object", () => {
    const factory = ids();
    const document = newDocument("Test", factory);
    const applied = applyLook(document, DEFAULT_LOOK, factory)!;
    const next = applyTransaction(document, applied);

    const lights = lightsOf(next);
    expect(lights).toHaveLength(DEFAULT_LOOK.lights.length);
    // They are in the layer tree by name — a designer can select, move and
    // delete them like anything else.
    expect(names(next.root)).toEqual(expect.arrayContaining(["Key", "Fill", "Back"]));
  });

  /**
   * THE BUG A NAIVE IMPLEMENTATION SHIPS.
   *
   * Pressing four looks in a row must leave the fourth one's lighting. Adding
   * instead of replacing leaves twelve lights, a blown-out set, and a designer
   * with no idea why.
   */
  it("replaces the rig rather than adding to it", () => {
    const factory = ids();
    let document = newDocument("Test", factory);
    for (const look of LOOKS) {
      document = applyTransaction(document, applyLook(document, look, factory)!);
    }
    expect(lightsOf(document)).toHaveLength(LOOKS.at(-1)!.lights.length);
  });

  it("is one undo step, however many lights it moved", () => {
    const factory = ids();
    const document = newDocument("Test", factory);
    const applied = applyLook(document, DEFAULT_LOOK, factory)!;
    expect(applied.label).toContain(DEFAULT_LOOK.label);
    // One transaction. Three inserts and a shadow switch, but one press.
    expect(applied.operations.length).toBeGreaterThan(1);
  });

  it("carries its own shadow decision, because the two are one look", () => {
    const factory = ids();
    let document = newDocument("Test", factory);
    document = applyTransaction(document, applyLook(document, LOOKS[0]!, factory)!);
    expect(shadowsOn(document)).toBe(LOOKS[0]!.shadows);

    const soft = LOOKS.find((look) => look.id === "soft")!;
    document = applyTransaction(document, applyLook(document, soft, factory)!);
    expect(shadowsOn(document)).toBe(false);
  });
});

describe("lookOf", () => {
  it("reports the look a scene is wearing", () => {
    const factory = ids();
    let document = newDocument("Test", factory);
    document = applyTransaction(document, applyLook(document, LOOKS[1]!, factory)!);
    expect(lookOf(document)?.id).toBe(LOOKS[1]!.id);
  });

  /**
   * Null is a real answer, not a failure.
   *
   * The lights are ordinary nodes. Somebody who dimmed the key has a scene
   * that genuinely is not wearing "Dramatic" any more, and a picker that went
   * on claiming it was would be lying about the picture — the same rule
   * `finishOf` follows for materials.
   */
  it("stops claiming a look once somebody has changed one of its lights", () => {
    const factory = ids();
    let document = newDocument("Test", factory);
    document = applyTransaction(document, applyLook(document, LOOKS[0]!, factory)!);
    const key = lightsOf(document)[0]!;

    document = applyTransaction(document, {
      id: "txn_dim",
      label: "Dim",
      actorId: "test",
      operations: [
        {
          type: "node.setProp",
          nodeId: key.nodeId,
          path: "components.0.props.intensity",
          value: 0.3,
          previousValue: key.intensity,
        },
      ],
    });
    expect(lookOf(document)).toBeNull();
  });

  it("reports nothing for a scene nobody has lit", () => {
    expect(lookOf(newDocument("Test", ids()))).toBeNull();
    expect(lightsOf(newDocument("Test", ids()))).toHaveLength(0);
  });
});

// ===========================================================================
// Exposure and shadows
// ===========================================================================

describe("exposure", () => {
  it("is neutral until somebody changes it", () => {
    expect(exposureOf(newDocument("Test", ids()))).toBe(1);
  });

  it("round-trips through the document and into the engine's descriptor", () => {
    const document = newDocument("Test", ids());
    const next = applyTransaction(document, setExposure(document, 1.75));
    expect(exposureOf(next)).toBe(1.75);
    // The value the RENDERER will be given, read by the engine's own reader —
    // so a field the projector would ignore fails here rather than on air.
    expect(environmentDescriptorOf(next).exposure).toBe(1.75);
  });

  /**
   * A field somebody typed "0" into must not black the picture out with no way
   * back except undo. Clamped rather than rejected, because refusing a
   * keystroke silently is its own kind of broken.
   */
  it("refuses to black the picture out", () => {
    const document = newDocument("Test", ids());
    expect(exposureOf(applyTransaction(document, setExposure(document, 0)))).toBeGreaterThan(0);
    expect(exposureOf(applyTransaction(document, setExposure(document, -3)))).toBeGreaterThan(0);
    expect(exposureOf(applyTransaction(document, setExposure(document, 99)))).toBeLessThanOrEqual(4);
  });
});

describe("shadows", () => {
  it("are off until asked for, and reach the engine when they are", () => {
    const document = newDocument("Test", ids());
    expect(shadowsOn(document)).toBe(false);
    expect(environmentDescriptorOf(document).shadows).toBe(false);

    const next = applyTransaction(document, setShadows(document, true));
    expect(shadowsOn(next)).toBe(true);
    expect(environmentDescriptorOf(next).shadows).toBe(true);
  });
});

// ===========================================================================
// The scene that arrives ready
// ===========================================================================

describe("a 3D scene", () => {
  it("arrives with a floor, a rig and a camera that can see depth", () => {
    const document = newHybridDocument("Set", ids());
    const layers = names(document.root);
    expect(layers).toEqual(expect.arrayContaining(["Camera", "Floor", "Key", "Fill", "Back"]));
    expect(lightsOf(document).length).toBe(DEFAULT_LOOK.lights.length);
  });

  /**
   * THE SINGLE MOST IMPORTANT LINE IN THAT FUNCTION.
   *
   * A 3D scene that opens square-on is a 3D scene whose entire point is hidden
   * behind a control nobody pressed. The camera is off axis in BOTH the way
   * the viewport tests for depth and the way the toolbar does.
   */
  it("opens in space, not square-on", () => {
    const document = newHybridDocument("Set", ids());
    const camera = childrenOf(document.root).find((node) => node.name === "Camera")!;
    const [x, y] = camera.transform?.position ?? [0, 0, 0];
    expect(Math.abs(x!) + Math.abs(y!)).toBeGreaterThan(0.5);
  });

  it("uses a perspective camera, because parallel edges are a technical drawing", () => {
    const document = newHybridDocument("Set", ids());
    const camera = childrenOf(document.root).find((node) => node.name === "Camera")!;
    const component = (camera.components ?? [])[0]!;
    expect((component.props as { projection?: string }).projection).toBe("perspective");
  });

  it("turns shadows on, because a set without contact shadows is a collage", () => {
    const document = newHybridDocument("Set", ids());
    expect(shadowsOn(document)).toBe(true);
    expect(environmentDescriptorOf(document).exposure).toBe(1);
  });

  it("still validates as an ordinary scene document", () => {
    const document = newHybridDocument("Set", ids());
    expect(document.format).toBe(newDocument("Flat", ids()).format);
    // Every node id unique — the rig is generated, and a generator that reused
    // an id would produce a document the mirror cannot project.
    const seen = new Set<string>();
    const visit = (node: SceneNode): void => {
      expect(seen.has(node.id), node.id).toBe(false);
      seen.add(node.id);
      for (const child of childrenOf(node)) visit(child);
    };
    visit(document.root);
  });
});
