/**
 * The confidence strip's arithmetic, against a real host.
 *
 * ============================================================================
 * THE ONE TEST THAT MATTERS
 * ============================================================================
 * "Fits at 16:9, breaks at 9:16." That is the failure the strip exists to
 * catch, and everything else here supports it. If a change ever makes every
 * format agree, the strip has become decoration and this file should fail.
 *
 * These read world matrices out of a live `SceneHost` mirror — the same source
 * the viewport, the gizmos and the align commands read — rather than deriving
 * bounds from the document. Two measurements of the same graphic is how a
 * warning ends up pointing at a place the layer is not.
 */
import { describe, expect, it } from "vitest";
import {
  SCENE_FORMAT_ID,
  SCENE_FORMAT_VERSION,
  generateKeyBetween,
  type SceneDocument,
  type SceneNode,
} from "@bracketx/engine-scene";
import { SceneHost } from "@bracketx/engine-host";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import type { TextDraw, TextProvider, TextRequest } from "@bracketx/engine-reconciler";

import {
  SECONDARY_FORMATS,
  checkFormat,
  checkFormats,
  cropFor,
  formatsFor,
  primaryFormat,
  textNodes,
  titleSafeWorld,
  visibleWorld,
  type DeliveryFormat,
} from "./studio/formats";
import { nodeBounds } from "./studio/viewport";

/** Same shape of decision as the real shaper: content against box, in pixels. */
class TinyShaper implements TextProvider {
  draw(request: TextRequest): TextDraw | null {
    const needed = request.content.length * request.size * 0.6;
    return {
      batches: [
        {
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
          uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
          indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
          page: 0,
        },
      ],
      pxRange: 4,
      atlasKeys: ["k"],
      truncated: false,
      overflowed: needed > request.box.width,
      brokeWithoutOpportunity: false,
      resolvedSize: request.size,
    };
  }
  pages() {
    return [{ width: 4, height: 4, pixels: new Uint8Array(64), revision: 1 }];
  }
  flushDirty() {
    return [];
  }
  pin(): void {}
  unpin(): void {}
}

const TIME = "2026-01-01T00:00:00.000Z";
const ORTHO = 5;

function textNode(
  id: string,
  order: string,
  name: string,
  content: string,
  x: number,
  boxWidth: number,
): SceneNode {
  return {
    id,
    name,
    order,
    transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width: boxWidth, height: 0.3 },
    components: [
      {
        id: `cmp_${id}`,
        type: "text",
        props: {
          content,
          font: { assetId: "font_a", size: 36 },
          color: "#ffffff",
          fit: { mode: "overflow" },
        },
      },
    ],
    children: [],
  } as unknown as SceneNode;
}

