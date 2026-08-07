#!/usr/bin/env node
/**
 * Streamatrix — the mark, generated.
 *
 * The S is not drawn by hand. It is a five-stroke angular spine — bar, descender,
 * diagonal, descender, bar — laid out point-symmetrically about the origin, so
 * the top half and the bottom half are the same shape rotated 180°. That is what
 * makes it a complete S rather than an E: the top bar joins the middle on the
 * LEFT, the middle joins the bottom on the RIGHT. An E joins everything on the
 * left; the alternation is the whole letter.
 *
 * The stroke is modulated along that spine — heaviest through the diagonal,
 * lighter through the bars — which leaves the diagonal thick enough to carry the
 * play button while the counters stay open.
 *
 * Everything downstream is a function of two numbers per lattice site: signed
 * distance to the silhouette, and where the site sits relative to the centre.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "brand", "streamatrix");

/* ── math ───────────────────────────────────────────────────────────────── */

const TAU = Math.PI * 2;
const R2D = 180 / Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);

/** Polynomial smooth minimum — a union that meets in a fillet of radius ~k. */
function smin(a, b, k) {
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}
const round = (v, d = 2) => {
  const f = 10 ** d;
  return String(Math.round(v * f) / f);
};

/** Deterministic lattice hash — the matrix must be reproducible, byte for byte. */
function h2(i, j, salt = 0) {
  const n = Math.sin(i * 127.1 + j * 311.7 + salt * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

/* ── geometry ───────────────────────────────────────────────────────────── */

export const G = {
  reach: 480, // how far the bar terminals run past the descenders
  side: 400, // x of the two descenders
  bar: 480, // y of the two bars
  // Inner-corner radii. Outer corners are already round — distance to a polyline
  // rounds them for free — but the inner ones arrive sharp, and sharp inner
  // corners are most of what makes a jointed letterform read as hard. They cost
  // counter height, since a fillet eats into the gap from both sides.
  //
  // The two are separate because the shoulders want less of it than the diagonal
  // does: a tighter radius where the bars turn into the descenders straightens
  // the top-left shoulder and takes the swell off the bottom-right corner. Those
  // are the same corner rotated 180°, so one number governs both — which is what
  // keeps the letter from listing to one side.
  filletBar: 16, // bar ↔ descender: the shoulders
  filletMid: 24, // descender ↔ diagonal
  mid: 150, // y at which the middle diagonal leaves the descender. This is the
  //           single most important number in the letter: it sets how steeply
  //           the diagonal falls, and a shallow diagonal reads as a third
  //           horizontal bar — which is precisely what turns an S into an E.
  //           It also has to leave the descender longer than the two round
  //           joins that eat it from both ends, or the flanks go bulbous.
  Wbar: 100, // half stroke width through the bars. Close to Wmid on purpose: too
  //            far apart and the letter reads as a heavy diagonal with two thin
  //            rails attached rather than as one stroke.
  Wmid: 130, // half stroke width through the diagonal — thick enough for the play
  //            button, which is the only reason the modulation exists
  bow: 0.001, // sagitta of the two bars. Roughly 2% of the bar's own length: enough
  //          that the S flows, far too little to read as a curve on its own.
  bowLift: 0.78, // how much of the bow sits above the old bar line rather than
  //                below it. The bar's low end is the ceiling of the counter, so
  //                bowing symmetrically about the old line pinches the counter
  //                shut by half the sagitta. Carrying the curve upward instead
  //                spends the bow on height — imperceptible — rather than on the
  //                one gap in the letter that has none to spare.
};

/**
 * A bar is a circular arc, not a straight line — a very shallow one, bulging
 * away from the letter's centre. Two things come of it. A long horizontal reads
 * as sagging when it is actually dead level, so the bow is first an optical
 * correction; and because the arc's ends are tilted, the bar arrives at the
 * descender already turning, which is what makes the S read as a ribbon rather
 * than as parts welded at right angles.
 *
 * `bowLift` splits the sagitta between crown and chord; see G. Width is
 * untouched either way — the bow costs height only.
 */
function barArc(xFrom, xTo, n = 26) {
  const chordY = G.bar - G.bow * (1 - G.bowLift);
  const crownY = chordY + G.bow;
  const L = Math.abs(xTo - xFrom);
  const xm = (xFrom + xTo) / 2;
  const R = (L * L) / (8 * G.bow) + G.bow / 2; // radius through chord and crown
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = lerp(xFrom, xTo, i / n);
    return { x, y: crownY - R + Math.sqrt(Math.max(0, R * R - (x - xm) ** 2)) };
  });
}

const CHORD_Y = G.bar - G.bow * (1 - G.bowLift);

/**
 * The spine, as five strokes. Point-symmetric: the bottom half is the top half
 * negated and reversed, which is what guarantees the two halves are identical
 * and the S never lists to one side.
 */
const STROKES = (() => {
  const topBar = barArc(G.reach, -G.side);
  const bottomBar = topBar.map((p) => ({ x: -p.x, y: -p.y })).reverse();
  return [
    topBar, //                                             bar
    [{ x: -G.side, y: CHORD_Y }, { x: -G.side, y: G.mid }], // descender
    [{ x: -G.side, y: G.mid }, { x: G.side, y: -G.mid }], //   diagonal
    [{ x: G.side, y: -G.mid }, { x: G.side, y: -CHORD_Y }], // descender
    bottomBar, //                                            bar
  ];
})();

