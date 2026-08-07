/**
 * Enable 3D — the Golden Rule, tested as a product behaviour.
 *
 * ============================================================================
 * WHAT THESE ARE GUARDING
 * ============================================================================
 * The founder's specification for this control has two halves, and the second
 * is the one that is easy to break:
 *
 *   "Enable 3D → Engine creates camera, lighting, environment, default
 *    material, shadows, perspective."
 *   "Everything remains editable. Nothing becomes a mesh. Nothing leaves the
 *    document model."
 *
 * So the tests below check that one press produces a lit solid — and that the
 * node is still a rect afterwards, still carries its own width, height and
 * fill, and can be put back exactly as it was with one undo. A feature that
 * converted a rect into a mesh would satisfy the first half and destroy the
 * product.
 */
import { describe, expect, it } from "vitest";
import {
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  applyTransaction,
  findNode,
  generateKeyBetween,
  invertTransaction,
  serialize,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";

import { testIdFactory } from "./studio/ids";
import {
  DEFAULT_DEPTH,
  DEFAULT_FINISH,
  FINISHES,
  applyFinish,
  applyFinishEverywhere,
  applyFinishTo,
  canFinish,
  disableDepthEverywhere,
  enableDepth,
  enableDepthEverywhere,
  finishOf,
  finishOfAll,
  graphicFinish,
  graphicHasDepth,
  hasDepth,
  rectNodeIds,
  setDepth,
} from "./studio/finishes";
import { createNode, hasLight, setProps } from "./studio/editing";
import { newDocument } from "./studio/project";

const TIME = "2026-01-01T00:00:00.000Z";

function rect(id: string, order: string, name: string): SceneNode {
  return {
    id,
    name,
    order,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width: 2, height: 0.5 },
    components: [
      { id: `cmp_${id}`, type: "rect", props: { width: 2, height: 0.5, fill: "#1B2430" } },
    ],
    children: [],
  } as unknown as SceneNode;
}

function documentWith(nodes: readonly SceneNode[]): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scene_depth",
    meta: { name: "Depth", createdAt: TIME, updatedAt: TIME },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 50 },
      pixelsPerUnit: 100,
    },
    variables: [],
    assets: [],
    states: [],
    root: {
      id: "node_root",
      name: "Root",
      order: generateKeyBetween(null, null),
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      components: [],
      children: nodes,
    },
  } as unknown as SceneDocument;
}

function lowerThird(): SceneDocument {
  const a = generateKeyBetween(null, null);
  const b = generateKeyBetween(a, null);
  return documentWith([rect("node_plate", a, "Background"), rect("node_bar", b, "Accent Bar")]);
}

describe("one press, a lit solid", () => {
  it("gives the graphic depth AND the lighting it needs, in one transaction", () => {
    // A lit surface in an unlit scene renders BLACK. If the lighting were a
    // second step, the first press would produce something visibly broken —
    // and asking a beginner to know that a solid needs a light is exactly the
    // engine concept the product exists to hide.
    const before = lowerThird();
    expect(hasLight(before)).toBe(false);

    const txn = enableDepthEverywhere(before, testIdFactory())!;
    expect(txn).not.toBeNull();
    const after = applyTransaction(before, txn);

    expect(graphicHasDepth(after)).toBe(true);
    expect(hasLight(after), "a solid with no light renders black").toBe(true);
  });

  it("lights the scene ONCE, however many rects the graphic has", () => {
    // `lightingOperations` reads the document as it stands, so calling it per
    // node would add a rig per rectangle. Two plates, one rig.
    const after = applyTransaction(
      lowerThird(),
      enableDepthEverywhere(lowerThird(), testIdFactory())!,
    );
    const lights = (after.root.children ?? []).filter((node) =>
      (node.components ?? []).some((component) => component.type === "light"),
    );
    // A key and a fill. Not one, and not four.
    expect(lights).toHaveLength(2);
  });

  it("adds no lighting when the scene already has some", () => {
    const base = lowerThird();
    const first = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);
    const flat = applyTransaction(first, disableDepthEverywhere(first)!);

    const again = applyTransaction(flat, enableDepthEverywhere(flat, testIdFactory())!);
    const lights = (again.root.children ?? []).filter((node) =>
      (node.components ?? []).some((component) => component.type === "light"),
    );
    expect(lights, "flattening leaves the rig; re-enabling must not add a second").toHaveLength(2);
  });

  it("applies the safe finish by default, not a showy one", () => {
    const base = lowerThird();
    const after = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);
    expect(graphicFinish(after)?.id).toBe(DEFAULT_FINISH.id);
    expect(DEFAULT_FINISH.id, "the default must be the neutral one").toBe("broadcast");
  });
});

