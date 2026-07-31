# RFC-001 — Rendering Architecture

**Status:** ⚠️ **SUPERSEDED** by [RFC-003](./RFC-003-rendering-architecture-3d.md)
on 2026-07-30 · **Authored:** 2026-07-30 · **Owner:** @Pixelborne

> **This document is retained for decision history only. Do not implement from
> it.**
>
> It answered "what renders 2D broadcast graphics in a browser" and answered it
> correctly for that question. The product was then reframed as a real-time 3D
> production engine, and Canvas2D cannot express a perspective camera, a depth
> buffer, lighting, or meshes — so the conclusion below is void.
>
> Two findings survive and are carried into RFC-003: transparent output forces
> grayscale antialiasing on every option, and the runtime must be a pure
> function of `(document, time)`.

---

> Binding on every rendering subsystem: the scene runtime, the editor preview,
> the render surface, and any future cloud renderer. Changing anything in §4–§9
> requires a superseding RFC, not an edit.

---

## 1. Decision

**A retained-mode scene graph with a deterministic, time-addressable pipeline,
rasterized by a pluggable backend. The v1 backend is Canvas2D.**

WebGL2 is the planned second backend, added when a specific feature demands it
(§10). WebGPU is deferred, not rejected (§5).

The load-bearing part of this decision is **not** "Canvas2D". It is that the
scene graph, layout, animation evaluation, and compositing model are backend-
independent, and that the renderer is a pure function of `(document, time)`.
The rasterizer is the last and smallest stage.

## 2. What decides this

Ordered by how much weight each carries. These are properties of BracketX
specifically — a different product would reach a different answer.

1. **The render surface runs inside OBS's embedded browser, not Chrome.**
   Operators load a browser source; the runtime is whatever CEF that OBS build
   ships. This is the least capable target we must support and the one we
   control least.
2. **Transparent output.** Graphics composite over live video, so the page has
   an alpha channel.
3. **Text is most of the product.** Names, scores, titles, tickers, brackets.
   Text quality is not a detail; it is the deliverable.
4. **Zero dropped frames for hours**, on the operator's machine, while an
   encoder is already consuming GPU and CPU.
