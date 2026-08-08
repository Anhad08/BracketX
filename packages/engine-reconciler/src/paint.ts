/**
 * Paint — gradients, rounded corners, strokes, shadows and glows, rasterised.
 *
 * ============================================================================
 * WHY A RASTERISER AND NOT A SHADER
 * ============================================================================
 * `mesh-primitives.ts` already states the position this module answers:
 *
 *   > Implementing `cornerRadius` properly is a shader concern — a rounded rect
 *   > is a signed-distance fill, not a triangle fan — and that is a real piece
 *   > of renderer work with a material-kind consequence.
 *
 * That is true of a shader implementation, and it is the reason Blur, Glow and
 * the rounded rect have been refused three times. It is not true of this one.
 * A rounded rect with a gradient, a stroke and a soft shadow is a **texture**,
 * and a texture needs:
 *
 *   - no new `MaterialDescriptor` kind — `unlit` already carries a `map`
 *   - no new `MirrorBackend` method — `createTexture` already takes raw pixels
 *   - no ADR-013 amendment, because the frozen boundary is not touched
 *   - no SCENE_FORMAT version bump — `paint` is an optional prop that
 *     `readPaint` reads defensively (§13 rule 4)
 *   - no second implementation, because both backends upload textures the same
 *     way and therefore produce the same pixels
 *
 * The shader version would be faster and is still the right end state for a
 * paint that changes every frame. This one is correct in both backends today,
 * which is what a graphics library can actually be built on.
 *
 * ============================================================================
 * WHAT THIS COSTS, HONESTLY
 * ============================================================================
 * A paint is rasterised on the CPU and uploaded. So:
 *
 *   - A paint that changes ONCE (a brand colour, an operator picking a stop)
 *     costs one raster. Free, in the frame budget sense.
 *   - A paint that changes EVERY FRAME re-rasterises every frame, and at
 *     `MAX_EDGE` that is milliseconds. `paintKey` makes identical paints share
 *     one texture, so this only bites a genuinely animating gradient.
 *
 * Which is why the library animates a *sweep* as a gradient quad that MOVES,
 * not as a gradient whose stops slide — the same way the shine on a real
 * broadcast bug is done. The document can express both; only one is cheap, and
 * the expensive one is not forbidden, only slower.
 *
 * ============================================================================
 * COLOUR SPACE
 * ============================================================================
 * MirrorBackend C9: textures arrive **premultiplied linear** RGBA8.
 *
 * Stops are interpolated in **sRGB**, then converted — deliberately, and it is
 * the one place here that disagrees with physical correctness. A designer picks
 * `#2F6FEB → #0B0B0D` in a tool that blends in sRGB, and a gradient that
 * blends in linear instead has a visibly lighter middle than the one they
 * approved. Matching the tool is worth more than matching the physics, because
 * the founder's eye is the acceptance test.
 *
 * Coverage (`alpha`) is never colour-converted. It is geometry.
 */
import type { TextureDescriptor } from "./mirror-backend";

// ---------------------------------------------------------------------------
// The specification — what a document may ask for
// ---------------------------------------------------------------------------

/** A stop on a gradient ramp. `at` is 0..1 along the gradient's axis. */
export interface PaintStop {
  readonly at: number;
  /** `#RGB`, `#RRGGBB` or `#RRGGBBAA`. */
  readonly color: string;
  /** Multiplies the stop's own alpha. Lets one colour fade to nothing. */
  readonly opacity?: number;
}

/**
 * A gradient.
 *
 * `angle` is degrees, clockwise from "left to right", so 0 is a horizontal
 * ramp and 90 runs bottom to top. Degrees rather than radians because this
 * number is typed into a panel by a person, and clockwise-from-east because
 * that is what every design tool shows.
 */
export interface PaintGradient {
  readonly kind: "linear" | "radial" | "conic";
  readonly stops: readonly PaintStop[];
  readonly angle?: number;
  /**
   * Centre for `radial` and `conic`, in normalised box coordinates where
   * `[0,0]` is the bottom-left corner and `[1,1]` the top-right. Defaults to
   * the middle.
   */
  readonly center?: readonly [number, number];
  /**
   * Radius for `radial`, as a fraction of the box's half-diagonal. Defaults to
   * 1, which reaches the corners.
   */
  readonly radius?: number;
}

/** An outline drawn inside the shape's edge. */
export interface PaintStroke {
  readonly color: string;
  /** Thickness in world units. */
  readonly width: number;
  readonly opacity?: number;
  /**
   * A gradient along the stroke instead of a flat colour.
   *
   * Broadcast furniture is full of these — the bright top edge of a lower
   * third is a one-pixel gradient stroke, and faking it with a second rect
   * means a second node that every animation and every layout has to carry.
   */
  readonly gradient?: PaintGradient;
}

