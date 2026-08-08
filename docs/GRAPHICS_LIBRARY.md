# The Graphics Library — overlays, 3D overlays, virtual sets, Adaptive Graphics

**Status:** in progress · **Started:** 2026-08-08 · **Brief:** build a broadcast
overlay library in the class of overlays.uno but designed to a higher standard,
pre-animated, deeply customisable; then 3D overlays; then virtual sets in the
class of 3dvirtualset.com; plus Adaptive Graphics™ with Transition Logic.

This document is the plan and the running queue. It is also the honest record of
what the brief assumes exists and does not.

---

## 1. Why the first thing built was not an overlay

The brief's centre of gravity is the word **attractive**. overlays.uno's library
is called "very very basic" and the job is to beat it. So the question that had
to be answered first was: *what can this engine actually draw?*

The answer, before this milestone:

| Wanted | Had |
| --- | --- |
| Gradient fills | **No.** `rect.props.fill` was a single flat hex |
| Rounded corners | **No.** `cornerRadius` was declared in SCENE_FORMAT and implemented by nothing — `mesh-primitives.ts` says so in its own comment |
| Strokes / borders | **No** |
| Drop shadows | **No** |
| Glows | **No** — explicitly refused, twice, with the animation presets |
| Inner shadows / glass | **No** |

A library built on that is a library of flat rectangles, which is precisely the
thing the brief is complaining about. **Every overlay in the plan below is
gated on this**, so it was built first.

## 2. What was built: the paint model

`packages/engine-reconciler/src/paint.ts` — gradients (linear, radial, conic),
rounded corners including per-corner radii, strokes with their own gradients,
soft drop shadows, glows, and inner shadows.

**The design decision that made it affordable.** Corner radii, strokes and
shadows are a *signed-distance* problem, which is why they were refused three
times as "a real piece of renderer work with a material-kind consequence". That
is true of a shader implementation. It is not true of a **rasterised texture**:

- no new `MaterialDescriptor` kind — `unlit` already carries a `map`
- no new `MirrorBackend` method — `createTexture` already takes raw pixels
- **no ADR-013 amendment**, because the frozen boundary is untouched
- no SCENE_FORMAT version bump — `paint` is optional and read defensively
  (§13 rule 4)
- one implementation, so both backends produce identical pixels by construction

**What it costs.** A paint that changes once costs one CPU raster. A paint that
changes *every frame* re-rasterises every frame. Identical paints are
content-addressed and share one texture, so this only bites a genuinely
animating gradient — and the library animates a sweep as a gradient quad that
*moves*, which is how the shine on a real broadcast bug is done anyway.

**Two defects found by looking at the output, not by testing it.**

1. Blending a stroke over a fill produced fractional sRGB channels, and
   `SRGB_TO_LINEAR[2.7]` is `undefined` → NaN → zero. The symptom was **rainbow
   speckle** along every stroke. Now centralised in `linearOf`.
2. An 8-bit *linear* texture has very few codes in the darks, which is exactly
   where broadcast furniture lives. A near-black gradient banded, and because
   each channel bands in a different place the bands were **coloured**. Fixed
   with deterministic triangular dither — deterministic because this engine's
   determinism tests require the same document to produce the same bytes.

Neither was findable by a test that only asserts calls. 33 tests now assert
**pixels**: gradient direction, corner coverage, stroke staying inside the
edge, shadow bleed not clipping, Y-up shadow offsets, and the premultiplied
invariant across every texel.

**Verified:** reconciler 114 · three 95 · babylon 14 · host 225 · workspace
typecheck 15/15 · lint clean.

---

## 3. What the brief assumes that does not exist

Two of these need a decision, not more work.

### 3.1 Virtual sets need glTF and image-based lighting — REFUSED in IF-006