/** Every stroke flattened to sub-segments, each tagged with the stroke it serves. */
const SEGS = (() => {
  const segs = [];
  let acc = 0;
  STROKES.forEach((pts, stroke) => {
    const strokeLen = pts
      .slice(1)
      .reduce((s, p, i) => s + Math.hypot(p.x - pts[i].x, p.y - pts[i].y), 0);
    let along = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      segs.push({
        a,
        b,
        len,
        dir: { x: (b.x - a.x) / len, y: (b.y - a.y) / len },
        s0: acc,
        stroke,
        t0: along / strokeLen, // position within the stroke, for the width ramp
        tLen: len / strokeLen,
      });
      acc += len;
      along += len;
    }
  });
  return segs.map((s) => ({ ...s, u0: s.s0 / acc, u1: (s.s0 + s.len) / acc, total: acc }));
})();
const TOTAL_LEN = SEGS[0].total;
const STROKE_COUNT = STROKES.length;

/** Left normal of a direction (design space, y up). */
const leftN = (d) => ({ x: -d.y, y: d.x });

/** Fillet radius at join i, between stroke i−1 and stroke i. Point-symmetric. */
const JOIN_FILLET = [0, G.filletBar, G.filletMid, G.filletMid, G.filletBar];
const MAX_FILLET = Math.max(...JOIN_FILLET);

/**
 * Half width at u. Constant through each bar and through the diagonal; the two
 * descenders are where it transitions, so no bar ever reads as a wedge.
 */
function widthOf(stroke, t) {
  switch (stroke) {
    case 1:
      return lerp(G.Wbar, G.Wmid, smooth(t));
    case 2:
      return G.Wmid;
    case 3:
      return lerp(G.Wmid, G.Wbar, smooth(t));
    default:
      return G.Wbar;
  }
}

function widthAt(u) {
  const s = clamp(u, 0, 1) * TOTAL_LEN;
  const g = SEGS.find((q) => s <= q.s0 + q.len) ?? SEGS[SEGS.length - 1];
  const t = clamp((s - g.s0) / g.len, 0, 1);
  return widthOf(g.stroke, g.t0 + g.tLen * t);
}

function spineAt(u) {
  const s = clamp(u, 0, 1) * TOTAL_LEN;
  const g = SEGS.find((q) => s <= q.s0 + q.len) ?? SEGS[SEGS.length - 1];
  const t = clamp((s - g.s0) / g.len, 0, 1);
  return { x: lerp(g.a.x, g.b.x, t), y: lerp(g.a.y, g.b.y, t) };
}

/**
 * Signed distance to the S. Every sub-segment is a capsule — distance to the
 * segment, less the width there — and the terminals come out round because a
 * clamped segment distance ends in a cap and no cut is imposed on it.
 *
 * The two-stage combine matters. WITHIN a stroke the sub-segments join with a
 * plain minimum: they are near-collinear links of one curve, and smoothing
 * between them would swell the bar by k/4 along its whole length. Only BETWEEN
 * strokes does the smooth union apply, at that corner's own fillet radius.
 *
 * Exact and closed-form, so the matrix samples real geometry and the contoured
 * silhouette below agrees with it by construction.
 */
function sdfS(x, y) {
  const perStroke = new Array(STROKE_COUNT).fill(Infinity);
  for (const g of SEGS) {
    const wx = x - g.a.x;
    const wy = y - g.a.y;
    const t = clamp((wx * g.dir.x + wy * g.dir.y) / g.len, 0, 1);
    const dx = wx - g.dir.x * g.len * t;
    const dy = wy - g.dir.y * g.len * t;
    const w = widthOf(g.stroke, g.t0 + g.tLen * t);
    const d = Math.hypot(dx, dy) - w;
    if (d < perStroke[g.stroke]) perStroke[g.stroke] = d;
  }
  // Folding strokes in order means the running distance near join i is the one
  // belonging to stroke i−1, so JOIN_FILLET[i] is the radius of that corner.
  let d = perStroke[0];
  for (let i = 1; i < STROKE_COUNT; i++) d = smin(d, perStroke[i], JOIN_FILLET[i]);
  return d;
}

/** The mark, play button included. Design space throughout. This is the shape. */
const shapeSdf = (x, y) => Math.max(sdfS(x, y), -sdPlay(x, y));

/* ── bounds ─────────────────────────────────────────────────────────────── */

/**
 * The S's own bounds — the frame everything else is sized against. Every stroke
 * is a round-capped capsule, so the union of discs along the spine is exact —
 * except that a polynomial smooth union pushes the surface out by at most k/4
 * where two strokes are equidistant. That slack is added here so nothing
 * downstream, least of all the contour grid, clips the fillets off.
 */
const S_BOX = (() => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const N = 600;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const p = spineAt(u);
    const w = widthAt(u) + MAX_FILLET / 4;
    x0 = Math.min(x0, p.x - w);
    y0 = Math.min(y0, p.y - w);
    x1 = Math.max(x1, p.x + w);
    y1 = Math.max(y1, p.y + w);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
})();
const S_HEIGHT = S_BOX.h;

/* ── the play button, carved from the diagonal ──────────────────────────── */

export const PLAY = {
  height: 0.26, // of the S's overall height — bounded by the diagonal it sits in
  ratio: 0.866, // equilateral — the only triangle that never looks arbitrary
  corner: 0.115, // corner radius, as a fraction of the triangle height. An
  //                equilateral triangle's inradius is only 0.289 of its height,
  //                so rounding costs far more area here than intuition suggests —
  //                past about a tenth the triangle rounds off into a blob.
  nudgeX: 0.02, // optical centring: a right-pointing triangle reads left-heavy
  nudgeY: 0,
  riseN: 0.28, // how far up the diagonal's normal the triangle sits, in Wmid.
  //              Push it too far and the lower edge leaves the stroke, the void
  //              opens into the counter below, and the S falls in half — watch
  //              the contour loop count, which must stay at 2.
};