5. **Time-addressability.** The editor must scrub to an arbitrary time, and
   [Phase 15](./ROADMAP.md#phase-15--cloud-platform) renders server-side, where
   frames are produced on a schedule that is not wall-clock.
6. **Editor preview and on-air output must be identical**
   ([ADR-004](./ARCHITECTURE.md#adr-004) and the shared-runtime rule in
   [ROADMAP.md Phase 4](./ROADMAP.md#phase-4--scene-editor)).

## 3. Options

The brief named WebGPU, WebGL2, and Canvas. **DOM/CSS is included** because it
is what most production web overlays actually use today, and excluding the
incumbent approach without argument would be dishonest.

| | DOM/CSS | Canvas2D | WebGL2 | WebGPU |
|---|---|---|---|---|
| Text quality | Excellent | Excellent¹ | Poor→Good² | Poor→Good² |
| Text layout provided | Full | **None** | None | None |
| Frame-loop control | None | Full | Full | Full |
| Time-addressable | Very hard | Yes | Yes | Yes |
| Alpha compositing | Yes | Yes | Yes | Yes |
| Shader effects | No | No | Yes | Yes |
| Perf ceiling | Medium | Medium | High | Highest |
| OBS/CEF risk | None | None | Low | **Unverified** |
| Cost to build | Lowest | Low | High | High |

¹ See §4 — the usual DOM advantage does not apply to our case.
² Depends entirely on the text strategy chosen; see §4.

### DOM/CSS — rejected

Genuinely strong on text and cheap to start. Rejected on two grounds that are
not negotiable for this product:

- **Not time-addressable.** CSS animations are driven by the compositor's own
  clock. There is no supported way to ask for "the exact visual state at
  t = 1234ms" and get it deterministically. That breaks editor scrubbing and
  makes offline cloud rendering (Phase 15) impractical rather than merely hard.
- **Output depends on layout.** Two CEF versions can lay out the same DOM
  differently. "The editor shows what goes on air" degrades into "usually".

### Canvas2D — chosen for v1

Immediate-mode drawing under our own frame loop. Full control of when a frame is
produced and what time it represents. Uses the platform text engine for
rasterization, so glyph quality matches the browser's own.

Its real cost is honest and specific: **it provides no text layout.** Line
breaking, alignment, and fitting are ours to build (§4). That is a bounded
problem for broadcast graphics — boxes with known constraints, mostly one to
three lines — and nothing like implementing a word processor.

### WebGL2 — planned second backend, not first

The right answer once effects exist: blend modes beyond the Canvas2D set,
blur/glow, video textures, masks with shaders, particles.

Not first, because none of that is in the MVP scope
([ROADMAP.md](./ROADMAP.md) Phases 3–7 need text, images, rectangles, groups,
transforms, opacity, and simple masks — all comfortably within Canvas2D), and
because building a GPU renderer *and* a text pipeline *and* hitting the
zero-dropped-frames bar inside Phase 3's 6–9 weeks is where this schedule would
break.

### WebGPU — deferred, with a defined trigger

Best performance ceiling and the obvious long-term target. Deferred for one
reason: **the render surface's runtime is OBS's CEF, and we have not verified
WebGPU availability there.** Browser support is broad by 2026; that is not the
same claim. OBS ships a pinned CEF, operators run old OBS versions for months,
and GPU features are sometimes disabled by default in that embedding.

Betting the renderer on it would make our support matrix "whichever OBS builds
happen to work", for a product whose core promise is not failing on air.

**Verification task (owner: engineering, due Phase 3 week 1):** install the
three most common OBS versions in current use, load a probe page in a browser
source, and record `navigator.gpu` availability and adapter details. Attach the
results to this RFC. Revisit when WebGPU is available on every OBS version we
support *and* a feature needs compute shaders.

## 4. Text rendering strategy

The most consequential section of this RFC.

### Why Canvas2D's text is not a compromise here

The usual argument for DOM text is subpixel (LCD) antialiasing. **It does not
apply to us.** Subpixel AA requires knowing the backdrop colour, and our output
is transparent — composited over unknown video by OBS. Every approach must
therefore use grayscale AA. DOM's advantage evaporates in exactly our use case.

What Canvas2D keeps is the platform text engine for shaping and rasterization:
correct kerning, ligatures, and complex-script shaping, for free.

### What we build

A **text layout engine** operating above the rasterizer:

- **Measurement** via `measureText`, using `actualBoundingBox*` metrics rather
  than the em box, cached per (string, font, size).
- **Line breaking** at grapheme/word boundaries using `Intl.Segmenter`, so
  scripts without spaces are handled correctly. Esports is global; assuming
  space-delimited words is a defect, not a simplification.
- **Alignment and baseline control** within a box: horizontal start/center/end,
  vertical top/middle/bottom, and explicit first-baseline positioning.
- **Fit behaviour** — required, not optional. Broadcast text has unpredictable
  length; a player name may be 3 characters or 30 in the same slot. The format
  must express one of: `wrap`, `shrink` (reduce size to a floor), `truncate`
  (with ellipsis), or `overflow`. This is where naive overlay tools fail on air.

### Font loading

Fonts are a render-determinism problem, not a storage problem
([DATABASE.md §4.6](./DATABASE.md) records the same reasoning).

- Loaded via the `FontFace` API and awaited explicitly.
- **The first frame is not painted until every font the scene references has
  resolved.** A font swapping mid-broadcast is a visible failure.
- A missing font is a hard, visible error in the editor and a defined fallback
  on air — never a silent substitution that shifts every layout.

## 5. Coordinate system

- **Design space is 1920 × 1080 logical units**, fixed. Not the output
  resolution — the space authors work in.
- **Origin top-left, +x right, +y down.** Matches Canvas2D, CSS, and raster
  video convention. Choosing y-up would mean converting at every boundary.
- **One root transform** maps design space to the output surface. Rendering at
  720p or 4K changes that transform and nothing else; scenes are resolution-
  independent.
- **Device pixel ratio** is applied at the root only. Nodes never see it.
- **Anchors are normalized** (0–1 within the node's own box), so a node scales
  and rotates about a meaningful point independent of its size.
- **Rotation in degrees, clockwise**, matching the visual convention authors
  expect. Radians appear only inside the math.
- **Safe areas** (title-safe, action-safe) are canvas metadata and an editor
  overlay. They constrain nobody at render time — they are guidance, and
  enforcing them would break legitimate full-bleed designs.

## 6. Pipeline

Five phases, each a pure function of its input. Purity is what makes the
renderer time-addressable and testable.

```
SceneDocument ─┐
               ├─▶ 1. Resolve      variables + bindings → concrete values
Variables ─────┘                   (no I/O; data is already fetched)
                     │
                     ▼
               2. Layout           text measurement, box sizing, fit
                     │             → cached, invalidated per node
                     ▼
               3. Animate(t)       evaluate tracks at time t
                     │             → transforms, opacity, property overrides
                     ▼
               4. Compose          flatten tree → ordered display list,
                     │             deciding which subtrees need offscreen
                     ▼             buffers (§7)
               5. Rasterize        backend draws the display list
                                   (Canvas2D today, WebGL2 later)
```

Only phase 5 is backend-specific. Phases 1–4 are shared by the editor preview,
the render surface, and any future cloud renderer — which is what makes
"the editor shows what goes on air" a structural guarantee rather than a
discipline.

**Frames are produced from an explicit clock**, not `Date.now()`. The render
surface drives it from `requestAnimationFrame`; the editor drives it from a
scrub position; a cloud renderer drives it from a frame counter. Same code.

## 7. Layer composition

There is no separate "layer" concept in the renderer. **The node tree is the
layer stack**, and z-order is document order — first child painted first. A
separate `zIndex` property would create two sources of truth for the same
question, which is a bug generator.

Most nodes draw directly into the parent's surface. A subtree is promoted to an
**offscreen buffer** only when it cannot be drawn correctly inline:

| Promotes | Why |
|---|---|
| Group opacity < 1 | Per-node opacity would double-darken overlaps |
| Non-normal blend mode | Blend must apply to the composited group |
| Mask or clip | Needs the group rasterized before masking |
| Effect (future) | Operates on pixels |

Promotion is decided in phase 4 and is the single largest performance lever.
Every buffer is an allocation plus a composite, so the rule is: promote only
when correctness requires it, never for convenience.

## 8. Determinism

Requirements, testable in Phase 3:

1. Rendering the same `(document, time)` twice produces identical pixels.
2. Rendering time `t` directly and arriving at `t` by playing forward produce
   identical output. No state accumulates across frames.
3. No dependence on wall-clock time, frame ordering, or random sources
   anywhere in phases 1–4.

Requirement 2 is the strict one. It rules out physics, decay, and
"animate toward" behaviours in the animation engine, which
[RFC-002](./RFC-002-scene-document-model.md) and Phase 5 must respect.

## 9. Backend seam

The rasterizer is defined by a narrow, imperative interface — draw a quad, draw
a text run, push/pop a transform and clip, begin/end an offscreen buffer. It
receives a resolved display list and knows nothing about scenes, nodes,
animation, or variables.

Deliberately **one implementation, one consumer, for now.** An abstraction
designed over two backends before either exists is usually wrong; this one is
sized to the display list that Canvas2D actually needs, and will be revised —
not merely implemented against — when WebGL2 arrives. That revision is expected
and is not a design failure.

## 10. When to add WebGL2

Add it when a shipped requirement needs one of: blend modes outside the
Canvas2D set, blur/glow/shader effects, video textures, per-pixel masks, or
particle counts Canvas2D cannot sustain.

**Do not add it for speed alone** without a profile showing rasterization —
not layout, not text measurement, not JavaScript — is the bottleneck. In dense
2D UI, it usually is not.

## 11. Performance budget

The bar Phase 3 must clear, from
[ROADMAP.md Phase 3](./ROADMAP.md#phase-3--rendering-engine):

| Metric | Target |
|---|---|
| Frame budget @ 60fps | 16.6ms; **< 8ms** for the full pipeline, leaving headroom for the encoder |
| Dropped frames, 60-minute run @ 1080p60 | **Zero** |
| Memory growth over 60 minutes | Flat |
| Time to first painted frame | < 500ms after fonts resolve |

Measured on mid-range hardware with OBS encoding concurrently — not on a
development machine, where every one of these passes trivially.

## 12. What this RFC does not decide

- The scene document format — [SCENE_FORMAT.md](./SCENE_FORMAT.md).
- How edits are represented — [RFC-002](./RFC-002-scene-document-model.md).
- Animation semantics beyond the determinism constraint in §8 — Phase 5.
- Compositing *between* scenes on air (which scene occupies which output
  layer). That is show state, not scene state — Phase 6.

## 13. Open items

| # | Item | Owner | Due |
|---|---|---|---|
| R1 | Probe `navigator.gpu` across the OBS versions in real use; attach results | Engineering | Phase 3 wk 1 |
| R2 | Confirm Canvas2D `letterSpacing` / `fontKerning` support in the target CEF; they are newer than the base API | Engineering | Phase 3 wk 1 |
| R3 | Decide the fallback-font chain and whether operators may supply one | Product | Phase 3 |
| R4 | Establish the frame-drop harness before building the renderer, not after | Engineering | Phase 3 wk 1 |