describe("nothing becomes a mesh", () => {
  it("leaves the node a rect, with its own width, height and fill intact", () => {
    // The half of the specification that is easy to break. A feature that
    // swapped the component for a mesh would look identical on screen and
    // would have taken the graphic out of the document model.
    const base = lowerThird();
    const after = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);

    const node = findNode(after.root, "node_plate")!;
    const component = (node.components ?? [])[0]!;
    expect(component.type).toBe("rect");

    const props = component.props as Record<string, unknown>;
    expect(props.width).toBe(2);
    expect(props.height).toBe(0.5);
    expect(props.fill).toBe("#1B2430");
    expect(props.depth).toBe(DEFAULT_DEPTH);
  });

  it("is still a serialisable scene document afterwards", () => {
    const base = lowerThird();
    const after = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);
    expect(() => serialize(after)).not.toThrow();
  });
});

describe("one undo puts it back exactly", () => {
  it("returns the document byte-for-byte, lighting included", () => {
    // A person who presses this and dislikes it must be one keystroke from
    // where they started, or they will not press it a second time.
    const before = lowerThird();
    const bytes = serialize(before);

    const txn = enableDepthEverywhere(before, testIdFactory())!;
    const after = applyTransaction(before, txn);
    expect(serialize(after)).not.toBe(bytes);

    const undone = applyTransaction(after, invertTransaction(txn));
    expect(serialize(undone)).toBe(bytes);
  });

  it("is ONE transaction, not one per rectangle", () => {
    const base = lowerThird();
    const txn = enableDepthEverywhere(base, testIdFactory())!;
    expect(txn.label).toBe("Enable 3D");
    // Two lights, plus five props on each of two rects.
    expect(txn.operations.length).toBe(2 + 5 * 2);
  });
});

describe("back to flat", () => {
  it("removes the depth and the generated material values", () => {
    const base = lowerThird();
    const solid = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);
    const flat = applyTransaction(solid, disableDepthEverywhere(solid)!);

    expect(graphicHasDepth(flat)).toBe(false);
    const props = (findNode(flat.root, "node_plate")!.components ?? [])[0]!.props as Record<
      string,
      unknown
    >;
    expect(props.depth).toBe(0);
    // Cleared, not left behind — `#applyRect` switches to a lit material on
    // the PRESENCE of these, so a leftover roughness keeps the surface lit
    // and black in an unlit scene.
    expect(props.metallic).toBeUndefined();
    expect(props.roughness).toBeUndefined();
  });

  it("leaves the lighting alone", () => {
    // The rig belongs to the scene, not to this graphic. Other objects may be
    // using it, and silently deleting a light because one rect went flat is
    // the kind of tidying that loses somebody's work.
    const base = lowerThird();
    const solid = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);
    const flat = applyTransaction(solid, disableDepthEverywhere(solid)!);
    expect(hasLight(flat)).toBe(true);
  });
});