/** Unit normal of the middle diagonal — the direction the play button must clear. */
const MID_N = (() => {
  const n = leftN(SEGS[2].dir);
  return { x: n.x, y: n.y };
})();

function playTriangle() {
  const h = PLAY.height * S_HEIGHT;
  const w = h * PLAY.ratio;
  const raw = [
    { x: -w / 2, y: -h / 2 },
    { x: -w / 2, y: h / 2 },
    { x: w / 2, y: 0 },
  ];
  // Centroid to the origin, then the optical nudge — a right-pointing triangle
  // has its mass behind the apex, so geometric centring reads as sitting left.
  const gx = (raw[0].x + raw[1].x + raw[2].x) / 3;
  let tri = raw.map((p) => ({ x: p.x - gx + PLAY.nudgeX * w, y: p.y + PLAY.nudgeY * h }));

  // Centre it across the diagonal rather than on the spine — the triangle is
  // taller than wide and the band is tilted, so its support along the band's
  // normal is lopsided — then push it up the normal by `riseN`.
  //
  // That rise is what makes the void read like the reference. The play button
  // there is larger than the stroke is thick, so it cannot be carved out of the
  // diagonal alone: it has to break upward and merge with the counter above,
  // and the two together read as one big triangle. Only its lower edge stays
  // inside the stroke, which is what keeps the S in one piece.
  const proj = tri.map((p) => p.x * MID_N.x + p.y * MID_N.y);
  const off = -(Math.max(...proj) + Math.min(...proj)) / 2 + PLAY.riseN * G.Wmid;
  return tri.map((p) => ({ x: p.x + off * MID_N.x, y: p.y + off * MID_N.y }));
}

const TRI = playTriangle();
const TRI_R = PLAY.corner * PLAY.height * S_HEIGHT;

/** Vertices pulled in by the corner radius, so `sd(inner) − r` rounds exactly. */
const TRI_INNER = TRI.map((v, i) => {
  const a = TRI[(i + 1) % 3];
  const b = TRI[(i + 2) % 3];
  const n = (p) => {
    const l = Math.hypot(p.x - v.x, p.y - v.y);
    return { x: (p.x - v.x) / l, y: (p.y - v.y) / l };
  };
  const e1 = n(a);
  const e2 = n(b);
  let bx = e1.x + e2.x;
  let by = e1.y + e2.y;
  const bl = Math.hypot(bx, by);
  bx /= bl;
  by /= bl;
  const half = Math.acos(clamp(e1.x * bx + e1.y * by, -1, 1));
  const off = TRI_R / Math.sin(half);
  return { x: v.x + bx * off, y: v.y + by * off };
});

function sdTriangle(px, py, v) {
  const e = [
    { x: v[1].x - v[0].x, y: v[1].y - v[0].y },
    { x: v[2].x - v[1].x, y: v[2].y - v[1].y },
    { x: v[0].x - v[2].x, y: v[0].y - v[2].y },
  ];
  let d = Infinity;
  let s = 1;
  for (let i = 0; i < 3; i++) {
    const w = { x: px - v[i].x, y: py - v[i].y };
    const t = clamp((w.x * e[i].x + w.y * e[i].y) / (e[i].x ** 2 + e[i].y ** 2), 0, 1);
    d = Math.min(d, (w.x - e[i].x * t) ** 2 + (w.y - e[i].y * t) ** 2);
    const cond = [py >= v[i].y, py < v[(i + 1) % 3].y, e[i].x * w.y > e[i].y * w.x];
    if ((cond[0] && cond[1] && cond[2]) || (!cond[0] && !cond[1] && !cond[2])) s = -s;
  }
  return s * Math.sqrt(d);
}

const sdPlay = (x, y) => sdTriangle(x, y, TRI_INNER) - TRI_R;

/** Signed area — used to wind the knockout against the contour it cuts. */
function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * The play button as a rounded-corner SVG path, wound against the silhouette so
 * a non-zero fill treats it as a hole.
 */
function playPath(opposeArea = null) {
  const cen = {
    x: (TRI_INNER[0].x + TRI_INNER[1].x + TRI_INNER[2].x) / 3,
    y: (TRI_INNER[0].y + TRI_INNER[1].y + TRI_INNER[2].y) / 3,
  };
  // Outward normal: of the two perpendiculars, the one that walks away from the
  // centroid. Holds whichever way round the vertices happen to be listed.
  const outward = (v, dir) => {
    for (const s of [1, -1]) {
      const n = { x: Math.cos(dir + (s * Math.PI) / 2), y: Math.sin(dir + (s * Math.PI) / 2) };
      const p = { x: v.x + TRI_R * n.x, y: v.y + TRI_R * n.y };
      if (Math.hypot(p.x - cen.x, p.y - cen.y) > Math.hypot(v.x - cen.x, v.y - cen.y)) return p;
    }
    return v;
  };

  let corners = TRI_INNER.map((v, i) => {
    const prev = TRI_INNER[(i + 2) % 3];
    const next = TRI_INNER[(i + 1) % 3];
    return {
      v,
      a: outward(v, Math.atan2(v.y - prev.y, v.x - prev.x)),
      b: outward(v, Math.atan2(next.y - v.y, next.x - v.x)),
    };
  });

  const flip =
    opposeArea !== null &&
    Math.sign(signedArea(TRI_INNER.map((p) => [p.x, p.y]))) === Math.sign(opposeArea);
  if (flip) corners = corners.reverse().map((c) => ({ v: c.v, a: c.b, b: c.a }));

  let d = "";
  corners.forEach((c, i) => {
    let da = Math.atan2(c.b.y - c.v.y, c.b.x - c.v.x) - Math.atan2(c.a.y - c.v.y, c.a.x - c.v.x);
    while (da <= -Math.PI) da += TAU;
    while (da > Math.PI) da -= TAU;
    d += `${i === 0 ? "M" : "L"}${round(c.a.x, 1)} ${round(c.a.y, 1)}`;
    d += `A${round(TRI_R, 1)} ${round(TRI_R, 1)} 0 0 ${da > 0 ? 1 : 0} ${round(c.b.x, 1)} ${round(c.b.y, 1)}`;
  });
  return d + "Z";
}

