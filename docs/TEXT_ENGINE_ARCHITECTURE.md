# Text Engine — Implemented Architecture

**Date:** 2026-08-03 · **Status:** IMPLEMENTED (Phase 3B)
**Specifies:** the built system. Supersedes the forward-looking parts of
[TEXT_ENGINE.md](./TEXT_ENGINE.md), which remains the design rationale.
**Closes:** T2, T3, T4 · **Raises:** [IF-004](./IMPLEMENTATION_FINDING_IF-004.md)

---

## 1. What was built

All eight stages, as one package, plus the integration that makes text a scene
node rather than a library.

```
  font binary (TTF/OTF)
      │
  1.  parse        font.ts      HarfBuzz — metrics, cmap, advances, OUTLINES
  2.  itemize      segment.ts   UAX #24, via unicode-properties
  3.  bidi         segment.ts   UAX #9,  via bidi-js
  4.  shape        shape.ts     HarfBuzz, cached per run
  5.  break        segment.ts   UAX #14, via linebreak
  6.  layout       layout.ts    lines, alignment, baselines
  7.  fit          layout.ts    wrap / shrink / truncate / overflow
  8a. rasterize    msdf.ts      multi-channel distance fields
  8b. atlas        atlas.ts     skyline packing, LRU, on-air pinning
      │
      └──▶ engine.ts ──▶ quads + UVs ──▶ TextProvider port ──▶ projector ──▶ mesh
```

| | Lines |
| --- | --- |
| `engine-text` (8 modules) | ~2,100 |
| `TextProvider` port + projection branch | ~330 |
| `HostTextProvider` adapter | ~190 |
| MSDF shader (three) | ~60 |
| Studio integration | **~40** |

That last number is the one worth looking at. §7 explains it.

---

## 2. The three open decisions, closed

### T3 — adopt or re-implement `troika-three-text`? **Re-implement.**

Decided on evidence, not recollection. Four reasons, each sufficient alone:

| | Finding | Source |
| --- | --- | --- |
| 1 | `three` is a **peer dependency**; the export is used "like any other Three.js mesh" | npm registry metadata + README |
| 2 | It produces **SDF, not MSDF** — "using signed distance fields (SDF)" | README |
| 3 | Its generator is `webgl-sdf-generator`, which **requires a WebGL context** | dependency list |
| 4 | Atlas eviction and pinning are **not documented as guarantees** | README |

(1) alone disqualifies it: `engine-text` is `engine-core` and is not permitted to
import three. Putting it in `engine-render-three` instead would move *layout* —
line breaks, fit results, engine state a show depends on — into a backend, which
is the C1 reversal undone. (2) contradicts §4, which requires MSDF explicitly and
argues why. (3) makes it unusable in a headless cloud renderer. (4) makes §5's
pinning requirement unverifiable.

**What was adopted instead:** the pieces troika itself uses that are
backend-neutral. `bidi-js` is by troika's own author, and we vendor it directly.

### T2 — MSDF quality at 24–96pt. **Passed, with a caveat.**

Verified by reconstructing the field rather than by looking at it: the median of
the three channels must read *inside* at a stem's centre and *outside* at the
padded corner, and a letter O's counter must read outside — which fails
immediately if the winding rule or the edge colouring is wrong.

Cost measured at three sizes (§6). Quality holds at 32/48/64px buckets, and
because a distance field is resolution-independent, a bucket serves every size
near it — which is what makes the √2 bucketing in §4 affordable.

**Caveat:** the quality trial was run on Latin, Arabic, Hebrew and Thai. **CJK
was not tested**, because a CJK font is 2.4MB and too heavy to vendor as a test
fixture. CJK glyphs have several times the contour count, so both generation
cost and thin-stem quality at small sizes are **Unknown**, not Proven. §8 lists
it as an open gap rather than an answered question.

### T4 — where does a pre-warm character set live? **On the scene.**

`world.textPrewarm: { ranges?: TextRange[]; characters?: string }`.