/**
 * A soft shadow, or a glow.
 *
 * They are the same operation. A shadow is offset and dark; a glow is centred
 * and the shape's own colour. Two names for one blur would be two code paths
 * that drift, and the panel can still label them separately.
 */
export interface PaintShadow {
  readonly color: string;
  /** Blur radius in world units. */
  readonly blur: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  readonly opacity?: number;
  /** Grows the shape before blurring. Negative shrinks it. */
  readonly spread?: number;
  /**
   * Draw the shadow INSIDE the shape rather than outside.
   *
   * An inner shadow is what makes a panel read as recessed, and it is the only
   * way to get a credible glass edge without a second overlapping node.
   */
  readonly inner?: boolean;
}

export interface PaintSpec {
  /** Fill gradient. Absent means the rect's flat `fill` is used unchanged. */
  readonly gradient?: PaintGradient;
  /** Corner radius in world units. Clamped to half the shorter side. */
  readonly cornerRadius?: number;
  /**
   * Per-corner radii, bottom-left first, counter-clockwise — the order
   * SCENE_FORMAT §5's Y-up convention makes natural.
   *
   * A single-corner-rounded tab is a real broadcast shape and one number
   * cannot express it.
   */
  readonly corners?: readonly [number, number, number, number];
  readonly stroke?: PaintStroke;
  readonly shadow?: PaintShadow;
  /** Texels per world unit. Clamped. Absent uses `DEFAULT_DENSITY`. */
  readonly density?: number;
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Texels per world unit.
 *
 * A world unit is a stage unit, and Studio's stage is 108 px per unit at
 * 1080p. 256 therefore rasterises at roughly 2.4x the pixels the output has,
 * which survives a 4K feed and a camera pushing in on a 3D card without the
 * corners going soft. Mipmaps handle the other direction.
 */
const DEFAULT_DENSITY = 256;
const MIN_DENSITY = 8;
const MAX_DENSITY = 1024;

/**
 * Hard ceiling on either texture dimension.
 *
 * 2048 is the smallest maximum texture size any target we care about
 * guarantees, and a full-frame paint at 2048 is 16MB premultiplied — already
 * more than a broadcast graphic should spend. Exceeding it reduces density
 * rather than refusing, because a slightly softer full-frame background is a
 * better failure than no background.
 */
const MAX_EDGE = 2048;

/** Below this, a paint is not worth a texture and the flat fill is honest. */
const MIN_EDGE = 2;

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/** sRGB byte -> linear byte. Same table and same reason as engine-image. */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i += 1) {
  const s = i / 255;
  SRGB_TO_LINEAR[i] = s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/**
 * Table lookup that tolerates a FRACTIONAL channel.
 *
 * Blending a stroke over a fill produces non-integer sRGB channels, and
 * `SRGB_TO_LINEAR[2.7]` is `undefined` — which propagates as NaN and lands in a
 * Uint8Array as zero. The symptom is not a black pixel but RAINBOW SPECKLE
 * along every stroke, because each channel independently either hits an integer
 * index or does not. It cost one render to find and is invisible in any test
 * that does not look at a stroked edge, so the lookup is centralised here where
 * a fractional index cannot be introduced by accident again.
 */
function linearOf(channel: number): number {
  const index = Math.round(channel);
  return SRGB_TO_LINEAR[index < 0 ? 0 : index > 255 ? 255 : index]!;
}

/**
 * Deterministic triangular dither, ±0.5 of a least-significant bit.
 *
 * An 8-bit LINEAR texture has very few codes in the darks — which is exactly
 * where broadcast furniture lives, because a lower third is a near-black panel.
 * Quantising a dark gradient without dither produces visible bands, and
 * because each channel bands at a different place the bands are COLOURED: the
 * first render of a #151A24 to #0D1017 ramp had green and red diagonal stripes
 * across it.
 *
 * Deterministic, from the pixel coordinate, not from a random source: this
 * engine's determinism tests require the same document to produce the same
 * bytes, and `Math.random` here would make every raster a new texture key.
 */
function dither(x: number, y: number, channel: number): number {
  // Two decorrelated hashes subtracted give a triangular distribution, which
  // is what removes banding without the grain a uniform dither leaves.
  const hash = (a: number, b: number, c: number): number => {
    let h = (a * 0x27d4eb2d) ^ (b * 0x165667b1) ^ (c * 0x9e3779b9);
    h = (h ^ (h >>> 15)) * 0x2545f491;
    h = (h ^ (h >>> 13)) >>> 0;
    return h / 0xffffffff;
  };
  return (hash(x, y, channel) - hash(y, x, channel + 17)) * 0.5;
}

/** Straight sRGB 0..255 plus straight alpha 0..1. The space stops interpolate in. */
interface Srgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const WHITE: Srgb = { r: 255, g: 255, b: 255, a: 1 };

export function parseSrgb(hex: string): Srgb {
  const value = hex.trim().replace(/^#/, "");
  const byte = (part: string): number => parseInt(part, 16);

  if (/^[0-9a-fA-F]{3}$/.test(value)) {
    return {
      r: byte(value[0]! + value[0]!),
      g: byte(value[1]! + value[1]!),
      b: byte(value[2]! + value[2]!),
      a: 1,
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(value)) {
    return {
      r: byte(value.slice(0, 2)),
      g: byte(value.slice(2, 4)),
      b: byte(value.slice(4, 6)),
      a: 1,
    };
  }
  if (/^[0-9a-fA-F]{8}$/.test(value)) {
    return {
      r: byte(value.slice(0, 2)),
      g: byte(value.slice(2, 4)),
      b: byte(value.slice(4, 6)),
      a: byte(value.slice(6, 8)) / 255,
    };
  }
  // An unparseable colour is white rather than a throw: a malformed document
  // must render something, never stop a show. Same policy as `rgbaFromHex`.
  return WHITE;
}

/** A resolved gradient ramp: 256 straight-sRGB samples, ready to index. */
type Ramp = Readonly<{
  r: Uint8Array;
  g: Uint8Array;
  b: Uint8Array;
  a: Float32Array;
}>;

const RAMP_SIZE = 256;

/**
 * Bakes stops into a lookup table.
 *
 * A table rather than a per-pixel stop search: a full-frame paint evaluates
 * four million pixels, and a binary search per pixel is measurable where 256
 * lerps once are not. 256 entries is also exactly the precision an 8-bit
 * texture can hold, so the table costs no quality.
 */
export function buildRamp(stops: readonly PaintStop[]): Ramp {
  const r = new Uint8Array(RAMP_SIZE);
  const g = new Uint8Array(RAMP_SIZE);
  const b = new Uint8Array(RAMP_SIZE);
  const a = new Float32Array(RAMP_SIZE);

  // Sorted, and clamped into range, so a document with stops out of order or
  // outside 0..1 still produces a monotonic ramp instead of a scramble.
  const sorted = stops
    .map((stop) => ({
      at: clamp(Number.isFinite(stop.at) ? stop.at : 0, 0, 1),
      colour: parseSrgb(stop.color),
      opacity: clamp(typeof stop.opacity === "number" ? stop.opacity : 1, 0, 1),
    }))
    .sort((left, right) => left.at - right.at);

  if (sorted.length === 0) {
    r.fill(255);
    g.fill(255);
    b.fill(255);
    a.fill(1);
    return { r, g, b, a };
  }

  let index = 0;
  for (let i = 0; i < RAMP_SIZE; i += 1) {
    const t = i / (RAMP_SIZE - 1);
    while (index < sorted.length - 1 && sorted[index + 1]!.at < t) index += 1;

    const lower = sorted[index]!;
    const upper = sorted[Math.min(index + 1, sorted.length - 1)]!;
    const span = upper.at - lower.at;
    const local = span <= 0 ? 0 : clamp((t - lower.at) / span, 0, 1);

    r[i] = Math.round(lower.colour.r + (upper.colour.r - lower.colour.r) * local);
    g[i] = Math.round(lower.colour.g + (upper.colour.g - lower.colour.g) * local);
    b[i] = Math.round(lower.colour.b + (upper.colour.b - lower.colour.b) * local);
    a[i] =
      lower.colour.a * lower.opacity +
      (upper.colour.a * upper.opacity - lower.colour.a * lower.opacity) * local;
  }

  return { r, g, b, a };
}

// ---------------------------------------------------------------------------
// Geometry — the signed distance field the whole module is built on
// ---------------------------------------------------------------------------

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * Signed distance from a point to a rounded rectangle, negative inside.
 *
 * `hx`/`hy` are half-extents; the box is centred on the origin, matching
 * SCENE_FORMAT §5's centred node origins so a paint and its node agree on
 * where the middle is without an offset nobody remembers to apply.
 *
 * The per-corner radius is picked by quadrant, which is what makes an
 * asymmetric tab possible with the same arithmetic as a symmetric panel.
 */
export function roundedBoxDistance(
  x: number,
  y: number,
  hx: number,
  hy: number,
  corners: readonly [number, number, number, number],
): number {
  // Corner order is bottom-left, bottom-right, top-right, top-left.
  const radius =
    y < 0
      ? x < 0
        ? corners[0]
        : corners[1]
      : x < 0
        ? corners[3]
        : corners[2];

  const limit = Math.max(0, Math.min(hx, hy));
  const r = clamp(radius, 0, limit);

  // Standard rounded-box SDF: shrink the box by r, measure to that, subtract r.
  const dx = Math.abs(x) - (hx - r);
  const dy = Math.abs(y) - (hy - r);
  const outsideX = Math.max(dx, 0);
  const outsideY = Math.max(dy, 0);
  const outside = Math.sqrt(outsideX * outsideX + outsideY * outsideY);
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside - r;
}

/**
 * Coverage from a distance, antialiased over one texel.
 *
 * A hard `distance < 0` test is what makes a rounded corner look like a
 * staircase, and supersampling it would cost 4x for a worse result than the
 * analytic version: the distance field already tells us how far the edge is,
 * so one smoothstep over a texel's width IS the correct coverage.
 */
function coverage(distance: number, texel: number): number {
  const half = texel * 0.5;
  if (distance <= -half) return 1;
  if (distance >= half) return 0;
  const t = 0.5 - distance / texel;
  // Smoothstep rather than linear: a linear ramp leaves a faint but visible
  // corduroy along a near-axis-aligned edge.
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Gradient sampling
// ---------------------------------------------------------------------------

/** Where along a gradient a point falls, 0..1. */
function gradientPosition(
  gradient: PaintGradient,
  x: number,
  y: number,
  hx: number,
  hy: number,
): number {
  const cx = (gradient.center?.[0] ?? 0.5) * 2 - 1;
  const cy = (gradient.center?.[1] ?? 0.5) * 2 - 1;

  if (gradient.kind === "linear") {
    const radians = ((gradient.angle ?? 0) * Math.PI) / 180;
    const ax = Math.cos(radians);
    const ay = Math.sin(radians);
    // Normalised box coordinates, so the ramp spans the box edge to edge at
    // every angle. Projecting in world units instead makes a 6:1 bar's
    // 45-degree gradient finish long before the far corner.
    const nx = hx === 0 ? 0 : x / hx;
    const ny = hy === 0 ? 0 : y / hy;
    // Half-extent of the box's projection onto the axis, so the ramp reaches
    // exactly the furthest corner and no further.
    const reach = Math.abs(ax) + Math.abs(ay);
    return clamp((nx * ax + ny * ay + reach) / (2 * reach), 0, 1);
  }

  if (gradient.kind === "conic") {
    const nx = (hx === 0 ? 0 : x / hx) - cx;
    const ny = (hy === 0 ? 0 : y / hy) - cy;
    const start = ((gradient.angle ?? 0) * Math.PI) / 180;
    let theta = Math.atan2(ny, nx) - start;
    // Into 0..2pi. A conic sweep is how a countdown ring and a progress dial
    // are drawn, and both need the seam where the author put it.
    theta = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return theta / (Math.PI * 2);
  }

  const nx = (hx === 0 ? 0 : x / hx) - cx;
  const ny = (hy === 0 ? 0 : y / hy) - cy;
  const extent = (gradient.radius ?? 1) * Math.SQRT2;
  return clamp(Math.sqrt(nx * nx + ny * ny) / (extent === 0 ? 1 : extent), 0, 1);
}

// ---------------------------------------------------------------------------
// Blur — for shadows and glows
// ---------------------------------------------------------------------------

/**
 * Three-pass box blur of a coverage mask, in place-ish.
 *
 * Three boxes approximate a Gaussian to within about 3% (Kovesi), which is
 * indistinguishable in an 8-bit shadow and costs O(pixels) instead of
 * O(pixels x radius). A true Gaussian here would be a visibly identical
 * shadow for several times the rasterisation cost.
 *
 * Separable: horizontal then vertical, per pass.
 */
function blurMask(
  mask: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const r = Math.floor(radius);
  if (r <= 0) return mask;

  let source = mask;
  // Typed from the argument so the two ping-pong buffers are the same type,
  // whichever ArrayBuffer flavour the caller's mask was allocated in.
  let target = new Float32Array(mask.length) as typeof mask;

  for (let pass = 0; pass < 3; pass += 1) {
    boxBlurAxis(source, target, width, height, r, true);
    const swap = source;
    source = target;
    target = swap;
    boxBlurAxis(source, target, width, height, r, false);
    const swap2 = source;
    source = target;
    target = swap2;
  }
  return source;
}

/**
 * One separable box pass, by running sum.
 *
 * Edges clamp rather than wrap or darken: a shadow whose mask darkens at the
 * texture border grows a visible rectangle around itself, which is the classic
 * broken drop shadow.
 */
function boxBlurAxis(
  source: Float32Array,
  target: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): void {
  const outer = horizontal ? height : width;
  const inner = horizontal ? width : height;
  const step = horizontal ? 1 : width;
  const window = radius * 2 + 1;

  for (let o = 0; o < outer; o += 1) {
    const base = horizontal ? o * width : o;
    let sum = 0;

    for (let i = -radius; i <= radius; i += 1) {
      sum += source[base + clamp(i, 0, inner - 1) * step]!;
    }
    for (let i = 0; i < inner; i += 1) {
      target[base + i * step] = sum / window;
      const outgoing = source[base + clamp(i - radius, 0, inner - 1) * step]!;
      const incoming = source[base + clamp(i + radius + 1, 0, inner - 1) * step]!;
      sum += incoming - outgoing;
    }
  }
}

// ---------------------------------------------------------------------------
// The raster
// ---------------------------------------------------------------------------

/**
 * A rasterised paint, plus the box it must be drawn on.
 *
 * `bleed` is why this returns a size at all. A shadow lives OUTSIDE the
 * shape, so the texture is larger than the rect and the quad carrying it must
 * be too — otherwise the shadow is clipped by the very edge it is softening.
 * The rect's own `width`/`height` are untouched, so layout, anchoring and
 * every measurement in the document still describe the shape rather than its
 * shadow.
 */
export interface RasterisedPaint {
  readonly texture: TextureDescriptor;
  /** World-unit size of the quad the texture belongs on. */
  readonly quadWidth: number;
  readonly quadHeight: number;
  /** World-unit margin added on every side. Zero when there is no shadow. */
  readonly bleed: number;
  /** Content key. Identical paints share one texture. */
  readonly key: string;
}

/**
 * True when a spec asks for nothing a flat fill cannot do.
 *
 * Checked so that adding `paint: {}` to a document costs no texture, and so
 * that a rect whose paint is animated down to nothing returns to the cheap
 * path rather than uploading a solid colour every frame.
 */
export function isFlatPaint(spec: PaintSpec): boolean {
  const cornered =
    (spec.cornerRadius ?? 0) > 0 ||
    (spec.corners?.some((value) => value > 0) ?? false);
  return (
    spec.gradient === undefined &&
    spec.stroke === undefined &&
    spec.shadow === undefined &&
    !cornered
  );
}

/** Content key for a paint at a size. Cheap, and stable across runs. */
export function paintKey(
  spec: PaintSpec,
  width: number,
  height: number,
): string {
  // JSON of a normalised spec: the field set is small, bounded and flat, so
  // stringify IS the canonical form here. Hashing it would add a step whose
  // only benefit is a shorter string nobody reads.
  return `p:${width.toFixed(4)}x${height.toFixed(4)}:${JSON.stringify([
    spec.gradient ?? null,
    spec.cornerRadius ?? 0,
    spec.corners ?? null,
    spec.stroke ?? null,
    spec.shadow ?? null,
    spec.density ?? 0,
  ])}`;
}

/**
 * Rasterises a paint over a `width` x `height` box.
 *
 * `baseColor` is the rect's flat `fill`, used when there is no gradient — so a
 * rect that only wants rounded corners keeps the colour it already declared,
 * and rounding a corner is not also a colour edit.
 */
export function rasterisePaint(
  spec: PaintSpec,
  width: number,
  height: number,
  baseColor: string,
): RasterisedPaint | undefined {
  if (!(width > 0) || !(height > 0)) return undefined;

  const shadow = spec.shadow;
  const outerShadow = shadow !== undefined && shadow.inner !== true;

  // The shadow's furthest reach: blurred, spread, and offset. One texel of
  // slack so the softest tail is not clipped exactly at zero.
  const bleedWorld = outerShadow
    ? Math.max(
        0,
        shadow.blur +
          Math.max(0, shadow.spread ?? 0) +
          Math.max(Math.abs(shadow.offsetX ?? 0), Math.abs(shadow.offsetY ?? 0)),
      )
    : 0;

  const quadWidth = width + bleedWorld * 2;
  const quadHeight = height + bleedWorld * 2;

  // Density is reduced rather than the paint refused, so an oversized
  // full-frame background is soft instead of absent.
  const requested = clamp(spec.density ?? DEFAULT_DENSITY, MIN_DENSITY, MAX_DENSITY);
  const fit = Math.min(1, MAX_EDGE / Math.max(quadWidth, quadHeight) / requested);
  const density = requested * (fit < 1 ? fit : 1);

  const texWidth = Math.max(MIN_EDGE, Math.min(MAX_EDGE, Math.round(quadWidth * density)));
  const texHeight = Math.max(MIN_EDGE, Math.min(MAX_EDGE, Math.round(quadHeight * density)));

  const hx = width / 2;
  const hy = height / 2;
  const texelWorld = quadWidth / texWidth;

  const corners = resolveCorners(spec, hx, hy);
  const fillRamp =
    spec.gradient === undefined
      ? undefined
      : buildRamp(spec.gradient.stops);
  const flat = parseSrgb(baseColor);

  const strokeWidth = Math.max(0, spec.stroke?.width ?? 0);
  const strokeRamp =
    spec.stroke?.gradient === undefined
      ? undefined
      : buildRamp(spec.stroke.gradient.stops);
  const strokeFlat = spec.stroke === undefined ? WHITE : parseSrgb(spec.stroke.color);
  const strokeOpacity = clamp(spec.stroke?.opacity ?? 1, 0, 1);

  const pixels = new Uint8Array(texWidth * texHeight * 4);

  // ------------------------------------------------------------------
  // Shadow first — it is behind everything, including a transparent fill
  // ------------------------------------------------------------------
  if (shadow !== undefined) {
    paintShadowInto(
      pixels,
      texWidth,
      texHeight,
      texelWorld,
      quadWidth,
      quadHeight,
      hx,
      hy,
      corners,
      shadow,
      density,
    );
  }

  // ------------------------------------------------------------------
  // Then the shape: fill, then stroke over its inner edge
  // ------------------------------------------------------------------
  for (let py = 0; py < texHeight; py += 1) {
    // +0.5 samples texel centres. Sampling corners shifts the whole shape half
    // a texel, which is invisible alone and shows up as an asymmetric stroke.
    const y = (py + 0.5) * texelWorld - quadHeight / 2;

    for (let px = 0; px < texWidth; px += 1) {
      const x = (px + 0.5) * texelWorld - quadWidth / 2;
      const distance = roundedBoxDistance(x, y, hx, hy, corners);

      const shapeAlpha = coverage(distance, texelWorld);
      if (shapeAlpha <= 0) continue;

      // Fill
      let r: number;
      let g: number;
      let b: number;
      let a: number;
      if (fillRamp === undefined) {
        r = flat.r;
        g = flat.g;
        b = flat.b;
        a = flat.a;
      } else {
        const t = gradientPosition(spec.gradient!, x, y, hx, hy);
        const index = Math.round(t * (RAMP_SIZE - 1));
        r = fillRamp.r[index]!;
        g = fillRamp.g[index]!;
        b = fillRamp.b[index]!;
        a = fillRamp.a[index]!;
      }

      // Stroke, over the fill, on the inside of the edge. Inside rather than
      // centred so a stroke never grows the shape — a 2px stroke that makes a
      // panel 2px wider breaks every alignment the designer just set.
      if (strokeWidth > 0) {
        const strokeAlpha =
          coverage(distance, texelWorld) *
          (1 - coverage(distance + strokeWidth, texelWorld));
        if (strokeAlpha > 0) {
          let sr = strokeFlat.r;
          let sg = strokeFlat.g;
          let sb = strokeFlat.b;
          let sa = strokeFlat.a;
          if (strokeRamp !== undefined) {
            const t = gradientPosition(spec.stroke!.gradient!, x, y, hx, hy);
            const index = Math.round(t * (RAMP_SIZE - 1));
            sr = strokeRamp.r[index]!;
            sg = strokeRamp.g[index]!;
            sb = strokeRamp.b[index]!;
            sa = strokeRamp.a[index]!;
          }
          const weight = strokeAlpha * sa * strokeOpacity;
          // Straight-alpha "over" in sRGB, because that is the space the two
          // colours were authored in and the space the fill ramp is still in.
          const combined = weight + a * (1 - weight);
          if (combined > 0) {
            r = (sr * weight + r * a * (1 - weight)) / combined;
            g = (sg * weight + g * a * (1 - weight)) / combined;
            b = (sb * weight + b * a * (1 - weight)) / combined;
          }
          a = combined;
        }
      }

      const alpha = clamp(a * shapeAlpha, 0, 1);
      if (alpha <= 0) continue;

      const offset = (py * texWidth + px) * 4;
      // The shape composites OVER whatever the shadow left here.
      const under = pixels[offset + 3]! / 255;
      const outAlpha = clamp(alpha + under * (1 - alpha), 0, 1);
      const outByte = Math.round(outAlpha * 255);

      // Everything is written premultiplied linear (C9), so "over" is a plain
      // lerp of premultiplied values — no divide, no halo.
      //
      // Dithered on the way down to 8 bits, then clamped to the alpha it was
      // written with, so premultiplication survives the noise: a channel one
      // code above its own alpha is the dark-halo bug in miniature.
      const channels = [r, g, b];
      for (let c = 0; c < 3; c += 1) {
        const value =
          linearOf(channels[c]!) * alpha + (pixels[offset + c]! / 255) * (1 - alpha);
        const byte = Math.round(clamp(value, 0, 1) * 255 + dither(px, py, c));
        pixels[offset + c] = byte < 0 ? 0 : byte > outByte ? outByte : byte;
      }
      pixels[offset + 3] = outByte;
    }
  }

  return {
    texture: {
      width: texWidth,
      height: texHeight,
      pixels,
      format: "rgba8",
      // Linear filtering and mipmaps: a paint is a photograph of a shape, and
      // both minification (a bug shrinking in a transition) and magnification
      // (a camera pushing in on a 3D card) happen constantly.
      filter: "linear",
      mipmaps: true,
    },
    quadWidth,
    quadHeight,
    bleed: bleedWorld,
    key: paintKey(spec, width, height),
  };
}

/** Per-corner radii, clamped, from whichever of the two fields was given. */
function resolveCorners(
  spec: PaintSpec,
  hx: number,
  hy: number,
): readonly [number, number, number, number] {
  const limit = Math.max(0, Math.min(hx, hy));
  const uniform = clamp(spec.cornerRadius ?? 0, 0, limit);
  if (spec.corners === undefined) return [uniform, uniform, uniform, uniform];
  const at = (index: number): number =>
    clamp(spec.corners![index] ?? uniform, 0, limit);
  return [at(0), at(1), at(2), at(3)];
}

/**
 * Rasterises the shadow into the buffer, premultiplied linear.
 *
 * An inner shadow is the same blur inverted and masked by the shape, which is
 * why it shares this function rather than having its own.
 */
function paintShadowInto(
  pixels: Uint8Array,
  texWidth: number,
  texHeight: number,
  texelWorld: number,
  quadWidth: number,
  quadHeight: number,
  hx: number,
  hy: number,
  corners: readonly [number, number, number, number],
  shadow: PaintShadow,
  density: number,
): void {
  const spread = shadow.spread ?? 0;
  const offsetX = shadow.offsetX ?? 0;
  const offsetY = shadow.offsetY ?? 0;
  const inner = shadow.inner === true;

  const mask = new Float32Array(texWidth * texHeight);
  for (let py = 0; py < texHeight; py += 1) {
    const y = (py + 0.5) * texelWorld - quadHeight / 2 - offsetY;
    for (let px = 0; px < texWidth; px += 1) {
      const x = (px + 0.5) * texelWorld - quadWidth / 2 - offsetX;
      // Spread grows the shape by moving the surface inward in distance terms.
      const distance = roundedBoxDistance(x, y, hx, hy, corners) - spread;
      const value = coverage(distance, texelWorld);
      mask[py * texWidth + px] = inner ? 1 - value : value;
    }
  }

  // `blur` is the world distance over which the shadow fades to nothing, which
  // is what a designer means by it and what `bleedWorld` reserved room for.
  // Three box passes of radius r reach 3r, so the radius is a third of it.
  const blurred = blurMask(mask, texWidth, texHeight, (shadow.blur * density) / 3);

  const colour = parseSrgb(shadow.color);
  const opacity = clamp(shadow.opacity ?? 1, 0, 1);
  const lr = linearOf(colour.r);
  const lg = linearOf(colour.g);
  const lb = linearOf(colour.b);

  for (let py = 0; py < texHeight; py += 1) {
    for (let px = 0; px < texWidth; px += 1) {
      const index = py * texWidth + px;
      let alpha = clamp(blurred[index]! * colour.a * opacity, 0, 1);
      if (alpha <= 0) continue;

      if (inner) {
        // Clipped to the shape, or an inner shadow bleeds outside the panel it
        // is supposed to be inside.
        const y = (py + 0.5) * texelWorld - quadHeight / 2;
        const x = (px + 0.5) * texelWorld - quadWidth / 2;
        alpha *= coverage(roundedBoxDistance(x, y, hx, hy, corners), texelWorld);
        if (alpha <= 0) continue;
      }

      // A large soft shadow is the widest, shallowest ramp a paint contains, so
      // it bands more readily than any gradient. Dithered for the same reason,
      // and clamped to its own alpha for the same invariant.
      const offset = index * 4;
      const alphaByte = Math.round(alpha * 255);
      const channels = [lr, lg, lb];
      for (let c = 0; c < 3; c += 1) {
        const byte = Math.round(
          clamp(channels[c]! * alpha, 0, 1) * 255 + dither(px, py, c),
        );
        pixels[offset + c] = byte < 0 ? 0 : byte > alphaByte ? alphaByte : byte;
      }
      pixels[offset + 3] = alphaByte;
    }
  }
}

// ---------------------------------------------------------------------------
// Reading a paint out of a document
// ---------------------------------------------------------------------------

/**
 * Reads a `paint` prop defensively.
 *
 * Every field is optional and every type is checked, because SCENE_FORMAT §13
 * rules 1-3 require an unrecognised or malformed shape to survive rather than
 * throw — and because a paint arrives from a variable binding as often as from
 * a literal, so "a number where an object should be" is a runtime possibility,
 * not a coding error.
 *
 * Returns undefined when there is nothing to draw, which puts the rect back on
 * the flat-fill path with no texture at all.
 */
export function readPaint(value: unknown): PaintSpec | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;

  const spec: PaintSpec = {
    ...(readGradient(raw.gradient) === undefined
      ? {}
      : { gradient: readGradient(raw.gradient)! }),
    ...(typeof raw.cornerRadius === "number" && raw.cornerRadius > 0
      ? { cornerRadius: raw.cornerRadius }
      : {}),
    ...(readCorners(raw.corners) === undefined
      ? {}
      : { corners: readCorners(raw.corners)! }),
    ...(readStroke(raw.stroke) === undefined ? {} : { stroke: readStroke(raw.stroke)! }),
    ...(readShadow(raw.shadow) === undefined ? {} : { shadow: readShadow(raw.shadow)! }),
    ...(typeof raw.density === "number" && raw.density > 0
      ? { density: raw.density }
      : {}),
  };

  return isFlatPaint(spec) ? undefined : spec;
}

function readGradient(value: unknown): PaintGradient | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;

  const kind =
    raw.kind === "radial" || raw.kind === "conic" ? raw.kind : "linear";
  const stops = Array.isArray(raw.stops)
    ? raw.stops.flatMap((entry): PaintStop[] => {
        if (entry === null || typeof entry !== "object") return [];
        const stop = entry as Record<string, unknown>;
        if (typeof stop.color !== "string") return [];
        return [
          {
            at: typeof stop.at === "number" ? stop.at : 0,
            color: stop.color,
            ...(typeof stop.opacity === "number" ? { opacity: stop.opacity } : {}),
          },
        ];
      })
    : [];

  // One stop is not a gradient, and zero is not a paint. Both fall back to the
  // flat fill rather than rendering a mystery.
  if (stops.length < 2) return undefined;

  const center =
    Array.isArray(raw.center) &&
    typeof raw.center[0] === "number" &&
    typeof raw.center[1] === "number"
      ? ([raw.center[0], raw.center[1]] as const)
      : undefined;

  return {
    kind,
    stops,
    ...(typeof raw.angle === "number" ? { angle: raw.angle } : {}),
    ...(center === undefined ? {} : { center }),
    ...(typeof raw.radius === "number" ? { radius: raw.radius } : {}),
  };
}

function readCorners(
  value: unknown,
): readonly [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined;
  if (!value.every((entry) => typeof entry === "number")) return undefined;
  const corners = value as number[];
  if (corners.every((entry) => entry <= 0)) return undefined;
  return [corners[0]!, corners[1]!, corners[2]!, corners[3]!];
}

function readStroke(value: unknown): PaintStroke | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.width !== "number" || raw.width <= 0) return undefined;
  return {
    color: typeof raw.color === "string" ? raw.color : "#FFFFFF",
    width: raw.width,
    ...(typeof raw.opacity === "number" ? { opacity: raw.opacity } : {}),
    ...(readGradient(raw.gradient) === undefined
      ? {}
      : { gradient: readGradient(raw.gradient)! }),
  };
}