/* ── the silhouette ─────────────────────────────────────────────────────── */

/**
 * Marching squares over the distance field. Offsetting each flank by hand cannot
 * express what the field already contains — round caps, filleted inner corners,
 * a carved triangle — so the outline is traced from the field itself. Loops come
 * out consistently wound (interior on the left), which means the play button
 * arrives as a hole under a non-zero fill with no winding fixups.
 */
function contourShape(res = 720) {
  const pad = 24;
  const bx = S_BOX.x - pad;
  const by = S_BOX.y - pad;
  const bw = S_BOX.w + pad * 2;
  const bh = S_BOX.h + pad * 2;
  const nx = res;
  const ny = Math.round((res * bh) / bw);
  const dx = bw / nx;
  const dy = bh / ny;

  const val = [];
  for (let j = 0; j <= ny; j++) {
    const row = new Float64Array(nx + 1);
    for (let i = 0; i <= nx; i++) row[i] = shapeSdf(bx + i * dx, by + j * dy);
    val.push(row);
  }

  const segs = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // Corners counter-clockwise from the lower left.
      const v = [val[j][i], val[j][i + 1], val[j + 1][i + 1], val[j + 1][i]];
      const inside = v.map((q) => q < 0);
      const n = inside.filter(Boolean).length;
      if (n === 0 || n === 4) continue;

      const cx = [bx + i * dx, bx + (i + 1) * dx];
      const cy = [by + j * dy, by + (j + 1) * dy];
      const corner = [
        [cx[0], cy[0]],
        [cx[1], cy[0]],
        [cx[1], cy[1]],
        [cx[0], cy[1]],
      ];
      // Crossing on edge k, between corner k and corner k+1.
      const cross = (k) => {
        const a = corner[k];
        const b = corner[(k + 1) % 4];
        const t = v[k] / (v[k] - v[(k + 1) % 4]);
        return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
      };

      // Walk the cell counter-clockwise: an edge that leaves the interior is a
      // segment start, one that enters it is a segment end. Interior ends up on
      // the left of travel, which is the whole point.
      const from = [];
      const to = [];
      for (let k = 0; k < 4; k++) {
        const a = inside[k];
        const b = inside[(k + 1) % 4];
        if (a && !b) from.push(k);
        if (!a && b) to.push(k);
      }
      if (from.length === 1) {
        segs.push([cross(from[0]), cross(to[0])]);
      } else if (from.length === 2) {
        // Saddle. The cell centre decides which way the two branches pair up.
        const mid = shapeSdf(bx + (i + 0.5) * dx, by + (j + 0.5) * dy);
        const order = mid < 0 ? [0, 1] : [1, 0];
        segs.push([cross(from[0]), cross(to[order[0]])]);
        segs.push([cross(from[1]), cross(to[order[1]])]);
      }
    }
  }

  // Stitch. Crossings are computed from the shared edge's two corner values, so
  // neighbouring cells agree to the bit and the keys match.
  const key = (p) => `${Math.round(p[0] * 64)},${Math.round(p[1] * 64)}`;
  const byStart = new Map();
  const byEnd = new Map();
  for (const s of segs) {
    const ks = key(s[0]);
    const ke = key(s[1]);
    if (!byStart.has(ks)) byStart.set(ks, []);
    if (!byEnd.has(ke)) byEnd.set(ke, []);
    byStart.get(ks).push(s);
    byEnd.get(ke).push(s);
  }

  // Walk both ways from each seed. Cells are visited in row-major order, so a
  // seed almost always lands mid-loop; a forward-only walk then runs into the
  // segments an earlier seed already took and stops, shattering one contour
  // into hundreds of stubs.
  const used = new Set();
  const loops = [];
  for (const seed of segs) {
    if (used.has(seed)) continue;
    used.add(seed);
    const pts = [seed[0], seed[1]];
    for (let cur = seed; ; ) {
      const next = (byStart.get(key(cur[1])) ?? []).find((q) => !used.has(q));
      if (!next) break;
      used.add(next);
      pts.push(next[1]);
      cur = next;
    }
    for (let cur = seed; ; ) {
      const prev = (byEnd.get(key(cur[0])) ?? []).find((q) => !used.has(q));
      if (!prev) break;
      used.add(prev);
      pts.unshift(prev[0]);
      cur = prev;
    }
    if (pts.length > 3) loops.push(pts);
  }
  return loops;
}