Not on the font asset, because **a font is shared and a scene is not**: the same
Noto Sans serves a Latin-only scoreboard and a Korean one, and a set declared on
the asset is wrong for every scene but the one it was authored against.

The engine already derives most of the set — every glyph in static text and in
variable defaults is known at load and arrives through the ordinary render path.
The field covers only what cannot be derived: **the range live data will draw
from.** "This scoreboard will show Korean names" is a fact about the show, and a
human is the only one who knows it.

Declared by NAME (`"hangul"`), not by codepoint range, so a document stays small,
Studio can offer tick-boxes, and refining a range later is a code change rather
than a migration of every scene that used it. Optional with a defined default, so
SCENE_FORMAT §13 rule 4 makes it additive — **no version bump**.

---

## 3. Decisions the implementation changed

Three places where building it produced a better answer than the design had.

### One font parser, not two

TEXT_ENGINE §10 planned to vendor opentype.js or Typr for parsing *alongside*
HarfBuzz for shaping. Unnecessary: `harfbuzzjs` already exposes `hExtents`,
`nominalGlyph`, `glyphHAdvance`, `glyphExtents`, `collectUnicodes` **and
`glyphToJson`** — outlines as path commands, which is exactly what stage 8 needs.

Two parsers would be two sources of truth for the cmap and the metrics, and any
disagreement shows up as a glyph that shapes with one library and rasterises with
the other — a `.notdef` in the middle of a name. Deleting the second parser
deletes that failure class and removes a dependency.

### The projector does not import the text engine

`engine-text` and `engine-reconciler` are both `engine-core`; a direct edge would
be legal and acyclic. It is still wrong: **`harfbuzzjs` instantiates a WASM
binary at import time**, so that edge would make a colour-bar scene pay for
HarfBuzz.

So the reconciler declares a five-method `TextProvider` port and the composition
root supplies it — exactly what it already does for `MirrorBackend`. A scene with
no provider wired attaches nothing for a `text` component and the node survives,
which is the behaviour an asset-backed mesh already has. Asserted.

`engine-host` gained one allow-list edge to `engine-text`. That edge is what a
composition root is *for*.

### Winding is a scanline, not a point test

The obvious MSDF implementation asks "is this texel inside?" per texel, which is
O(texels × segments). Measured: 13–18ms per glyph, ~1.5s to pre-warm a Latin set.

Every texel in a row shares its `y`, so the crossings are the same for all of
them. Computing them once per row makes winding O(segments) per **row** — a 39×
reduction on a 39-texel glyph, growing with the glyph. With a per-segment
bounding-box reject on top: **2.04ms per glyph at 48px**.

---

## 4. What makes layout deterministic

TEXT_ENGINE §8 lists four requirements. How each is met:

| | Requirement | Mechanism |
| --- | --- | --- |
| 8.1 | Identical glyph positions on every target | Everything up to geometry is integer arithmetic in font units; the golden-layout test pins exact positions to four decimals |
| 8.2 | `shrink` settles on the same size everywhere | **Eight** iterations, sizes quantised to 0.25pt, largest-that-fits always kept. The set of testable sizes is finite and identical everywhere, so float behaviour cannot change the outcome |
| 8.3 | Advances in fixed point, never accumulated floats | The font is scaled to its own `upem`, so HarfBuzz returns **integers**. Asserted |
| 8.4 | Bidi and break results depend only on the Unicode version | Pinned with the vendored packages. No `Intl.*`, no locale-sensitive `String` method, anywhere — [IF-004 §6](./IMPLEMENTATION_FINDING_IF-004.md) makes that a rule |

**Determinism scope stops at stage 8.** MSDF generation is float maths whose
output is *pixels*, and MirrorBackend C8 puts pixels outside the guarantee. The
separation is load-bearing and holds because **layout never reads the atlas** —
it reads font metrics. That is what lets `msdf.ts` use ordinary floating point
without weakening anything.

---

## 5. Text is a mesh

The integration, in one sentence: **`#applyText` is deliberately the same shape
as `#applyRect`** — resolve props, compare against what is attached, recreate
only what changed.