function readShadow(value: unknown): PaintShadow | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const blur = typeof raw.blur === "number" ? raw.blur : 0;
  const spread = typeof raw.spread === "number" ? raw.spread : 0;
  // A shadow with no blur and no spread is a hard copy of the shape behind
  // itself. Legal, but only worth a texture if it is offset.
  const offsetX = typeof raw.offsetX === "number" ? raw.offsetX : 0;
  const offsetY = typeof raw.offsetY === "number" ? raw.offsetY : 0;
  if (blur <= 0 && spread === 0 && offsetX === 0 && offsetY === 0) return undefined;

  return {
    color: typeof raw.color === "string" ? raw.color : "#000000",
    blur: Math.max(0, blur),
    ...(offsetX === 0 ? {} : { offsetX }),
    ...(offsetY === 0 ? {} : { offsetY }),
    ...(typeof raw.opacity === "number" ? { opacity: raw.opacity } : {}),
    ...(spread === 0 ? {} : { spread }),
    ...(raw.inner === true ? { inner: true } : {}),
  };
}

/** Estimated upload cost, for the same budget the other resources report to. */
export function estimatePaintBytes(paint: RasterisedPaint): number {
  const base = paint.texture.width * paint.texture.height * 4;
  // A full mip chain is 4/3 of the base level.
  return paint.texture.mipmaps === true ? Math.round((base * 4) / 3) : base;
}