/** Ramer–Douglas–Peucker. Turns the traced grid into editable node counts. */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * (by - ay) - (pts[i][1] - ay) * (bx - ax)) / len;
      if (d > worst) {
        worst = d;
        idx = i;
      }
    }
    if (worst > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Cubics through the simplified loop. Tangent directions come from the
 * neighbours, Catmull-Rom style, but their LENGTH is tied to the local segment
 * rather than to the neighbour spacing. Simplification leaves points very
 * unevenly spaced — dense round a cap, two points across a whole straight run —
 * and plain uniform Catmull-Rom overshoots wildly on exactly that input.
 */
function loopPath(pts) {
  const n = pts.length;
  const at = (i) => pts[(i + n) % n];
  const unit = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  let d = `M${round(pts[0][0], 1)} ${round(pts[0][1], 1)}`;
  for (let i = 0; i < n; i++) {
    const p1 = at(i);
    const p2 = at(i + 1);
    const t1 = unit(at(i - 1), p2);
    const t2 = unit(p1, at(i + 2));
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3;
    const c1 = [p1[0] + t1[0] * L, p1[1] + t1[1] * L];
    const c2 = [p2[0] - t2[0] * L, p2[1] - t2[1] * L];
    d += `C${round(c1[0], 1)} ${round(c1[1], 1)} ${round(c2[0], 1)} ${round(c2[1], 1)} ${round(p2[0], 1)} ${round(p2[1], 1)}`;
  }
  return d + "Z";
}

/** The whole mark — S and carved play button — as one non-zero-filled path. */
const SILHOUETTE = (() => {
  const loops = contourShape().map((l) => simplify(l.slice(0, -1), 0.35));
  return loops
    .filter((l) => l.length > 4)
    .map(loopPath)
    .join("");
})();

const silhouettePath = () => SILHOUETTE;

/* ── colour ─────────────────────────────────────────────────────────────── */

/**
 * Hue is angular about the mark's centre — a full spectrum wrapped once around
 * the letter, exactly the field the LED reference is built on. Magenta at the
 * top left, red at the top right, amber down the right flank, green at the
 * bottom right, cyan across the bottom, blue back up the left.
 *
 * The offset is what pins that wheel to the letterform; it is the one number
 * that decides which colour lands on which stroke.
 */
export const HUE_OFFSET = 424;
const hueAtXY = (X, Y) => Math.atan2(Y, X) * R2D + HUE_OFFSET;

/** How far out the desaturated, brighter core reaches. */
const CORE_R = 0.4 * Math.max(S_BOX.w, S_BOX.h) * 0.5;

function hsl2rgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h / 60) % 6];
  return t.map((v) => clamp(Math.round((v + m) * 255), 0, 255));
}

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const relLum = ([r, g, b]) =>
  0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);

/**
 * Optical balance. At a fixed HSL lightness, blue reads as a hole and yellow as
 * a flare — fatal for a spectrum that has to hold together as one surface. Solve
 * for the lightness that lands each hue on a common luminance, then blend back
 * part-way so the spectrum still breathes.
 */
const LUM_CACHE = new Map();
function balanced(h, s, l, target = 0.3, mix = 0.6) {
  const key = `${Math.round(h)}|${s.toFixed(2)}|${l.toFixed(2)}|${target.toFixed(2)}`;
  const hit = LUM_CACHE.get(key);
  if (hit) return hit;
  let lo = 0.2;
  let hi = 0.95;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (relLum(hsl2rgb(h, s, mid)) < target) lo = mid;
    else hi = mid;
  }
  const rgb = hsl2rgb(h, s, lerp(l, (lo + hi) / 2, mix));
  const hex = "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  LUM_CACHE.set(key, hex);
  return hex;
}

/** The colour of one LED at (X, Y) in mark space. */
function ledColour(X, Y) {
  const rn = smooth(clamp(Math.hypot(X, Y) / CORE_R, 0, 1));
  return balanced(hueAtXY(X, Y), lerp(0.4, 0.97, rn), lerp(0.74, 0.56, rn), lerp(0.5, 0.3, rn));
}

/* ── the LED matrix ─────────────────────────────────────────────────────── */

export const M = {
  pitch: 33, // LED pitch. The lattice is anchored at the mark's centre, so the
  //           matrix is point-symmetric exactly as the S is.
  rMax: 0.375, // of pitch — an LED wall reads by its gaps as much as its dots
  rMin: 0.3, // of pitch. Close to rMax on purpose: the reference panel is a
  //            uniform grid of equal LEDs, not a halftone that grades away at
  //            the edges. Every lit site is the same lamp.
  fillIn: 0.3, // depth (in pitches) at which dots reach full size
  fillOut: 0.24, // distance outside the edge at which they die. Tight, so the
  //                panel edge is a clean step rather than a fade.
  dither: 0, // no speckle — the reference panel has none
  trail: {
    lambda: 3.0, // decay length, in pitches
    cols: 10, // how far the stream carries
    packet: 1.5, // spatial frequency of the data "packets"
    survive: 2.9, // how readily a site stays lit against the gap noise
    spread: 1.9, // per-row variation in streak length
    style: "streak", // "streak" for the reference's drawn light trails, "particle"
    //                  for shed pixels
    minLen: 2.2, // shortest streak, in pitches
    thickness: 0.62, // streak height, as a fraction of an LED's diameter
    rowGate: 0.62, // fraction of rows that shed nothing at all. Without this every
    //               row trails and the result is one soft smear off the side of
    //               the letter rather than a handful of distinct streams.
    scatter: 0.55, // how far a shed particle drifts off-lattice, in pitches.
    //                The panel itself stays perfectly aligned — only what has
    //                left it disperses. Pixels in flight are not still on the
    //                grid they came from.
    taper: 0.62, // how much smaller particles run than the panel's LEDs
  },
};

/**
 * Motion runs one way. The whole mark is travelling right, so every row sheds
 * lit pixels to its left and nothing trails forward — which is what separates a
 * signal from a mirror-image decoration.
 */
