/**
 * Paint tests.
 *
 * These assert PIXELS, not calls. A gradient that runs the wrong way, a stroke
 * that grows the shape, or a shadow clipped by its own quad are all failures a
 * "createTexture was called" test passes cleanly — and all three are failures a
 * founder sees immediately.
 */
import { describe, expect, it } from "vitest";

import {
  buildRamp,
  isFlatPaint,
  paintKey,
  parseSrgb,
  rasterisePaint,
  readPaint,
  roundedBoxDistance,
  type PaintSpec,
} from "./paint";
import { MockMirrorBackend } from "./mock-backend";
import { Reconciler } from "./reconciler";
import {
  applyTransaction,
  createSequentialIdFactory,
  generateKeyBetween,
  makeRemoveNode,
  makeSetProp,
  type SceneDocument,
  type SceneNode,
  type SceneOperation,
  type Transaction,
} from "@bracketx/engine-scene";

/** Straight alpha and straight-ish channel read back out of a raster. */
function texelAt(
  raster: NonNullable<ReturnType<typeof rasterisePaint>>,
  u: number,
  v: number,
): { r: number; g: number; b: number; a: number } {
  const { width, height, pixels } = raster.texture;
  const x = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))));
  const y = Math.min(height - 1, Math.max(0, Math.round(v * (height - 1))));
  const offset = (y * width + x) * 4;
  return {
    r: pixels[offset]!,
    g: pixels[offset + 1]!,
    b: pixels[offset + 2]!,
    a: pixels[offset + 3]!,
  };
}