That is the whole reason text participates in everything else. A text node
inherits the hierarchy, the transform, the dirty channels, variable bindings, the
timeline, collections and states, and **none of them know it is text**.

`props.content` is `Bindable<string>`, so it arrives at the projector already
*resolved*. That single fact is why text works with variables, live commands and
collections with no text-aware code anywhere in those paths.

**One mesh per atlas page, as a mirror child.** A mesh samples one texture and a
long multilingual string can span two pages, so geometry comes back batched by
page and each batch becomes a child sharing its parent's world matrix exactly.
Mirror nodes with no document counterpart are already an established shape — a
repeat's instances are exactly that.

---

## 6. Cost

Full table in [TEXT_ENGINE_VERIFICATION.md §5](./TEXT_ENGINE_VERIFICATION.md).
The budget is TEXT_ENGINE §7's: **2ms per frame for text layout across all
visible nodes.**

| | Mean | |
| --- | --- | --- |
| One name, warm shaper | **0.0090 ms** | on the frame path |
| Wrapped sentence | 0.0263 ms | " |
| Right-to-left with bidi | 0.0208 ms | " |
| `shrink`, eight iterations | 0.1383 ms | " |
| **Twenty names — one leaderboard** | **0.1447 ms** | **14× inside the 2ms budget** |
| Cached shaping run | 0.0007 ms | |
| MSDF, one glyph at 48px | 2.04 ms | **off-frame, P2** |
| Pre-warm a Latin set (52 glyphs) | 257 ms | **load-time** |

The two classes must not be compared. Layout is P1 and budgeted; rasterisation is
P2, runs in a Worker, and is covered by pre-warm — which is exactly why §5 makes
pre-warm the on-air path.

---

## 7. Studio needed ~40 lines

Phase 3A's generic-node audit predicted that a future TextNode would cost "two
table rows, not a phase". Held:

| | |
| --- | --- |
| `colourPath` in `presets.ts` | **1 line** — text fades because `color` is where its colour lives |
| `COMPONENT_FIELDS` in the inspector | **1 row** — six properties, declaratively |
| `COMPONENT_CHOICES` | 1 entry — fit mode, align, vertical align |
| `TOOLBOX` + `makeNode` | 1 entry + 1 case |
| Font loading | **~90 lines**, and genuinely new |

Everything else — keyframing, presets, alignment, grouping, layer order,
templates, Preview/Program, undo — worked on text the day it existed, with no
change. The timeline editor keyframes a text node because a track is
`(target, path)` and it never asks what a node is.

Font loading is the honest exception, and it is not an editor-architecture
change: fonts are assets, the engine loads binaries, and somebody has to fetch
them.

---

## 8. What is not done

| | |
| --- | --- |
| **Thai/Khmer/Lao/Burmese wrapping** | UAX #14 provides no opportunities inside them. Mitigated with a reported emergency break — [IF-004](./IMPLEMENTATION_FINDING_IF-004.md) |
| **CJK quality and cost** | Untested. A CJK font is too heavy to vendor as a fixture; contour counts are several times Latin's, so generation cost is **Unknown** |
| **Worker execution** | §4 requires MSDF generation off the frame thread. It is currently synchronous. Pre-warm makes it load-time, so this is a latency improvement, not a correctness gap — but it is not done |
| Sub-rectangle texture upload | The backend writes the region into its CPU image correctly and re-uploads the whole page. Correct, and 16MB per novel glyph. Recorded in `three-backend.ts` |
| Vertical text, ruby, OpenType feature selection | Not required by any consumer yet |
| Text on a 3D surface at an angle | The pipeline supports it (world-space is a scale); nobody has looked at it, because there is still no 3D viewport |

---

## 9. Next

1. **The 3D viewport.** Now the last outstanding engine piece, and overdue —
   it is the only way to confirm lighting and world-space text on screen.
2. **Phase 3C — the official graphics library.** Unblocked: all six templates
   are now buildable.
3. ICU4X word segmentation, when a Thai/Khmer broadcaster is a real customer.