function buildDots({ pitch = M.pitch, trails = true, mono = false, grade = null } = {}) {
  const g = grade ? { ...M, ...grade } : M;
  const iMax = Math.ceil(Math.max(-S_BOX.x, S_BOX.x + S_BOX.w) / pitch) + 2;
  const jMax = Math.ceil(Math.max(-S_BOX.y, S_BOX.y + S_BOX.h) / pitch) + 2;

  const fIn = g.fillIn * pitch;
  const fOut = g.fillOut * pitch;
  const rMax = g.rMax * pitch;
  const rMin = g.rMin * pitch;

  const dots = [];
  const rows = new Map(); // j → i of the leftmost lit site

  for (let j = -jMax; j <= jMax; j++) {
    for (let i = -iMax; i <= iMax; i++) {
      const X = i * pitch;
      const Y = j * pitch;
      // Design space is y-up; the SVG is y-down. One negation, stated once.
      const sd = shapeSdf(X, -Y);

      const depth = -sd;
      const t = clamp((depth + fOut) / (fIn + fOut), 0, 1);
      if (t <= 0) continue;
      if (t < 0.34 && h2(i, j, 1) < ((0.34 - t) / 0.34) * g.dither) continue;

      const r = rMin + (rMax - rMin) * smooth(t);
      if (!rows.has(j) || i < rows.get(j)) rows.set(j, i);
      dots.push(mono ? { x: X, y: Y, r } : { x: X, y: Y, r, fill: ledColour(X, Y) });
    }
  }

  if (!trails) return dots;
  if (M.trail.style === "streak") {
    // The reference trails are drawn light, not shed pixels: a few thin lines
    // running off the panel's left edge and fading out. Only a minority of rows
    // carry one, or the letter grows a smear instead of a few streaks.
    for (const [j, iAttach] of rows) {
      if (h2(j, 0, 13) < M.trail.rowGate) continue;
      const Y = j * pitch;
      const len = pitch * (M.trail.minLen + M.trail.spread * h2(j, 0, 7));
      const x1 = iAttach * pitch + rMax;
      dots.push({
        streak: true,
        x0: x1 - len,
        x1,
        y: Y,
        h: rMax * 2 * M.trail.thickness,
        fill: mono ? null : ledColour(x1 - len * 0.35, Y),
      });
    }
    return dots;
  }

  const lambdaBase = M.trail.lambda * pitch;
  for (const [j, iAttach] of rows) {
    if (h2(j, 0, 13) < M.trail.rowGate) continue;
    const Y = j * pitch;
    // Streak length varies per row, which is what makes the trail read as
    // discrete streams rather than one soft smear off the side of the letter.
    const L = lambdaBase * (0.2 + M.trail.spread * h2(j, 0, 7));
    const phase = h2(j, 0, 3) * TAU;

    for (let k = 1; k <= M.trail.cols; k++) {
      const dist = k * pitch;
      let f = Math.exp(-dist / L);
      f *= 0.72 + 0.36 * Math.sin((dist / pitch) * M.trail.packet + phase);
      if (f <= 0 || h2(j, k, 11) > f * M.trail.survive) continue;

      const r = rMax * M.trail.taper * clamp(f, 0, 1) ** 0.55;
      if (r < rMin * 0.9) continue; // no lone specks stretching the bounds

      // Drift off the lattice, growing with distance travelled.
      const drift = M.trail.scatter * pitch * (0.35 + 0.65 * (k / M.trail.cols));
      const X = (iAttach - k) * pitch + (h2(j, k, 21) - 0.5) * drift;
      const Yp = Y + (h2(j, k, 29) - 0.5) * drift * 0.85;
      dots.push(
        mono
          ? { x: X, y: Yp, r }
          : { x: X, y: Yp, r, fill: ledColour(X, Yp), o: clamp(0.3 + 0.8 * f, 0, 1) },
      );
    }
  }

  return dots;
}

/* ── emit ───────────────────────────────────────────────────────────────── */

function bbox(dots, pad = 0) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const d of dots) {
    const [a, b, c, e] = d.streak
      ? [d.x0, d.y - d.h / 2, d.x1, d.y + d.h / 2]
      : [d.x - d.r, d.y - d.r, d.x + d.r, d.y + d.r];
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, e);
  }
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

/**
 * Streaks need a per-streak gradient — they fade to nothing at the tail and each
 * one sits at a different point on the colour wheel, so they cannot share one.
 */
function streakDefs(dots, indent = "      ") {
  return dots
    .filter((d) => d.streak)
    .map(
      (d, i) =>
        `${indent}<linearGradient id="sx-tr${i}" x1="0" y1="0" x2="1" y2="0">` +
        `<stop offset="0" stop-color="${d.fill ?? "#fff"}" stop-opacity="0"/>` +
        `<stop offset="1" stop-color="${d.fill ?? "#fff"}" stop-opacity=".85"/></linearGradient>`,
    )
    .join("\n");
}

function circles(dots, indent = "    ") {
  let streak = 0;
  return dots
    .map((d) => {
      if (d.streak) {
        const id = `sx-tr${streak++}`;
        const fill = d.fill ? `url(#${id})` : "currentColor";
        return (
          `${indent}<rect x="${round(d.x0, 1)}" y="${round(d.y - d.h / 2, 1)}" ` +
          `width="${round(d.x1 - d.x0, 1)}" height="${round(d.h, 1)}" ` +
          `rx="${round(d.h / 2, 2)}" fill="${fill}"${d.fill ? "" : ' opacity=".55"'}/>`
        );
      }
      const o = d.o !== undefined && d.o < 0.995 ? ` opacity="${round(d.o, 2)}"` : "";
      const f = d.fill ? ` fill="${d.fill}"` : "";
      return `${indent}<circle cx="${round(d.x, 1)}" cy="${round(d.y, 1)}" r="${round(d.r, 2)}"${f}${o}/>`;
    })
    .join("\n");
}

