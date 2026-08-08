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

### 3.1 Virtual sets — **CUT, 2026-08-08**

Cut by the founder: *"rule out virtual sets rn we are not giving chroma."*

The reasoning holds independently of the decision, and is worth recording so the
question is not reopened by accident. A virtual set only earns its cost when
there is a **key** to composite the talent into it. Without chroma there is no
key, so a set is a background nobody can stand in — which is a full-frame
graphic, and the library already covers those in tranche 3.

The glTF + HDRI question this section previously raised is therefore **moot for
now**, not deferred-with-a-plan. It becomes live again only if chroma keying is
ever funded, and at that point the blocker is unchanged: photoreal sets need
model loading and image-based lighting, both refused in
[IF-006](./IMPLEMENTATION_FINDING_IF-006.md) §5.

Nothing was built against this, so nothing is wasted.

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
| 5 | Gizmo snapping — grid, object, angle, size, in every gesture | ✅ — §6 |
| 6 | Shape masking, for reveal animations that wipe rather than fade | ⏳ |
| 7 | Overlay tranche 1 — lower thirds, name bars, tickers, labels | ⏳ |
| 8 | Overlay tranche 2 — scoreboards, timers, alerts, now-playing, polls, social | ⏳ |
| 9 | Overlay tranche 3 — full-frame screens, schedules, sponsor loops | ⏳ |
| 10 | Customisation surface — fonts, colours, gradients, corners, strokes, shadows, per template | ⏳ |
| 11 | 3D overlays — depth, lit solids, spin and orbit reveals | ⏳ |
| — | ~~Virtual sets~~ | ❌ cut — §3.1 |
| 12 | Adaptive Graphics with Transition Logic | ⏳ |

---

## 6. Gizmo snapping

**Brief:** *"gizmoz should be very inteactive and easy to use with snaping angle
snapping size snapping grid snapping object snapping."*

### 6.1 What was actually wrong

Not that snapping was bad. That it existed **once** and was missing **four
times**:

| Gesture | Before |
| --- | --- |
| 2D move | grid + object edges ✅ |
| 2D resize | nothing ❌ |
| 2D rotate | 15°, and only while Shift was held ⚠️ |
| 3D axis move | nothing ❌ |
| 3D ring rotate | 15°, and only while Shift was held ⚠️ |
| 3D stretch | nothing ❌ |

That pattern appears because each gesture was wired separately, so each one had
to *remember* to snap. A gesture that forgets is not a bug anybody files — it
just feels slightly worse than the others, which is how an editor comes to feel
unfinished without a single reproducible fault.

`snapping.ts` is now one module every gesture asks, so adding a gesture means
calling it rather than reimplementing it.

### 6.2 What it snaps to

- **Grid** — in 2D and now along all three axes in 3D. Only when the grid is
  within reach, so a coarse grid is not a magnet the object cannot escape.
- **Objects** — edges, centres, and **equal gaps**: the positions where the box
  sits an equal distance between two neighbours, or continues an existing rhythm
  past the end of a run. Alignment makes a row straight; equal spacing is what
  makes it look designed.
- **Safe areas** — title-safe and action-safe. *This was the most useful snap in
  broadcast and it was missing entirely.* The margins were drawn on screen and
  nothing landed on them, which is a ruler with no notches.
- **Angle** — 15° by default, with **the cardinals pulling twice as hard**. A
  graphic 1° off square is not at a jaunty angle, it is a mistake; so square is
  the easy thing to hit and 15°-off-square is the deliberate one.
- **Size** — matching another object's width or height, plus grid multiples and
  the standard broadcast aspect ratios on a corner drag. Matching *width* is
  what makes a stack of lower thirds read as one set, and aligning edges cannot
  do it.
- **Scale**, in 3D — the multiples a person says out loud (half, same, double)
  and 10% steps between. Nobody wants 1.9873×; they wanted double.

### 6.3 Two decisions worth naming

**Snapping is on by default, and Alt suspends it.** Rotation used to need Shift,
which meant the default gesture produced angles like 7.3°. Shift still *forces*
snapping so the existing shortcut documentation stays true; Alt is the escape
hatch, and it is what makes on-by-default acceptable.

**Every snap says why.** The guide carries its reason, labels itself (`Edge`,
`Centre`, `Title safe`, `Equal gap`, `Same size`) and is coloured by kind, and
size/angle detents show a readout (`2.00×`, `90°`) because those have no line to
draw. A designer who sees a value jump and cannot tell whether it hit the grid,
an object edge or a margin does not trust it — and turns snapping off.

### 6.4 Three bugs the tests found

1. **A `<line>` guide has a zero-width bounding box**, so Playwright reports it
   as not visible. The first browser tests used `isVisible()`: it failed the move
   test on a guide that was really there, and made the Alt test a **false pass**,
   since "no guide" was indistinguishable from "a guide Playwright would not
   admit to seeing". Now asserted by attachment.
2. **The flat rotate handle snapped silently** — the angle detent was wired but
   its readout was not. Found by the browser test, not by reading the code.
3. **The "moving" test was really resizing.** Dragging from the gizmo's bounding
   box centre presses a resize handle, because the box includes the rotation
   grip above the shape. It passed anyway, asserting feedback a resize also
   produces. Both move tests now assert `data-drag` so neither can drift again.

**Verified:** 44 unit tests · 6 browser tests · the 18 existing gesture browser
tests still pass · studio unit suite 461 · typecheck and lint clean.
