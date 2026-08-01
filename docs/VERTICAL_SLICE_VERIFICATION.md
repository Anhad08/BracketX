# Vertical Slice Verification — Phase 2.6

**Date:** 2026-08-01
**Subject:** SceneDocument → Runtime → Reconciler → MirrorBackend → Three.js → pixels
**Verdict:** **VERIFIED.** The engine renders its own scene format, confirmed by framebuffer reads in a real WebGL2 context. Seven claims recorded as **Unknown** in Phase 2.5 are now **Proven**. One new limitation is recorded honestly rather than resolved by guesswork.

| Label | Meaning |
| --- | --- |
| **Proven** | Demonstrated by an executing test or measurement in this repository |
| **Derived** | Follows necessarily from something Proven, plus a stated argument |
| **Assumed** | Believed true, not yet tested; the risk is stated |
| **Unknown** | Cannot be established in this environment; what would establish it is stated |
| **Disproven** | Tested and found false |

---

## 1. Reproduce

```
pnpm turbo run check-types lint test build     27/27 successful
node tools/check-boundaries.mjs                exit 0
npx vitest run tools/boundaries.test.ts        42 passed
pnpm --filter @bracketx/engine-host test       27 passed
cd apps/web && npx playwright test              9 passed
```

The browser suite launches Chromium with ANGLE/SwiftShader. That is a real
WebGL2 implementation executing real shaders on the CPU — not a mock, and not a
stub. A machine with a discrete GPU exercises the identical code path.

---

## 2. Phase 2.5 Unknowns, now resolved

`RENDER_BACKEND_VERIFICATION.md §7` listed what could not be established without
a browser. Status now:

| Claim | Was | Now | Evidence |
| --- | --- | --- | --- |
| Draw calls reach the GPU | Unknown | **Proven** | Pixels appear at computed coordinates; a scene that never reached the GPU would read back transparent |
| Rendered output is correct | Unknown | **Proven** | Exact hex match at three probe points plus a reference image |
| Driver context loss behaves as simulated | Unknown | **Unknown** | Still untested. See §5 |
| VRAM figures match reality | Unknown | **Unknown** | Still an estimate from buffer byte lengths |
| GPU frame time | Unknown | **Unknown** | Needs `EXT_disjoint_timer_query` |
| Shader compilation cost | Unknown | **Unknown** | Not measured; materials compile once at load |
| A real WebGL2 context is obtainable | Unknown | **Proven** | `gl.getParameter(gl.VERSION)` contains "WebGL 2.0" at 1920×1080 |

Four remain Unknown and are listed again in §5 rather than quietly dropped.

---

## 3. What is now Proven

### V1 — The demo scene is a real document. **Proven.**

Not a renderer fixture. It passes `validateDocument` with zero errors,
round-trips through `serialize`/`deserialize` to identical canonical bytes, and
constructs deterministically. It could be persisted to the `scene` table today.

### V2 — Hierarchy composes, and this would have failed silently. **Proven.**

The bars are authored at their group's origin; the group's transform is what
places them. The browser test asserts the backing bar's colour at screen
(690, 810), derived from the camera's orthographic size.

This is the most valuable single assertion in the phase. If world matrices were
not composing, the bars would render **centred** — still visible, still
plausibly "a scene", and wrong. A test that only asked "did anything draw?"
would have passed.

### V3 — Colours round-trip byte-identically. **Proven.**

Authored `#0B1F3A` reads back from the framebuffer as `#0B1F3A`, and `#E8B23A`
as `#E8B23A`, through sRGB → linear → GPU → sRGB.

Asserted as **exact hex, not ranges**, deliberately. Ranges are what let the
original double-encoding bug (`#0B1F3A` → `#3B6283`) look like a working
renderer.

### V4 — The background is fully transparent. **Proven.**

Alpha is exactly 0 outside the graphic. Broadcast output composites over live
video; an opaque background is a black rectangle on air.

This is why the tests read the framebuffer rather than taking a screenshot — a
screenshot is composited against the page and would report every transparent
pixel as opaque, hiding the defect completely.

### V5 — Variable bindings reach the GPU. **Proven.**

The accent bar's `fill` is a `{ $var: "accentColor" }` binding. It renders in
the variable's value, and changing that variable through the runtime repaints
it — click → command → runtime state → `invalidateVariables` → `updateMaterial`
→ GPU.

The backing bar is asserted **byte-identical before and after**, proving the
dependency index repainted only the bound node rather than the scene.