const HEAD = (vb, title, desc) =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${vb}" role="img" aria-labelledby="sx-t sx-d">
  <title id="sx-t">${title}</title>
  <desc id="sx-d">${desc}</desc>`;

/**
 * Bloom is one blur of the matrix, twice, at two radii — never a per-dot filter.
 * Both radii are tied to the pitch so the glow keeps its proportion if the panel
 * density changes, and both are deliberately restrained: an OLED lifts the air
 * around a pixel, it does not smear it.
 */
const GLOW_FILTERS = `    <filter id="sx-bloom" x="-25%" y="-45%" width="150%" height="190%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="${round(M.pitch * 0.85, 1)}"/>
    </filter>
    <filter id="sx-halo" x="-12%" y="-22%" width="124%" height="144%" color-interpolation-filters="sRGB">
      <feGaussianBlur stdDeviation="${round(M.pitch * 0.17, 2)}"/>
    </filter>`;
const BLOOM_OPACITY = 0.32;
const HALO_OPACITY = 0.46;

function markSvg({ pitch = M.pitch, trails = true, glow = true, pad = 30 } = {}) {
  const dots = buildDots({ pitch, trails });
  const b = bbox(dots, pad);
  const vb = `${round(b.x, 1)} ${round(b.y, 1)} ${round(b.w, 1)} ${round(b.h, 1)}`;
  return `${HEAD(vb, "Streamatrix", "The Streamatrix mark: an S built as an LED matrix, with the play button carved from its diagonal.")}
  <defs>
${glow ? GLOW_FILTERS + "\n" : ""}    <!-- The analytic silhouette. Not drawn by the matrix, but the shape the
         matrix samples — keep them in step if you edit either. -->
    <path id="sx-silhouette" d="${silhouettePath()}"/>
    <path id="sx-play" d="${playPath()}"/>
${streakDefs(dots)}
    <g id="sx-leds">
${circles(dots, "      ")}
    </g>
  </defs>
  <g id="streamatrix-mark">
${
  glow
    ? `    <use xlink:href="#sx-leds" href="#sx-leds" filter="url(#sx-bloom)" opacity="${BLOOM_OPACITY}"/>
    <use xlink:href="#sx-leds" href="#sx-leds" filter="url(#sx-halo)" opacity="${HALO_OPACITY}"/>
`
    : ""
}    <use xlink:href="#sx-leds" href="#sx-leds"/>
  </g>
</svg>
`;
}

function monoSvg(color, { pitch = M.pitch, trails = true, pad = 12 } = {}) {
  const dots = buildDots({ pitch, trails, mono: true });
  const b = bbox(dots, pad);
  const vb = `${round(b.x, 1)} ${round(b.y, 1)} ${round(b.w, 1)} ${round(b.h, 1)}`;
  return `${HEAD(vb, "Streamatrix", `The Streamatrix mark, single colour (${color}).`)}
  <g id="streamatrix-mark" fill="${color}">
${circles(dots, "    ")}
  </g>
</svg>
`;
}

/** Design space is y-up and the SVG is y-down, so the geometry flips once here. */
const FLIP = `scale(1 -1)`;

function solidSvg(color = "#ffffff", pad = 14) {
  return `${HEAD(
    `${round(S_BOX.x - pad, 1)} ${round(-S_BOX.y - S_BOX.h - pad, 1)} ${round(S_BOX.w + pad * 2, 1)} ${round(S_BOX.h + pad * 2, 1)}`,
    "Streamatrix",
    "The Streamatrix silhouette as pure geometry — five strokes and one carved play button.",
  )}
  <g transform="${FLIP}">
    <path fill="${color}" d="${silhouettePath()}"/>
  </g>
</svg>
`;
}

function iconSvg(size = 512, { radiusRatio = 0.2237 } = {}) {
  const dots = buildDots({ pitch: M.pitch, trails: true });
  // Fit the S itself, not the dot bounds — otherwise the trails, which are meant
  // to run off the tile, shrink the letter until the icon is mostly padding.
  const fit = (size * 0.76) / Math.max(S_BOX.w, S_BOX.h);
  const r = size * radiusRatio;
  return `${HEAD(`0 0 ${size} ${size}`, "Streamatrix", "The Streamatrix app icon.")}
  <defs>
${GLOW_FILTERS}
    <linearGradient id="sx-tile" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#14161c"/>
      <stop offset="1" stop-color="#05060a"/>
    </linearGradient>
    <linearGradient id="sx-rim" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff4d8d" stop-opacity=".55"/>
      <stop offset=".5" stop-color="#8b5cf6" stop-opacity=".35"/>
      <stop offset="1" stop-color="#22d3ee" stop-opacity=".55"/>
    </linearGradient>
${streakDefs(dots)}
    <g id="sx-leds">
${circles(dots, "      ")}
    </g>
  </defs>
  <rect width="${size}" height="${size}" rx="${round(r, 1)}" fill="url(#sx-tile)"/>
  <g transform="translate(${round(size / 2, 2)} ${round(size / 2, 2)}) scale(${round(fit, 4)})">
    <use xlink:href="#sx-leds" href="#sx-leds" filter="url(#sx-bloom)" opacity="${BLOOM_OPACITY}"/>
    <use xlink:href="#sx-leds" href="#sx-leds" filter="url(#sx-halo)" opacity="${HALO_OPACITY}"/>
    <use xlink:href="#sx-leds" href="#sx-leds"/>
  </g>
  <rect x="1" y="1" width="${size - 2}" height="${size - 2}" rx="${round(r - 1, 1)}" fill="none" stroke="url(#sx-rim)" stroke-width="2"/>