describe("finishes are named by outcome", () => {
  it("offers every finish the founder named, and no PBR words", () => {
    // The founder's list: Matte, Plastic, Chrome, Glass, Emissive, Broadcast —
    // plus Soft, Bold and Premium from the Design OS material section. Every
    // one of them is here, and the test names them so a quiet removal fails.
    const labels = FINISHES.map((finish) => finish.label);
    for (const required of [
      "Matte",
      "Plastic",
      "Chrome",
      "Glass",
      "Emissive",
      "Broadcast",
    ]) {
      expect(labels, `"${required}" is a founder-approved finish`).toContain(required);
    }
    expect(labels).toEqual([
      "Broadcast",
      "Matte",
      "Soft",
      "Plastic",
      "Bold",
      "Premium",
      "Chrome",
      "Emissive",
      "Glass",
    ]);
    for (const finish of FINISHES) {
      const text = `${finish.label} ${finish.hint}`.toLowerCase();
      // The PARAMETER names the founder forbade, not the English words. A
      // hint may say "brushed metal" — that is what the surface looks like.
      // It may never say "metalness 0.62", which is what the engine was told.
      for (const word of [
        "metalness",
        "metallic",
        "roughness",
        "specular",
        " ior",
        "transmission",
        "pbr",
        "albedo",
        "fresnel",
      ]) {
        expect(text, `"${finish.label}" leaks "${word}"`).not.toContain(word);
      }
    }
  });

  it("writes the GENERATED numbers into the document, not the name alone", () => {
    // The engine must never have to know what chrome means — that would be a
    // broadcast noun inside SCENE_FORMAT, which §7 refuses.
    const base = lowerThird();
    const solid = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);
    const chrome = FINISHES.find((finish) => finish.id === "chrome")!;
    const after = applyTransaction(solid, applyFinishEverywhere(solid, chrome)!);

    const props = (findNode(after.root, "node_plate")!.components ?? [])[0]!.props as Record<
      string,
      unknown
    >;
    expect(props.metallic).toBe(chrome.metallic);
    expect(props.roughness).toBe(chrome.roughness);
    expect(finishOf(after, "node_plate")?.id).toBe("chrome");
  });

  it("stops claiming a finish once somebody edits the numbers by hand", () => {
    // An advanced user who nudged roughness has a graphic that is no longer
    // Chrome, and a picker that went on saying it was would be lying about
    // what is being rendered.
    const base = lowerThird();
    const solid = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);
    const chrome = FINISHES.find((finish) => finish.id === "chrome")!;
    const withChrome = applyTransaction(solid, applyFinishEverywhere(solid, chrome)!);
    expect(finishOf(withChrome, "node_plate")?.id).toBe("chrome");

    const nudged = applyTransaction(
      withChrome,
      setDepth(withChrome, "node_plate", 0.2)!,
    );
    // Depth alone does not change the finish.
    expect(finishOf(nudged, "node_plate")?.id).toBe("chrome");

    // Edited through the same path the Properties panel uses.
    const byHand = setProps(
      nudged,
      "node_plate",
      new Map([["components.0.props.roughness", 0.41]]),
      "Set roughness",
    )!;
    const manual = applyTransaction(nudged, byHand);
    expect(finishOf(manual, "node_plate")).toBeNull();
  });

  it("restores opacity when moving off Glass", () => {
    // Glass is the only see-through finish. Switching away must not leave the
    // graphic ghosted.
    const base = lowerThird();
    const solid = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);
    const glass = FINISHES.find((finish) => finish.id === "glass")!;
    const matte = FINISHES.find((finish) => finish.id === "matte")!;

    const ghosted = applyTransaction(solid, applyFinishEverywhere(solid, glass)!);
    const props = (id: SceneDocument) =>
      (findNode(id.root, "node_plate")!.components ?? [])[0]!.props as Record<string, unknown>;
    expect(props(ghosted).opacity).toBe(glass.opacity);

    const opaque = applyTransaction(ghosted, applyFinishEverywhere(ghosted, matte)!);
    expect(props(opaque).opacity).toBe(1);
  });
});

describe("single node", () => {
  it("enables depth on one rect without touching its siblings", () => {
    const base = lowerThird();
    const after = applyTransaction(
      base,
      enableDepth(base, "node_plate", testIdFactory())!,
    );
    expect(hasDepth(after, "node_plate")).toBe(true);
    expect(hasDepth(after, "node_bar")).toBe(false);
  });

  it("finds every rect in the graphic, at any depth in the tree", () => {
    expect([...rectNodeIds(lowerThird())]).toEqual(["node_plate", "node_bar"]);
  });
});

describe("emissive is unlit, and that is the mechanism", () => {
  it("writes NO metallic or roughness, so the surface ignores the lighting", () => {
    // The engine decides lit-or-unlit on whether these props are present.
    // Writing zeroes would produce a BLACK lit material rather than a glowing
    // unlit one — the absence is the whole feature.
    const base = lowerThird();
    const solid = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);
    const emissive = FINISHES.find((finish) => finish.id === "emissive")!;
    const after = applyTransaction(solid, applyFinishEverywhere(solid, emissive)!);

    const props = (findNode(after.root, "node_plate")!.components ?? [])[0]!.props as Record<
      string,
      unknown
    >;
    expect(props.metallic).toBeUndefined();
    expect(props.roughness).toBeUndefined();
    // Still a solid: depth is untouched by a finish.
    expect(props.depth).toBe(DEFAULT_DEPTH);
    expect(finishOf(after, "node_plate")?.id).toBe("emissive");
  });

  it("goes back to a lit finish without leaving the surface unlit", () => {
    const base = lowerThird();
    const solid = applyTransaction(base, enableDepthEverywhere(base, testIdFactory())!);
    const emissive = FINISHES.find((finish) => finish.id === "emissive")!;
    const chrome = FINISHES.find((finish) => finish.id === "chrome")!;

    const glowing = applyTransaction(solid, applyFinishEverywhere(solid, emissive)!);
    const lit = applyTransaction(glowing, applyFinishEverywhere(glowing, chrome)!);

    const props = (findNode(lit.root, "node_plate")!.components ?? [])[0]!.props as Record<
      string,
      unknown
    >;
    expect(props.metallic).toBe(chrome.metallic);
    expect(props.roughness).toBe(chrome.roughness);
    expect(finishOf(lit, "node_plate")?.id).toBe("chrome");
  });
});