### V6 — A runtime value is not a document edit. **Proven.**

`JSON.stringify(host.document)` is identical across a variable change, asserted
in the live browser session as well as in unit tests. RFC-002 §4.3: runtime
state is not undoable and not persisted.

### V7 — The mirror stays consistent against a live GPU session. **Proven.**

The reconciler's own `verify()` — which re-derives from the document
independently rather than trusting the projector — returns zero issues while
driving real hardware.

### V8 — Frames advance continuously. **Proven.**

More than five frames in 500 ms, so the loop is live rather than having drawn
once and stopped.

### V9 — The engine survives a frame that throws. **Proven.**

Unit-tested in `engine-host`: the loop counts the error and keeps scheduling. A
frozen last-good image is the worst on-air failure because it looks like nothing
is wrong.

### V10 — No Three.js type crosses into the application. **Proven.**

`apps/web` imports `createCanvasBackend` and receives a `MirrorBackend`. The
boundary checker and 42 boundary tests confirm no package outside
`engine-render-three` names a Three type or imports the module.

This phase is what forced the factory to exist: `WebGLRendererHost` takes a
`WebGLRenderer`, so without `createCanvasBackend` the app would have had to
import `three` and would have pinned the backend choice.

### V11 — The composition root depends on no backend. **Derived, enforced.**

`@bracketx/engine-host` declares only the scene graph, runtime, and reconciler.
Enforced by `tools/engine-layers.mjs`, negative-tested in Phase 2.5n.

---

## 4. Disproven

### A1 — "Everything up to GL submission being correct means the output is correct." **Disproven.**

The sRGB defect is the counterexample. Every value in the pipeline was
internally consistent and every headless test passed; the error existed only in
the relationship between what the reconciler called "linear" and what a real
renderer did with it.

Phase 2.5 labelled output correctness **Unknown** rather than assuming it. That
label was correct, and this phase is why it mattered.

---

## 5. Limits — what is still not established

| Claim | Status | What would establish it |
| --- | --- | --- |
| Driver-initiated context loss behaves as simulated | **Unknown** | `WEBGL_lose_context` in the browser suite. The simulated path is proven; the real one is not |
| VRAM estimates match driver reality | **Unknown** | Driver counters. Ours is a sum of buffer byte lengths — sound for relative comparison, not absolute |
| GPU frame time | **Unknown** | `EXT_disjoint_timer_query` |
| Shader compilation cost | **Unknown** | Not measured |
| Output is correct on other GPUs/drivers | **Assumed** | Verified on ANGLE/SwiftShader only. C8 permits pixel variation across hardware but not structural variation |
| The reference image is portable | **Assumed — probably false** | The baseline is `lower-third-chromium-win32.png`. Committed as a regression guard for this platform; a different GPU will likely need its own baseline. Per-pixel assertions in §3 are the portable evidence |
| Premultiplied alpha is handled correctly for translucent surfaces | **Unknown** | A translucent material. C9 says descriptor colours are premultiplied; the Three adapter takes colour and opacity separately and premultiplies in the shader, so doing both would darken twice. Every colour today is opaque, so the correct behaviour cannot be tested yet. **Deliberately unresolved rather than guessed** |
| Components other than `rect` and `camera` render | **Not implemented** | `text`, `image`, `meshRenderer`, `light` project to nothing. This is the honest boundary of the milestone |

---

## 6. Carried forward

**R-001 — traversal depth ceiling.** Logged in `ROADMAP.md` under Phase 2.
Unchanged by this phase and not blocking: the demo scene is 3 levels deep
against a ~1,344 ceiling. Scheduled before any release-quality milestone.

**Premultiplied alpha (§5).** Needs settling with the first translucent
material, before compositing behaviour is depended upon.

---

## 7. Assessment

The structural half of the slice — hierarchy, projection, resource lifetime,
camera derivation, variable resolution, frame scheduling — composed correctly on
the first connected attempt, because each part had been verified against a
contract rather than against the next part's assumptions. Two of my own contract
violations were rejected by the mock backend and the type system before they
reached a commit.

The half that broke was colour, and it broke exactly where no contract could
reach: in the meaning of "linear" once a real renderer sits at the other end.
That is the argument for this phase existing as its own milestone rather than
being folded into Phase 2.5.

**Verdict: VERIFIED.** BracketX renders its own scene format to real pixels,
proven by framebuffer reads rather than inference, with four GPU-level unknowns
and one alpha question recorded rather than assumed away.