</svg>
`;
}

/**
 * The favicon is the matrix, hinted per size.
 *
 * A dot pitch fine enough to draw the S at full size is finer than a pixel at
 * 16px, so one design scaled down turns to mush. Each ICO entry therefore gets
 * its OWN pitch, chosen so the letter is a fixed number of LEDs tall whatever
 * the pixel size — the panel gets coarser as the icon gets smaller, exactly the
 * way a real LED wall does when you walk away from it.
 *
 * The dots also run fatter here (`FAVICON_GRADE`) and the edge dither is off. At
 * this pitch every site is load-bearing: the matrix has to carry the shape, not
 * decorate it, and a missing dot is a missing chunk of letter.
 */
const FAVICON_GRADE = {
  rMin: 0.22,
  fillIn: 0.35,
  fillOut: 0.3,
  dither: 0, // no speckle — every site counts at this size
};

/**
 * LED rows tall, and how fat the dots run, at each icon size. Both loosen as the
 * icon shrinks: at 16px a dot is under two device pixels, so anti-aliasing eats
 * any gap you leave it, and the dots have to close up until the letter survives.
 * Below about eight rows the S stops being an S at all.
 */
const FAVICON_HINT = {
  16: { rows: 8, rMax: 0.53 },
  32: { rows: 11, rMax: 0.49 },
  48: { rows: 13, rMax: 0.47 },
  64: { rows: 15, rMax: 0.46 },
  128: { rows: 19, rMax: 0.45 },
};

function faviconSvg(size = 64, hint = FAVICON_HINT[size] ?? FAVICON_HINT[64]) {
  const { rows, rMax } = hint;
  const dots = buildDots({
    pitch: S_BOX.h / rows,
    trails: false,
    grade: { ...FAVICON_GRADE, rMax },
  });
  const b = bbox(dots, 0);
  const fit = (size * 0.99) / Math.max(b.w, b.h);
  return `${HEAD(`0 0 ${size} ${size}`, "Streamatrix", `The Streamatrix favicon, ${rows} LEDs tall.`)}
  <g transform="translate(${round(size / 2, 2)} ${round(size / 2, 2)}) scale(${round(fit, 5)}) translate(${round(-(b.x + b.w / 2), 2)} ${round(-(b.y + b.h / 2), 2)})">
${circles(dots, "    ")}
  </g>
</svg>
`;
}

/** The same mark as flat geometry — kept for stamping, embroidery and one-colour use. */
function faviconSolidSvg(size = 64) {
  const fit = (size * 0.98) / Math.max(S_BOX.w, S_BOX.h);
  // Sample the wheel at the corners the S actually occupies.
  const stops = [
    [0, -0.7, -0.6],
    [0.3, 0.7, -0.6],
    [0.5, 0.9, 0.1],
    [0.75, 0.5, 0.8],
    [1, -0.7, 0.7],
  ]
    .map(
      ([off, ux, uy]) =>
        `      <stop offset="${round(off, 2)}" stop-color="${ledColour(ux * S_BOX.w * 0.5, uy * S_BOX.h * 0.5)}"/>`,
    )
    .join("\n");
  return `${HEAD(`0 0 ${size} ${size}`, "Streamatrix", "The Streamatrix favicon.")}
  <defs>
    <linearGradient id="sx-fav" x1=".1" y1="0" x2=".9" y2="1">
${stops}
    </linearGradient>
  </defs>
  <g transform="translate(${round(size / 2, 2)} ${round(size / 2, 2)}) scale(${round(fit, 4)})">
    <g transform="${FLIP}">
      <path fill="url(#sx-fav)" d="${silhouettePath()}"/>
    </g>
  </g>
</svg>
`;
}

/* ── write ──────────────────────────────────────────────────────────────── */

function main() {
  mkdirSync(OUT, { recursive: true });
  const files = {
    // The master IS the dark version — bloom only makes sense against a dark
    // ground. The light variant is the same matrix with the bloom removed,
    // because on white a bloom greys the paper instead of lighting it.
    "streamatrix-mark.svg": markSvg(),
    "streamatrix-mark-light.svg": markSvg({ glow: false }),
    "streamatrix-mark-black.svg": monoSvg("#000000"),
    "streamatrix-mark-white.svg": monoSvg("#ffffff"),
    "streamatrix-mark-solid.svg": solidSvg("#ffffff"),
    "streamatrix-icon.svg": iconSvg(512),
    // One hinted favicon per ICO entry — see faviconSvg for why they are not
    // one file scaled.
    "streamatrix-favicon.svg": faviconSvg(64),
    "streamatrix-favicon-16.svg": faviconSvg(16),
    "streamatrix-favicon-32.svg": faviconSvg(32),
    "streamatrix-favicon-48.svg": faviconSvg(48),
    "streamatrix-favicon-128.svg": faviconSvg(128),
    "streamatrix-favicon-solid.svg": faviconSolidSvg(64),
  };
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(OUT, name), body);
    console.log(`${name}  ${(body.length / 1024).toFixed(1)} KB`);
  }
  const d = buildDots({});
  console.log(
    `\n${d.length} LEDs · pitch ${M.pitch} · S ${Math.round(S_BOX.w)}×${Math.round(S_HEIGHT)}`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("streamatrix-mark.mjs")) main();

export {
  ledColour,
  buildDots,
  markSvg,
  monoSvg,
  solidSvg,
  iconSvg,
  faviconSvg,
  silhouettePath,
  playPath,
  shapeSdf,
  contourShape,
  S_BOX,
};
