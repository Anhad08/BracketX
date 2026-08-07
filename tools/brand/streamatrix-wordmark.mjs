#!/usr/bin/env node
/**
 * Streamatrix — the logotype.
 *
 * A monoline geometric face, constructed rather than set: every glyph is a list
 * of polylines on a unit grid, drawn with one stroke weight, flat caps and mitred
 * joins. That is what the reference face is — wide, engineered, evenly weighted,
 * with no modulation anywhere — and building it from strokes keeps the whole
 * logotype tied to two numbers (`weight`, `tracking`) instead of to outlines that
 * would have to be redrawn by hand every time either changed.
 *
 * Glyph space: x from 0 to the glyph's advance, y from 0 (baseline) to 1 (cap
 * height). The caller scales.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round = (v, d = 3) => String(Math.round(v * 10 ** d) / 10 ** d);

/**
 * Each glyph is `{ w, strokes }` — advance width in cap heights, and polylines.
 * Widths differ per letter on purpose: a geometric face is monospaced-looking
 * but not monospaced, and forcing M and I to the same width is what makes
 * constructed logotypes read as amateur.
 */
const GLYPHS = {
  // Chamfers kept small and only at the two outer corners. Cut them deeper, or
  // cut all four, and the S starts reading as a 5.
  S: {
    w: 0.72,
    strokes: [
      [
        [0.72, 1],
        [0.09, 1],
        [0, 0.91],
        [0, 0.59],
        [0.09, 0.5],
        [0.63, 0.5],
        [0.72, 0.41],
        [0.72, 0.09],
        [0.63, 0],
        [0, 0],
      ],
    ],
  },
  T: {
    w: 0.78,
    strokes: [
      [
        [0, 1],
        [0.78, 1],
      ],
      [
        [0.39, 1],
        [0.39, 0],
      ],
    ],
  },
  R: {
    w: 0.72,
    strokes: [
      [
        [0, 0],
        [0, 1],
        [0.63, 1],
        [0.72, 0.91],
        [0.72, 0.59],
        [0.63, 0.5],
        [0, 0.5],
      ],
      [
        [0.4, 0.5],
        [0.72, 0],
      ],
    ],
  },
  E: {
    w: 0.68,
    strokes: [
      [
        [0.68, 1],
        [0, 1],
        [0, 0],
        [0.68, 0],
      ],
      [
        [0, 0.5],
        [0.54, 0.5],
      ],
    ],
  },
  A: {
    w: 0.8,
    strokes: [
      [
        [0, 0],
        [0.4, 1],
        [0.8, 0],
      ],
      [
        [0.16, 0.4],
        [0.64, 0.4],
      ],
    ],
  },
  M: {
    w: 0.94,
    strokes: [
      [
        [0, 0],
        [0, 1],
        [0.47, 0.42],
        [0.94, 1],
        [0.94, 0],
      ],
    ],
  },
  I: {
    w: 0.12,
    strokes: [
      [
        [0.06, 0],
        [0.06, 1],
      ],
    ],
  },
  X: {
    w: 0.78,
    strokes: [
      [
        [0, 1],
        [0.78, 0],
      ],
      [
        [0, 0],
        [0.78, 1],
      ],
    ],
  },
  N: {
    w: 0.78,
    strokes: [
      [
        [0, 0],
        [0, 1],
        [0.78, 0],
        [0.78, 1],
      ],
    ],
  },
  G: {
    w: 0.78,
    strokes: [
      [
        [0.78, 0.86],
        [0.78, 1],
        [0.12, 1],
        [0, 0.86],
        [0, 0.14],
        [0.12, 0],
        [0.66, 0],
        [0.78, 0.14],
        [0.78, 0.44],
        [0.44, 0.44],
      ],
    ],
  },
  L: {
    w: 0.62,
    strokes: [
      [
        [0, 1],
        [0, 0],
        [0.62, 0],
      ],
    ],
  },
  V: {
    w: 0.8,
    strokes: [
      [
        [0, 1],
        [0.4, 0],
        [0.8, 1],
      ],
    ],
  },
  ".": { w: 0.16, dot: true, strokes: [] },
  " ": { w: 0.34, strokes: [] },
};

/** Advance of a string, including tracking, in cap heights. */
export function advance(text, tracking) {
  return [...text].reduce(
    (x, ch, i) => x + (GLYPHS[ch]?.w ?? 0.5) + (i < text.length - 1 ? tracking : 0),
    0,
  );
}

/**
 * Lay a string out. Returns the stroke path data, plus the positions of any dot
 * glyphs so the caller can colour them independently — the reference picks the
 * periods out in brand colours, and the I of STREAMATRIX is replaced entirely by
 * a column of LEDs.
 */
export function layout(text, { tracking = 0.16, weight = 0.1, dotR = 0.055 } = {}) {
  let x = 0;
  let d = "";
  const dots = [];
  [...text].forEach((ch, i) => {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    if (g.dot) dots.push({ x: x + g.w / 2, y: dotR, r: dotR });
    for (const poly of g.strokes) {
      d += poly
        .map(([px, py], k) => `${k ? "L" : "M"}${round(x + px)} ${round(1 - py)}`)
        .join("");
    }
    x += g.w + (i < text.length - 1 ? tracking : 0);
  });
  return { d, dots, width: x, weight };
}

/**
 * The logotype as an SVG fragment, cap height 1, baseline at y = 1.
 * `ledColumn` replaces a named index with a stack of coloured LEDs.
 */
export function wordmarkSvg(
  text,
  {
    tracking = 0.16,
    weight = 0.1,
    colour = "#ffffff",
    ledIndex = -1,
    ledColours = [],
    dotColours = [],
    idPrefix = "wm",
  } = {},
) {
  // The LED column stands in for a letter, so the slot has to be reserved in the
  // layout even though nothing is stroked there.
  const chars = [...text];
  const laid = chars.map((c, i) => (i === ledIndex ? "I" : c)).join("");
  const { d, dots, width } = layout(laid, { tracking, weight });

  let leds = "";
  if (ledIndex >= 0 && ledColours.length) {
    const x = advance(laid.slice(0, ledIndex), tracking) + (GLYPHS.I.w / 2 + tracking * 0);
    const r = weight * 0.62;
    const step = 1 / (ledColours.length - 1 + 0.001);
    leds = ledColours
      .map(
        (c, k) =>
          `<circle cx="${round(x)}" cy="${round(1 - k * step * (1 - r * 2) - r)}" r="${round(r)}" fill="${c}"/>`,
      )
      .join("");
  }

  const periods = dots
    .map(
      (p, i) =>
        `<circle cx="${round(p.x)}" cy="${round(1 - p.y)}" r="${round(p.r)}" fill="${dotColours[i] ?? colour}"/>`,
    )
    .join("");

  return {
    width,
    svg:
      `<g id="${idPrefix}">` +
      // A low miter limit is deliberate: at the apex of A, M, V and X a full
      // miter shoots a long spike well past the cap line. Bevelling those flat
      // is both what stops the spike and what gives the face its cut-corner,
      // engineered look.
      `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${round(weight)}" ` +
      `stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="1.6"/>` +
      leds +
      periods +
      `</g>`,
  };
}

export { GLYPHS, clamp };
