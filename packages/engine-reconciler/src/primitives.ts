/**
 * Geometry and colour for components the engine draws from its own format.
 *
 * These live in the reconciler, not in a backend, because they are properties
 * of the SCENE FORMAT rather than of any renderer. A rect is two triangles in
 * every backend; if the backend built it, every future backend would have to
 * agree on winding, UV origin, and units independently — and any disagreement
 * would show up as a swapped texture or a back-face-culled graphic rather than
 * as a type error.
 */
import type { SceneNode } from "@bracketx/engine-scene";

import type { GeometryDescriptor, Rgba } from "./mirror-backend";

/**
 * Where a node's `size` box sits relative to its origin.
 *
 * ==========================================================================
 * THE ENGINE HAS TWO CONVENTIONS, AND THIS IS THE ONLY PLACE THAT SAYS SO
 * ==========================================================================
 * A rect is a quad CENTRED on the node origin — see `quadDescriptor` below,
 * and it is centred for a good reason: a lower third must spin about its own
 * middle rather than its top-left corner.
 *
 * Text is not. The shaper lays a block out in a box whose top-left corner is
 * the origin — a glyph's pen position runs right and down from (0, 0) — and
 * alignment moves the words INSIDE that box rather than moving the box. That
 * is also correct: a name and a role stacked in a lower third are two boxes
 * whose left edges must line up, and centring the box would make a wide field
 * and a narrow field disagree about where their text begins.
 *
 * Both conventions are right and they are different, and until this function
 * existed nothing wrote that down. Studio's `nodeBounds` assumed everything
 * was centred, so a text layer's selection box, its hit area, its snapping
 * candidates and its alignment edges were all half a box-width to the left of
 * the words. Visible the moment anybody clicked a name, and invisible to every
 * test, because both halves were individually self-consistent.
 *
 * Anything that needs a node's box in world space must ask here rather than
 * assume, which is the whole point of it being one function.
 */
export type BoxAnchor = "centre" | "top-left";

export function boxAnchorOf(node: SceneNode): BoxAnchor {
  return (node.components ?? []).some((component) => component.type === "text")
    ? "top-left"
    : "centre";
}

/**
 * The offset from a node's origin to the CENTRE of its box, in local units.
 *
 * Returned as a centre offset because every consumer — bounds, picking,
 * marquee, snapping — works in centre-and-extent form. A caller that had to
 * remember which anchor implied which arithmetic would be a second place the
 * convention lives.
 */
export function boxCentreOffset(
  node: SceneNode,
  width: number,
  height: number,
): { readonly x: number; readonly y: number } {
  return boxAnchorOf(node) === "centre"
    ? { x: 0, y: 0 }
    : { x: width / 2, y: -height / 2 };
}

/**
 * A quad in the XY plane, centred on its node's origin, facing +Z.
 *
 * Centred rather than corner-anchored so that rotation and scale behave the way
 * an operator expects: a lower-third spinning about its own middle, not about
 * its top-left corner. SCENE_FORMAT §5 puts +Y up and +Z toward the viewer, so
 * counter-clockwise winding faces the camera.
 */
export function quadDescriptor(
  width: number,
  height: number,
): GeometryDescriptor {
  const x = width / 2;
  const y = height / 2;

  return {
    positions: new Float32Array([
      -x, -y, 0, // 0 bottom-left
      x, -y, 0, // 1 bottom-right
      x, y, 0, // 2 top-right
      -x, y, 0, // 3 top-left
    ]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    normals: new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]),
    // V origin at the bottom, matching the Y-up convention. Getting this
    // backwards flips every texture, which is invisible until the first image.
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
  };
}

/**
 * A quad carrying UVs for TOP-DOWN image data.
 *
 * ==========================================================================
 * WHY THIS IS NOT `quadDescriptor`
 * ==========================================================================
 * `quadDescriptor` puts V=0 at the BOTTOM, matching the Y-up world convention.
 * That is right for anything whose texture is authored in world orientation,
 * and wrong for a decoded image, because a PNG's first row is its TOP row and
 * a `DataTexture` uploads it with `flipY = false` — so V=0 samples the top.
 *
 * Using the world-oriented quad for an image renders every logo upside down.
 *
 * The text engine paid for this exact confusion once already: it flipped V as
 * though the glyph atlas were image-backed, sampled an empty region, and drew
 * nothing at all. Two conventions genuinely exist here; the fix is to name
 * both rather than to pick one and hope callers remember which.
 */
export function imageQuadDescriptor(
  width: number,
  height: number,
): GeometryDescriptor {
  const quad = quadDescriptor(width, height);
  return {
    ...quad,
    // Vertices are bottom-left, bottom-right, top-right, top-left — so the
    // bottom pair takes V=1, the LAST row of the image.
    uvs: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
  };
}

/**
 * sRGB channel to linear. IEC 61966-2-1.
 *
 * MirrorBackend C9 requires LINEAR values. Hex colours are sRGB — that is what
 * a colour picker produces and what an operator pastes in. Handing sRGB values
 * to a linear pipeline makes everything render washed out, and the failure is
 * quiet: the graphic appears, so it looks like it works.
 *
 * Caught by the browser suite, not by any unit test: #0B1F3A came back from the
 * framebuffer as #3B6283. Nothing headless could have seen it, because the
 * error only exists once a real renderer converts linear back to sRGB for
 * display and the value gets encoded twice.
 */
function srgbToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/**
 * Parses `#RGB`, `#RRGGBB`, or `#RRGGBBAA` into linear RGBA 0–1.
 *
 * SCENE_FORMAT §7 stores colours as hex strings because that is what authoring
 * tools and operators exchange. An unparseable value yields opaque magenta
 * rather than throwing: a wrong colour on air is recoverable and obvious, a
 * crash mid-show is neither.
 *
 * Alpha is NOT gamma-encoded and so is passed through unconverted. It is also
 * not premultiplied here: the Three adapter takes colour and opacity as
 * separate material inputs and premultiplies in the shader, so doing it here
 * as well would darken every translucent surface twice. Every colour in play
 * today is opaque, which is why this has no visible consequence yet — it needs
 * settling when the first translucent material ships.
 */
export function rgbaFromHex(hex: string): Rgba {
  const value = hex.trim().replace(/^#/, "");

  const expand = (part: string): number =>
    srgbToLinear(parseInt(part, 16) / 255);

  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return [
      expand(value[0]! + value[0]!),
      expand(value[1]! + value[1]!),
      expand(value[2]! + value[2]!),
      1,
    ];
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return [
      expand(value.slice(0, 2)),
      expand(value.slice(2, 4)),
      expand(value.slice(4, 6)),
      1,
    ];
  }
  if (/^[0-9a-fA-F]{8}$/.test(value)) {
    return [
      expand(value.slice(0, 2)),
      expand(value.slice(2, 4)),
      expand(value.slice(4, 6)),
      parseInt(value.slice(6, 8), 16) / 255,
    ];
  }

  return [1, 0, 1, 1];
}
