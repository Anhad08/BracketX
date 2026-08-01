# Implementation Report — Phase 2.6: First Rendered Frame

**Date:** 2026-08-01
**Status:** Complete. The engine renders its own scene format to real pixels.
**Companion:** `VERTICAL_SLICE_VERIFICATION.md` — evidence and limits.

---

## 1. What this phase proves

```
SceneDocument  →  Runtime  →  Reconciler  →  MirrorBackend  →  Three.js  →  Pixels
   (authored)     (clock,     (projection,    (frozen         (GPU        (WebGL2,
                  variables)   mirror)         boundary)       driver)     verified)
```

Every stage was already built and verified in isolation. Phase 2.6 connected
them and confirmed the result with a framebuffer read, not an inference.

The proof object is a lower third authored in SCENE_FORMAT v2. It validates,
serializes, and round-trips byte-identically, so it is a document rather than a
renderer fixture. Nothing on screen is CSS, an image, or placeholder geometry.

---

## 2. What was built

| Piece | Package | Responsibility |
| --- | --- | --- |
| `rect` → mesh projection | `engine-reconciler` | Turns a scene component into geometry and a material |
| `primitives.ts` | `engine-reconciler` | Quad geometry, sRGB→linear colour |
| `SceneHost` | **`engine-host`** (new) | Load, apply, set variables, render a frame |
| `FrameLoop` | `engine-host` | When to render, with an injectable scheduler |
| `makeDemoScene` | `engine-host` | The proof document |
| `createCanvasBackend` | `engine-render-three` | Canvas → `MirrorBackend`, no Three type crossing |
| `SceneViewport` | `apps/web` | Canvas, lifecycle, teardown |
| `/render-check` | `apps/web` | The verification surface |

### The new layer

`@bracketx/engine-host` is the composition root. Something has to own the
sentence *"advance time, project what changed, then draw"*, and putting it
inside any existing subsystem would have stopped that subsystem being
replaceable — the runtime would have learned about rendering, or the reconciler
about frames.

It depends on the scene graph, the runtime, and the reconciler, and on **no
backend**. It takes a `MirrorBackend`, which is why a WebGPU swap would not
touch it. Registered in `tools/engine-layers.mjs` and enforced by the boundary
checker like every other layer.

`FrameLoop` is separate from `SceneHost` because *when* to render and *how* to
render have different testability. A `requestAnimationFrame` loop cannot run in
a test; an injected-scheduler loop can, and the host is identical either way.

---

## 3. Decisions worth defending

### `rect` first, not `meshRenderer`

A rect needs no external asset, so a scene that draws one is a scene the engine
draws **entirely from its own format**. `meshRenderer` would have required the
glTF asset pipeline, which belongs to a later phase, and the milestone would
then have proven "the engine can render a file someone else authored" rather
than "the engine can render its own document".

A lower third is also the actual shape of the product's first real output.

### Dimensions baked into the geometry, not applied as a mesh scale

The natural implementation is a unit quad plus a scale. That would have needed
a new `MirrorBackend` method, and the boundary is frozen under ADR-013.
Extending a frozen interface for author convenience is exactly what the freeze
exists to prevent.

Baking costs nothing here: the resource manager is content-addressed, so rects
sharing a size share a geometry, and a node that wants to scale already has a
transform.

### Quad geometry and colour parsing live in the reconciler

They are properties of the **scene format**, not of any renderer. A rect is two
triangles in every backend. If a backend built it, every future backend would
have to independently agree on winding order and UV origin, and a disagreement
would surface as a flipped texture or a culled graphic rather than as a type
error.

### The clock starts stopped

`load()` does not start it. A loaded graphic is *cued*, not on air. Auto-playing
would mean a scene begins animating the moment an operator opens it in the
editor. `play`/`pause`/`stop` are explicit transport actions.

### Reading the framebuffer, not taking a screenshot

A screenshot is composited against the page background, which would silently
make every transparent pixel opaque — the single property most worth testing
for broadcast output. The tests call `gl.readPixels` on the live drawing buffer.

---

## 4. Two contract violations caught, not shipped

Both were mine, and both were caught by tooling that already existed. That is
the return on the earlier phases.

### Releasing resource handles immediately after attaching

`#applyRect` created geometry and material, attached them, then destroyed the
creator's references. That works against `ThreeMirrorBackend`, whose reference
counting is more permissive than the contract requires — `attachMesh` takes its
own reference, so the count never reached zero.

`MockMirrorBackend` rejected it outright: **C2 puts lifetime on the caller.**
The backend frees on `destroy*`, not when an attachment goes away. The projector
now holds the handles and frees them exactly once, when it stops needing them.

This is precisely what the mock/conformance pair from Phase 2.5 exists for — a
permissive implementation hiding a caller bug is the failure mode a second
implementation catches.

### Calling `backend.setSize` from the host

There is no such method, deliberately. The surface being drawn into belongs to
whoever created it, and a backend owning canvas sizing could not render into a
texture or an offscreen target. Size travels per frame as
`RenderOptions.viewport`.

Both were compile-time or test-time failures. Neither reached a commit.

---

## 5. The bug only real pixels could find

`MirrorBackend` C9 requires **linear** RGBA. Hex colours are sRGB — that is what
a colour picker produces and what an operator pastes in. `rgbaFromHex` divided
by 255 and handed the result over as linear.

Three's renderer then converted linear→sRGB for display, encoding the value a
second time:

| Authored | Rendered (before) | Rendered (after) |
| --- | --- | --- |
| `#0B1F3A` | `#3B6283` | `#0B1F3A` |
| `#E8B23A` | `#F5DA83` | `#E8B23A` |

The graphic appeared, in roughly the right place, in roughly the right hue. It
just looked washed out. **No headless test could have caught this**, because the
error only exists once a real renderer converts back to sRGB — up to GL
submission every value was internally consistent.

Fixed with a proper sRGB→linear transfer function. Colours now round-trip
byte-identically, and the browser tests assert **exact hex rather than ranges**
specifically so a tolerance can never hide this class of bug again.

### Left open, deliberately

The Three adapter takes colour and opacity as separate material inputs and
premultiplies in the shader. Premultiplying in `rgbaFromHex`, as C9 read
literally would require, would darken every translucent surface twice. Every
colour in play today is opaque, so there is no visible consequence and no way to
test the correct behaviour yet. Recorded in `primitives.ts` and in the
verification document; it needs settling when the first translucent material
ships. Guessing now would bake in an untestable choice.

---

## 6. Results

```
pnpm turbo run check-types lint test build   27/27 successful
node tools/check-boundaries.mjs              exit 0
npx vitest run tools/boundaries.test.ts      42 passed
pnpm --filter @bracketx/engine-host test     27 passed
cd apps/web && npx playwright test            9 passed
```

The nine browser tests are the new evidence. Everything else is regression
protection for what the earlier phases established.

---

## 7. Assessment

The vertical slice worked on the first connected attempt in structure, and
failed on colour. That split is worth noting: hierarchy, projection, resource
lifetime, camera derivation, variable resolution, and frame scheduling all
composed correctly the first time, because each had been verified against a
contract rather than against the next stage's assumptions. The one thing that
broke was the one thing no contract could pin down without a real renderer at
the other end.

BracketX is now an engine that renders its own scene format. Every subsequent
feature — animation, text, the editor, AI, broadcast tooling — builds on a
verified path rather than on theoretical plumbing.

What it is **not** yet: a renderer of anything beyond coloured rectangles.
`text`, `image`, `meshRenderer`, and `light` components still project to
nothing. That is the honest boundary of this milestone, and §5 of the
verification document lists it precisely.