3dvirtualset.com sells photoreal sets: modelled desks, video walls, real
lighting, HDRI reflections. This engine can build a *set* today — it has
primitives, lights, shadows, a camera with real lenses, and a soft-gradient
environment map. It cannot load a **model** or an **HDRI**, both refused in
[IF-006](./IMPLEMENTATION_FINDING_IF-006.md) §5.

So a virtual set built now is architectural: planes, boxes, cylinders, lit and
shadowed, with screens that take a feed. That is genuinely usable for a news
desk, an esports stage or a talk-show set, and it is **not** photoreal, and it
will not be mistaken for the reference.

**Decision needed:** fund the glTF + HDRI subsystem (the honest route to the
reference), or accept architectural sets built from primitives for now. Building
the primitive version first is not wasted either way — the set dressing, camera
positions, screen feeds and lighting rigs are the same work.

### 3.2 Icons need SVG — REFUSED in IF-006 §3

Every overlay library leans on icons: a live dot, a mic, a play triangle, social
marks, sport glyphs. PNG rasters work but do not scale on a camera push and
cannot be recoloured to a brand. Circles, triangles and bars are already
reachable as geometry, so tranche 1 uses those and no overlay ships an icon it
cannot draw.

### 3.3 "Take assets from Framer"

Framer's assets are not licensed for redistribution inside a product we sell.
Design *reference* is fine and is being used. Shipping their files is not, and a
marketplace is exactly where that becomes a legal problem rather than a private
one. Nothing here copies an asset.

---

## 4. Adaptive Graphics™ with Transition Logic — what already holds it up

This is the least-missing of the four deliverables, which is worth knowing
before it is scheduled.

Already real: `NodeAnchor` with `stretch` on both axes and safe-area support;
one-pass deterministic `layout`; a scene rendering to **two outputs of different
resolutions simultaneously from one document** (Phase 3 exit criterion); a
`transition` module; and templates that instantiate at a resolution.

Missing, and the actual work: **aspect** is not resolution. 1920×1080 → 3840×2160
is a scale and already correct. 16:9 → 9:16 is a *re-composition* — a lower third
that spans the frame horizontally becomes a stacked card, and no anchor
expresses that. So Adaptive Graphics is:

1. **Aspect variants** on a document: one graphic, per-aspect overrides, not
   separate documents that drift apart.
2. **Automatic derivation** so an author who never opens the vertical variant
   still gets a correct one.
3. **Transition Logic** — when the destination changes mid-show, the graphic
   animates between variants rather than cutting.

The delivery-format strip removed in `8fcb9f8` was cut for the right reason
(1080p/2160p/720p are all 16:9, so three tiles rendered the same picture). Aspect
variants are the thing that row should have been.

---

## 5. The queue

| # | Item | State |
| --- | --- | --- |
| 1 | Audit: what the engine can draw vs. what the brief needs | ✅ |
| 2 | This plan, and the refusals above stated | ✅ |
| 3 | Paint model — gradients, corners, strokes, shadows, glows | ✅ |
| 4 | Paint through the reconciler and both backends, pixel-tested | ✅ |
| 5 | Shape masking, for reveal animations that wipe rather than fade | ⏳ |
| 6 | Overlay tranche 1 — lower thirds, name bars, tickers, labels | ⏳ |
| 7 | Overlay tranche 2 — scoreboards, timers, alerts, now-playing, polls, social | ⏳ |
| 8 | Overlay tranche 3 — full-frame screens, schedules, sponsor loops | ⏳ |
| 9 | Customisation surface — fonts, colours, gradients, corners, strokes, shadows, per template | ⏳ |
| 10 | 3D overlays — depth, lit solids, spin and orbit reveals | ⏳ |
| 11 | Virtual sets — dressing, camera positions, screens that take a feed | ⏳ blocked on §3.1 decision for photoreal |
| 12 | Adaptive Graphics with Transition Logic | ⏳ |

Item 5 is next because a reveal that *wipes* is the difference between a graphic
that looks animated and one that looks like it faded in — and masking is the one
remaining primitive the animated library needs that the paint model did not
bring.