function plate(id: string, order: string, x: number, width: number): SceneNode {
  return {
    id,
    name: "Plate",
    order,
    transform: { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    size: { width, height: 0.6 },
    components: [
      { id: `cmp_${id}`, type: "mesh", props: { primitive: "plane" } },
    ],
    children: [],
  } as unknown as SceneNode;
}

function camera(order: string): SceneNode {
  return {
    id: "node_camera",
    name: "Camera",
    order,
    transform: { position: [0, 0, 10], rotation: [0, 0, 0], scale: [1, 1, 1] },
    components: [
      {
        id: "cmp_camera",
        type: "camera",
        props: { projection: "orthographic", orthographicSize: ORTHO, near: 0.1, far: 100 },
      },
    ],
    children: [],
  } as unknown as SceneNode;
}

function documentWith(nodes: readonly SceneNode[]): SceneDocument {
  return {
    format: SCENE_FORMAT_ID,
    version: SCENE_FORMAT_VERSION,
    id: "scene_formats",
    meta: { name: "Formats", createdAt: TIME, updatedAt: TIME },
    world: {
      units: "meters",
      up: "Y",
      handedness: "right",
      output: { width: 1920, height: 1080, fps: 50 },
      pixelsPerUnit: 100,
    },
    variables: [],
    assets: [{ id: "font_a", kind: "font", uri: "font_a" }],
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

function checksFor(document: SceneDocument) {
  const host = new SceneHost(new MockMirrorBackend(), {
    defaultOutput: true,
    text: new TinyShaper(),
  });
  host.load(document);
  const bounds = nodeBounds(document, (id) => host.reconciler.mirror.get(id)?.worldMatrix);
  return checkFormats(document, bounds, host.reconciler.projector.textFacts());
}

function orders(count: number): string[] {
  const out: string[] = [];
  let previous: string | null = null;
  for (let index = 0; index < count; index += 1) {
    previous = generateKeyBetween(previous, null);
    out.push(previous);
  }
  return out;
}

const VERTICAL = SECONDARY_FORMATS.find((f) => f.id === "vertical")!;
const WIDE: DeliveryFormat = { id: "1080", name: "16:9", width: 1920, height: 1080 };

// ---------------------------------------------------------------------------

describe("the window each format opens", () => {
  it("keeps the world HEIGHT and changes only the width", () => {
    // This is the whole mechanism. If it ever stops being true, every
    // per-format finding below is measuring the wrong thing.
    const document = documentWith([camera(generateKeyBetween(null, null))]);
    const wide = visibleWorld(document, WIDE);
    const tall = visibleWorld(document, VERTICAL);

    expect(wide.halfHeight).toBe(ORTHO);
    expect(tall.halfHeight).toBe(ORTHO);
    expect(tall.halfWidth).toBeLessThan(wide.halfWidth);
    expect(wide.halfWidth).toBeCloseTo(ORTHO * (16 / 9), 5);
    expect(tall.halfWidth).toBeCloseTo(ORTHO * (9 / 16), 5);
  });

  it("reads the safe fraction the document declares, not a constant", () => {
    const base = documentWith([camera(generateKeyBetween(null, null))]);
    const strict = {
      ...base,
      world: { ...base.world, safeAreas: { title: 0.8, action: 0.9 } },
    } as SceneDocument;

    expect(titleSafeWorld(base, WIDE).width).toBeCloseTo(ORTHO * (16 / 9) * 2 * 0.9, 5);
    expect(titleSafeWorld(strict, WIDE).width).toBeCloseTo(ORTHO * (16 / 9) * 2 * 0.8, 5);
  });
});

describe("the primary is in the list, checked on the same terms", () => {
  it("puts the document's own output first", () => {
    const document = documentWith([camera(generateKeyBetween(null, null))]);
    const list = formatsFor(document);
    expect(list[0]).toEqual(primaryFormat(document));
    expect(list[0]!.name).toBe("16:9");
  });

  it("does not list the primary twice when a secondary matches it", () => {
    const base = documentWith([camera(generateKeyBetween(null, null))]);
    const at720 = {
      ...base,
      world: { ...base.world, output: { width: 1280, height: 720, fps: 50 } },
    } as SceneDocument;

    const sizes = formatsFor(at720).map((f) => `${f.width}x${f.height}`);
    expect(sizes.filter((size) => size === "1280x720")).toHaveLength(1);
  });

  it("reports a finding on the primary rather than exempting it", () => {
    // The recorded failure: "a clipped name on the main canvas with no warning
    // anywhere". A strip that only checks the secondaries reproduces it.
    const [a, b] = orders(2);
    const document = documentWith([
      camera(a!),
      // Beyond title safe at 16:9 itself: safe half-width is 8.0.
      textNode("n_name", b!, "Name", "Amara", 7.5, 2),
    ]);

    const primary = checksFor(document)[0]!;
    expect(primary.format.id).toBe("primary");
    expect(primary.clear).toBe(false);
    expect(primary.issues[0]!.kind).toBe("unsafe");
  });
});

describe("fits at 16:9, breaks at 9:16", () => {
  it("is clear in the wide formats and unsafe in the vertical one", () => {
    const [a, b] = orders(2);
    // Spans x in [1.4, 3.4]. Title safe is 8.0 half-wide at 16:9 and 2.53 at
    // 9:16, so the same words are comfortable in one and over the line in the
    // other without a byte of the document changing.
    const document = documentWith([camera(a!), textNode("n_name", b!, "Name", "Amara", 2.4, 2)]);
    const checks = checksFor(document);

    const by = (id: string) => checks.find((check) => check.format.id === id)!;
    // The wide shapes are comfortable. 2160p and 720p used to be checked here
    // and were pure noise: both are 16:9, so both are the same crop as the
    // primary and could never disagree with it.
    expect(by("primary").clear).toBe(true);
    expect(by("sd").clear).toBe(true);

    const vertical = by("vertical");
    expect(vertical.clear).toBe(false);
    expect(vertical.issues).toHaveLength(1);
    expect(vertical.issues[0]!.kind).toBe("unsafe");
    // The author's name for the layer, so a person can act on it.
    expect(vertical.issues[0]!.label).toBe("Name");
    expect(vertical.issues[0]!.nodeId).toBe("n_name");
    expect(vertical.issues[0]!.detail).toContain("9:16");
  });

  it("says off-frame, not merely unsafe, when the words leave the picture", () => {
    const [a, b] = orders(2);
    // Frame half-width at 9:16 is 2.8125; this sits entirely beyond it.
    const document = documentWith([camera(a!), textNode("n_name", b!, "Name", "Amara", 4.5, 2)]);
    const checks = checksFor(document);

    expect(checks.find((c) => c.format.id === "primary")!.clear).toBe(true);
    const vertical = checks.find((c) => c.format.id === "vertical")!;
    expect(vertical.issues[0]!.kind).toBe("off-frame");
    expect(vertical.issues[0]!.detail).toContain("not be on screen");
  });

  it("is clear everywhere for a graphic that sits in the middle", () => {
    const [a, b] = orders(2);
    const document = documentWith([camera(a!), textNode("n_name", b!, "Name", "Amara", 0, 2)]);
    expect(checksFor(document).every((check) => check.clear)).toBe(true);
  });
});

describe("what is NOT warned about", () => {
  it("lets a plate bleed off the frame without lighting a lamp", () => {
    // A breaking strap is DESIGNED to run off both edges. Warning about it
    // would train people to ignore the lamp, which costs more than it saves.
    const [a, b] = orders(2);
    const document = documentWith([camera(a!), plate("n_plate", b!, 0, 40)]);
    expect(checksFor(document).every((check) => check.clear)).toBe(true);
  });

  it("finds text nodes and nothing else", () => {
    const [a, b, c] = orders(3);
    const document = documentWith([
      camera(a!),
      plate("n_plate", b!, 0, 4),
      textNode("n_name", c!, "Name", "Amara", 0, 2),
    ]);
    expect([...textNodes(document).keys()]).toEqual(["n_name"]);
  });
});

describe("overflow breaks every format, so every tile says so", () => {
  it("reports the shaper's verdict on all of them", () => {
    // A box too small for its own words is clipped in 16:9 and in 9:16 alike.
    // A tile that stayed green would be exactly the lie the strip exists to
    // stop, and it is worth one repeated finding to avoid it.
    const [a, b] = orders(2);
    const document = documentWith([
      camera(a!),
      textNode("n_name", b!, "Correspondent", "Konstantinos Papadopoulos", 0, 0.5),
    ]);
    const checks = checksFor(document);

    expect(checks).toHaveLength(4);
    for (const check of checks) {
      expect(check.clear, check.format.name).toBe(false);
      expect(
        check.issues.some((issue) => issue.kind === "overflow"),
        check.format.name,
      ).toBe(true);
    }
  });
});

describe("the tile shows the engine's own pixels", () => {
  it("crops horizontally for a narrower format, at full height", () => {
    const crop = cropFor(WIDE, VERTICAL);
    expect(crop.source).toBeCloseTo(9 / 16 / (16 / 9), 6);
    expect(crop.covers).toBe(1);
  });

  it("takes the whole frame for a format of the same shape", () => {
    const crop = cropFor(WIDE, { id: "2160", name: "2160p", width: 3840, height: 2160 });
    expect(crop.source).toBeCloseTo(1, 6);
    expect(crop.covers).toBeCloseTo(1, 6);
  });

  it("pillar-boxes rather than stretching when the format is wider", () => {
    // The engine is simply not drawing those sides. Stretching the picture to
    // fill the tile would misreport the exact thing being checked.
    const ultra: DeliveryFormat = { id: "ultra", name: "21:9", width: 2560, height: 1080 };
    const crop = cropFor(WIDE, ultra);
    expect(crop.source).toBe(1);
    expect(crop.covers).toBeCloseTo((16 / 9) / (2560 / 1080), 6);
    expect(crop.covers).toBeLessThan(1);
  });
});

describe("checkFormat in isolation", () => {
  it("returns the crop alongside the findings, so a tile needs one call", () => {
    const document = documentWith([camera(generateKeyBetween(null, null))]);
    const check = checkFormat(document, VERTICAL, [], new Map());
    expect(check.clear).toBe(true);
    expect(check.crop.source).toBeCloseTo(cropFor(primaryFormat(document), VERTICAL).source, 6);
  });
});