describe("colour parsing", () => {
  it("reads every hex length, and alpha", () => {
    expect(parseSrgb("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseSrgb("2F6FEB")).toEqual({ r: 0x2f, g: 0x6f, b: 0xeb, a: 1 });
    expect(parseSrgb("#00000080").a).toBeCloseTo(128 / 255, 3);
  });

  it("returns white for a malformed colour rather than throwing", () => {
    // A document must render something. A throw here stops a show.
    expect(parseSrgb("rebeccapurple")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
  });
});

describe("gradient ramp", () => {
  it("interpolates in sRGB between the stops it was given", () => {
    const ramp = buildRamp([
      { at: 0, color: "#000000" },
      { at: 1, color: "#ffffff" },
    ]);
    expect(ramp.r[0]).toBe(0);
    expect(ramp.r[255]).toBe(255);
    // The midpoint is the sRGB midpoint — 128, not the linear-light 188. This
    // is the assertion that pins the design decision in paint.ts.
    expect(ramp.r[128]).toBeGreaterThan(120);
    expect(ramp.r[128]).toBeLessThan(136);
  });

  it("sorts stops the document gave out of order", () => {
    const ramp = buildRamp([
      { at: 1, color: "#ffffff" },
      { at: 0, color: "#000000" },
    ]);
    expect(ramp.r[0]).toBe(0);
    expect(ramp.r[255]).toBe(255);
  });

  it("carries per-stop opacity into the ramp's alpha", () => {
    const ramp = buildRamp([
      { at: 0, color: "#ffffff", opacity: 0 },
      { at: 1, color: "#ffffff", opacity: 1 },
    ]);
    expect(ramp.a[0]).toBeCloseTo(0, 3);
    expect(ramp.a[255]).toBeCloseTo(1, 3);
  });
});

describe("rounded box distance", () => {
  it("is negative inside, zero on the edge, positive outside", () => {
    expect(roundedBoxDistance(0, 0, 1, 1, [0, 0, 0, 0])).toBeCloseTo(-1, 5);
    expect(roundedBoxDistance(1, 0, 1, 1, [0, 0, 0, 0])).toBeCloseTo(0, 5);
    expect(roundedBoxDistance(2, 0, 1, 1, [0, 0, 0, 0])).toBeCloseTo(1, 5);
  });

  it("cuts the corner a radius asks it to", () => {
    // The very corner of a fully rounded square is outside the shape.
    expect(roundedBoxDistance(1, 1, 1, 1, [1, 1, 1, 1])).toBeGreaterThan(0);
    // And the same point on a square one is exactly on the edge.
    expect(roundedBoxDistance(1, 1, 1, 1, [0, 0, 0, 0])).toBeCloseTo(0, 5);
  });

  it("picks the radius by quadrant, so one corner can round alone", () => {
    const corners = [1, 0, 0, 0] as const;
    // Bottom-left is rounded away; bottom-right is not.
    expect(roundedBoxDistance(-1, -1, 1, 1, corners)).toBeGreaterThan(0);
    expect(roundedBoxDistance(1, -1, 1, 1, corners)).toBeCloseTo(0, 5);
  });
});

describe("reading a paint from a document", () => {
  it("returns undefined for a paint that asks for nothing", () => {
    expect(readPaint(undefined)).toBeUndefined();
    expect(readPaint({})).toBeUndefined();
    expect(readPaint({ cornerRadius: 0 })).toBeUndefined();
  });

  it("refuses a one-stop gradient rather than inventing a second stop", () => {
    expect(readPaint({ gradient: { stops: [{ at: 0, color: "#fff" }] } })).toBeUndefined();
  });

  it("survives a malformed shape instead of throwing", () => {
    // SCENE_FORMAT §13 rules 1–3. A bound variable can deliver any of these.
    expect(readPaint(7)).toBeUndefined();
    expect(readPaint(null)).toBeUndefined();
    expect(readPaint({ gradient: "blue", stroke: 4, shadow: [] })).toBeUndefined();
  });

  it("keeps what it recognises and drops what it does not", () => {
    const spec = readPaint({
      cornerRadius: 0.2,
      gradient: {
        kind: "linear",
        angle: 90,
        stops: [
          { at: 0, color: "#000" },
          { at: 1, color: "#fff" },
        ],
      },
      stroke: { color: "#fff", width: 0.01 },
      nonsense: true,
    });
    expect(spec?.cornerRadius).toBe(0.2);
    expect(spec?.gradient?.angle).toBe(90);
    expect(spec?.stroke?.width).toBe(0.01);
    expect(spec).not.toHaveProperty("nonsense");
  });

  it("drops a shadow that would be invisible", () => {
    expect(readPaint({ shadow: { color: "#000", blur: 0 } })).toBeUndefined();
    // Offset with no blur is a hard shadow, and it IS visible.
    expect(
      readPaint({ shadow: { color: "#000", blur: 0, offsetY: -0.05 } }),
    ).toBeDefined();
  });
});

describe("rasterising", () => {
  it("runs a 0-degree linear gradient left to right", () => {
    const raster = rasterisePaint(
      {
        gradient: {
          kind: "linear",
          angle: 0,
          stops: [
            { at: 0, color: "#000000" },
            { at: 1, color: "#ffffff" },
          ],
        },
      },
      2,
      1,
      "#ff0000",
    )!;
    expect(raster).toBeDefined();
    const left = texelAt(raster, 0.02, 0.5);
    const right = texelAt(raster, 0.98, 0.5);
    expect(left.r).toBeLessThan(right.r);
    expect(left.a).toBe(255);
    expect(right.a).toBe(255);
  });

  it("runs a 90-degree linear gradient bottom to top, not top to bottom", () => {
    // Row zero is the BOTTOM row — the convention `quadDescriptor` samples with.
    // Getting this backwards flips every gradient in the library.
    const raster = rasterisePaint(
      {
        gradient: {
          kind: "linear",
          angle: 90,
          stops: [
            { at: 0, color: "#000000" },
            { at: 1, color: "#ffffff" },
          ],
        },
      },
      1,
      2,
      "#ff0000",
    )!;
    expect(texelAt(raster, 0.5, 0.02).r).toBeLessThan(texelAt(raster, 0.5, 0.98).r);
  });

  it("uses the rect's own fill when there is no gradient", () => {
    const raster = rasterisePaint({ cornerRadius: 0.1 }, 1, 1, "#ffffff")!;
    const middle = texelAt(raster, 0.5, 0.5);
    expect(middle.a).toBe(255);
    expect(middle.r).toBe(255);
  });

  it("cuts the corners a radius asks for, and antialiases them", () => {
    const raster = rasterisePaint({ cornerRadius: 0.5 }, 1, 1, "#ffffff")!;
    // Dead corner is outside a fully rounded square.
    expect(texelAt(raster, 0.0, 0.0).a).toBe(0);
    // Centre is inside.
    expect(texelAt(raster, 0.5, 0.5).a).toBe(255);
    // And somewhere along the arc there is partial coverage, which is the
    // difference between a rounded corner and a staircase.
    const edge = texelAt(raster, 0.146, 0.146);
    expect(edge.a).toBeGreaterThan(0);
    expect(edge.a).toBeLessThan(255);
  });

  it("draws a stroke INSIDE the edge, so the shape does not grow", () => {
    const plain = rasterisePaint({ cornerRadius: 0.1 }, 1, 1, "#000000")!;
    const stroked = rasterisePaint(
      { cornerRadius: 0.1, stroke: { color: "#ffffff", width: 0.05 } },
      1,
      1,
      "#000000",
    )!;
    // Same texture size: a stroke changed no dimension.
    expect(stroked.texture.width).toBe(plain.texture.width);
    expect(stroked.texture.height).toBe(plain.texture.height);
    expect(stroked.bleed).toBe(0);
    // Just inside the edge is the stroke colour; the middle is still the fill.
    expect(texelAt(stroked, 0.5, 0.995).r).toBeGreaterThan(200);
    expect(texelAt(stroked, 0.5, 0.5).r).toBeLessThan(20);
  });

  it("reserves room for a shadow instead of clipping it", () => {
    const raster = rasterisePaint(
      { cornerRadius: 0.1, shadow: { color: "#000000", blur: 0.25 } },
      1,
      1,
      "#ffffff",
    )!;
    expect(raster.bleed).toBeCloseTo(0.25, 5);
    expect(raster.quadWidth).toBeCloseTo(1.5, 5);
    expect(raster.quadHeight).toBeCloseTo(1.5, 5);
    // Beyond the shape but inside the quad, there is shadow.
    const outside = texelAt(raster, 0.5, 0.06);
    expect(outside.a).toBeGreaterThan(0);
    // At the very border of the quad it has faded out, so nothing is cut off.
    expect(texelAt(raster, 0.5, 0.0).a).toBeLessThan(12);
  });

  it("offsets a shadow in the direction asked, in a Y-up world", () => {
    const raster = rasterisePaint(
      { shadow: { color: "#000000", blur: 0.1, offsetY: -0.2 } },
      1,
      1,
      "#ffffff",
    )!;
    // Offset is negative Y, so the shadow falls BELOW — nearer row zero.
    const below = texelAt(raster, 0.5, 0.03);
    const above = texelAt(raster, 0.5, 0.97);
    expect(below.a).toBeGreaterThan(above.a);
  });

  it("keeps an inner shadow inside the shape", () => {
    const raster = rasterisePaint(
      { cornerRadius: 0.2, shadow: { color: "#000000", blur: 0.1, inner: true } },
      1,
      1,
      "#ffffff",
    )!;
    // No bleed: an inner shadow needs no room outside.
    expect(raster.bleed).toBe(0);
    // The dead corner is still empty — the shadow did not leak past the edge.
    expect(texelAt(raster, 0.0, 0.0).a).toBe(0);
  });

  it("writes premultiplied pixels, so no channel exceeds its alpha", () => {
    // MirrorBackend C9. A single violated texel is the classic dark halo.
    const raster = rasterisePaint(
      {
        cornerRadius: 0.3,
        gradient: {
          kind: "radial",
          stops: [
            { at: 0, color: "#ffffff", opacity: 1 },
            { at: 1, color: "#ffffff", opacity: 0 },
          ],
        },
        shadow: { color: "#3355ff", blur: 0.2 },
      },
      1.5,
      1,
      "#ffffff",
    )!;
    const { pixels } = raster.texture;
    let violations = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const a = pixels[i + 3]!;
      // +1 of slack for the independent rounding of each channel.
      if (pixels[i]! > a + 1 || pixels[i + 1]! > a + 1 || pixels[i + 2]! > a + 1) {
        violations += 1;
      }
    }
    expect(violations).toBe(0);
  });

  it("reduces density rather than refusing an oversized paint", () => {
    const raster = rasterisePaint({ cornerRadius: 0.5 }, 200, 120, "#ffffff")!;
    expect(raster).toBeDefined();
    expect(raster.texture.width).toBeLessThanOrEqual(2048);
    expect(raster.texture.height).toBeLessThanOrEqual(2048);
  });

  it("refuses a zero-sized box", () => {
    expect(rasterisePaint({ cornerRadius: 1 }, 0, 1, "#fff")).toBeUndefined();
  });

  it("keys identical paints identically and different ones differently", () => {
    const spec: PaintSpec = { cornerRadius: 0.2 };
    expect(paintKey(spec, 1, 1)).toBe(paintKey({ cornerRadius: 0.2 }, 1, 1));
    expect(paintKey(spec, 1, 1)).not.toBe(paintKey(spec, 2, 1));
    expect(paintKey(spec, 1, 1)).not.toBe(paintKey({ cornerRadius: 0.3 }, 1, 1));
  });

  it("calls a paint flat when it asks for nothing a fill cannot do", () => {
    expect(isFlatPaint({})).toBe(true);
    expect(isFlatPaint({ density: 64 })).toBe(true);
    expect(isFlatPaint({ cornerRadius: 0.1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Through the projector — the part that has to hold on air
// ---------------------------------------------------------------------------

const GRADIENT = {
  gradient: {
    kind: "linear",
    angle: 90,
    stops: [
      { at: 0, color: "#2F6FEB" },
      { at: 1, color: "#101319" },
    ],
  },
  cornerRadius: 0.08,
};

function rect(id: string, order: string, paint?: unknown): SceneNode {
  return {
    id,
    name: id,
    order,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    components: [
      {
        id: `cmp_${id}`,
        type: "rect",
        props: {
          width: 1,
          height: 1,
          fill: "#2F6FEB",
          ...(paint === undefined ? {} : { paint }),
        },
      },
    ],
  } as unknown as SceneNode;
}

function documentOf(...children: SceneNode[]): SceneDocument {
  const ids = createSequentialIdFactory();
  return {
    format: "bracketx.scene",
    version: 2,
    id: ids("scene"),
    meta: {
      name: "Paint",
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
      name: "root",
      order: generateKeyBetween(null, null),
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      children,
    } as unknown as SceneNode,
  } as SceneDocument;
}

function harness(): { reconciler: Reconciler; backend: MockMirrorBackend } {
  const backend = new MockMirrorBackend();
  return { reconciler: new Reconciler(backend), backend };
}

/** Applies to the document and projects in one step, as the pipeline does. */
function commit(
  reconciler: Reconciler,
  document: SceneDocument,
  operation: SceneOperation,
): SceneDocument {
  const txn: Transaction = {
    id: "txn",
    label: "test",
    actorId: "test",
    operations: [operation],
  };
  const next = applyTransaction(document, txn);
  reconciler.project(txn, next);
  return next;
}

describe("a painted rect through the projector", () => {
  it("uploads one texture and attaches a mesh that samples it", () => {
    const { reconciler, backend } = harness();
    reconciler.build(documentOf(rect("nod_a", "a0", GRADIENT)));

    expect(backend.liveHandles().textures).toBe(1);
    expect(reconciler.mirror.get("nod_a")?.attachment.kind).toBe("mesh");
  });

  it("shares ONE texture between rects wearing the same paint", () => {
    // A twelve-row leaderboard must not upload twelve identical gradients.
    const { reconciler, backend } = harness();
    reconciler.build(
      documentOf(
        rect("nod_a", "a0", GRADIENT),
        rect("nod_b", "a1", GRADIENT),
        rect("nod_c", "a2", GRADIENT),
      ),
    );
    expect(backend.liveHandles().textures).toBe(1);
  });

  it("gives a differing paint its own texture", () => {
    const { reconciler, backend } = harness();
    reconciler.build(
      documentOf(
        rect("nod_a", "a0", GRADIENT),
        rect("nod_b", "a1", { ...GRADIENT, cornerRadius: 0.2 }),
      ),
    );
    expect(backend.liveHandles().textures).toBe(2);
  });

  it("frees the texture only when the last rect using it goes", () => {
    const { reconciler, backend } = harness();
    const before = documentOf(
      rect("nod_a", "a0", GRADIENT),
      rect("nod_b", "a1", GRADIENT),
    );
    reconciler.build(before);
    expect(backend.liveHandles().textures).toBe(1);

    commit(reconciler, before, makeRemoveNode(before, "nod_a"));
    // Still held by nod_b, so the shared texture must survive.
    expect(backend.liveHandles().textures).toBe(1);
    expect(reconciler.mirror.has("nod_a")).toBe(false);
  });

  it("drops back to a flat fill with no texture when the paint is removed", () => {
    const { reconciler, backend } = harness();
    const painted = documentOf(rect("nod_a", "a0", GRADIENT));
    reconciler.build(painted);
    expect(backend.liveHandles().textures).toBe(1);

    // The gesture an operator makes: clear the paint on a live graphic.
    commit(
      reconciler,
      painted,
      makeSetProp(painted, "nod_a", "components.0.props.paint", undefined),
    );

    expect(backend.liveHandles().textures).toBe(0);
    expect(reconciler.mirror.get("nod_a")?.attachment.kind).toBe("mesh");
  });

  it("leaks nothing when a painted scene is torn down", () => {
    const { reconciler, backend } = harness();
    reconciler.build(
      documentOf(rect("nod_a", "a0", GRADIENT), rect("nod_b", "a1", GRADIENT)),
    );
    reconciler.teardown();
    const live = backend.liveHandles();
    expect(live.textures).toBe(0);
    expect(live.geometries).toBe(0);
    expect(live.materials).toBe(0);
    expect(live.nodes).toBe(0);
  });
});