/**
 * The same finishes, on a 3D object.
 *
 * ============================================================================
 * ONE VOCABULARY, TWO COMPONENT SHAPES
 * ============================================================================
 * A rect keeps its material values on its props; a meshRenderer keeps them
 * under `material`. If that difference became two finish systems, "Chrome"
 * would mean one thing on a plate and something else on a plinth — and a set
 * dressed from both would never quite match.
 *
 * These assert that it did not.
 */
describe("finishes on a 3D object", () => {
  const withBox = () => {
    const factory = testIdFactory();
    const document = newDocument("Set", factory);
    const created = createNode(document, "box", document.root.id, factory);
    return {
      document: applyTransaction(document, created.transaction),
      nodeId: created.nodeId,
    };
  };

  it("puts a finish on a mesh, under the material where the engine reads it", () => {
    const { document, nodeId } = withBox();
    const chrome = FINISHES.find((finish) => finish.id === "chrome")!;
    const next = applyTransaction(document, applyFinish(document, nodeId, chrome)!);

    const node = findNode(next.root, nodeId)!;
    const mesh = (node.components ?? []).find((c) => c.type === "meshRenderer")!;
    const material = (mesh.props as { material: Record<string, unknown> }).material;
    expect(material.metallic).toBe(chrome.metallic);
    expect(material.roughness).toBe(chrome.roughness);
  });

  it("reads back the finish it wrote", () => {
    const { document, nodeId } = withBox();
    for (const finish of FINISHES) {
      const next = applyTransaction(document, applyFinish(document, nodeId, finish)!);
      expect(finishOf(next, nodeId)?.id, finish.label).toBe(finish.id);
    }
  });

  /**
   * Emissive is identified by ABSENCE, and that has to survive the extra level
   * of nesting a mesh's material sits at. A zero written here rather than an
   * undefined would produce a black lit surface — the exact opposite of "glows
   * on its own".
   */
  it("keeps Emissive unlit on a mesh, by writing nothing rather than zero", () => {
    const { document, nodeId } = withBox();
    const emissive = FINISHES.find((finish) => finish.selfLit === true)!;
    const next = applyTransaction(document, applyFinish(document, nodeId, emissive)!);

    const node = findNode(next.root, nodeId)!;
    const mesh = (node.components ?? []).find((c) => c.type === "meshRenderer")!;
    const material = (mesh.props as { material: Record<string, unknown> }).material;
    expect(material.metallic).toBeUndefined();
    expect(material.roughness).toBeUndefined();
  });

  it("dresses a whole selection in one undo step", () => {
    const factory = testIdFactory();
    let document = newDocument("Set", factory);
    const created: string[] = [];
    for (const kind of ["box", "sphere", "rect"] as const) {
      const result = createNode(document, kind, document.root.id, factory);
      document = applyTransaction(document, result.transaction);
      created.push(result.nodeId);
    }

    const matte = FINISHES.find((finish) => finish.id === "matte")!;
    const applied = applyFinishTo(document, created, matte)!;
    const next = applyTransaction(document, applied);

    // One transaction, three objects, and a rect among them — the point being
    // that a set is dressed from one vocabulary whatever it is made of.
    expect(finishOfAll(next, created)?.id).toBe("matte");
    expect(canFinish(next, created)).toBe(true);
  });

  it("reports no shared finish when the selection disagrees", () => {
    const factory = testIdFactory();
    let document = newDocument("Set", factory);
    const created: string[] = [];
    for (const kind of ["box", "sphere"] as const) {
      const result = createNode(document, kind, document.root.id, factory);
      document = applyTransaction(document, result.transaction);
      created.push(result.nodeId);
    }
    document = applyTransaction(
      document,
      applyFinish(document, created[0]!, FINISHES.find((f) => f.id === "chrome")!)!,
    );
    document = applyTransaction(
      document,
      applyFinish(document, created[1]!, FINISHES.find((f) => f.id === "matte")!)!,
    );
    expect(finishOfAll(document, created)).toBeNull();
  });

  it("offers nothing to finish on a light or a camera", () => {
    const factory = testIdFactory();
    const document = newDocument("Set", factory);
    const light = createNode(document, "light", document.root.id, factory);
    const next = applyTransaction(document, light.transaction);
    expect(canFinish(next, [light.nodeId])).toBe(false);
    expect(applyFinishTo(next, [light.nodeId], FINISHES[0]!)).toBeNull();
  });
});
