# Implementation Report — Phase 2.5: Three.js Render Backend

**Date:** 2026-08-01
**Package:** `@bracketx/engine-render-three`
**Status:** Complete. 94 tests, benchmarks recorded, boundaries enforced.
**Companion:** `RENDER_BACKEND_VERIFICATION.md` — evidence and limits.

---

## 1. What was built

BracketX's first production rendering backend, implementing the `MirrorBackend`
contract frozen in Phase 2.4. Three.js r185 is confined to this package and
appears in no signature the engine can see.

| Module | Responsibility |
| --- | --- |
| `renderer-host.ts` | The seam. `RendererHost` abstracts GL submission; headless and WebGL implementations |
| `resources.ts` | Content-addressed GPU pools, reference counting, budget enforcement |
| `translate.ts` | Descriptor → Three object translation; geometry, material, texture, camera |
| `three-backend.ts` | `ThreeMirrorBackend` — the mirror graph, transforms, submission, diagnostics |
| `index.ts` | Public surface. No Three type crosses it |

Section coverage: 2.5a bootstrap, 2.5b mirror objects, 2.5c resources, 2.5d
transform sync, 2.5e materials, 2.5f geometry, 2.5g cameras, 2.5h submission,
2.5i diagnostics, 2.5j failure recovery, 2.5k property testing, 2.5l
benchmarks, 2.5m stress, 2.5n isolation, 2.5o context recovery.

---

## 2. The decision that shaped the phase

**`WebGLRenderer` is the only part of Three.js that requires a `document`.**

Established by probing before writing anything: scene graph, geometry,
materials, and cameras all construct and behave headlessly on r185. Only actual
GL submission needs a browser.

That single fact determined the architecture of the package. The renderer sits
behind an injectable `RendererHost`, so everything except GL submission is
testable without a GPU — which is why 94 tests exist for a rendering backend in
a headless CI environment. It also draws a sharp line around what *cannot* be
verified here, catalogued in `RENDER_BACKEND_VERIFICATION.md §7`.

The alternative — testing through a browser harness — would have made the fast
suite slow and flaky, and would have tested Three.js as much as BracketX.

---

## 3. Design decisions worth defending

### A node is a transform; a mesh is an attachment child

The first implementation gave each node an `Object3D` and retagged it as a
`Mesh` when geometry was attached. TypeScript rejected it: `Object3D.type` is
readonly.

The choice was a cast or a remodel. The type error was correct — `SCENE_FORMAT
§6/§7` already says a node carries components rather than *being* one. Nodes now
hold an `Object3D` and attach a child `Mesh`.

Three consequences, all improvements:

- Handles stay stable across attachment changes. Swapping the object would drop
  the handle and its place in the hierarchy.
- Transforms survive an attach/detach cycle, because the transform lives on the
  node and not on the attachment.
- `snapshot()` lost an O(n²) lookup. Child nodes had been derived from
  `object.children`, which also contains the attachment mesh. `childHandles` is
  now tracked explicitly.

A cast would have preserved a wrong model *and* hidden the quadratic.

### Explicit transform synchronisation

`matrixAutoUpdate` and `matrixWorldAutoUpdate` are disabled everywhere.

Phase 2.5d required this to be evidence-backed rather than asserted. Measured on
the same workload — correct world matrices for a 10,000-node scene:

| Nodes moved per frame | Enabled | Disabled | Ratio |
| --- | --- | --- | --- |
| 100 of 10,000 | 0.4930 ms | 0.0010 ms | **498×** |
| 10,000 of 10,000 | 0.5345 ms | 0.1317 ms | **4.1×** |

The second row is the case most favourable to Three, included deliberately so
the decision is not defended only by its best case. Still 4× slower.

The determinism argument stands on its own regardless: the engine has already
computed the world matrix. Letting Three recompute it from local TRS creates a
second source of truth for the same value, violating R9. The measurement means
we do not have to trade performance for that guarantee.

### Refuse, never evict

Over budget, resource creation returns a failure rather than freeing something
to make room. `ENGINE_RUNTIME §4.4` inverts the normal engine instinct: blanking
an on-air graphic is worse than failing to bring up a new one. A cache hit is
still served when the budget is full, since refusing a free allocation would
take a graphic off air for nothing.

### Conformance testing over inspection

The backend and the mock are asserted to produce byte-identical snapshots for
the same document. "Three.js is replaceable" stops being a design intention and
becomes an executable property — and a future WebGPU backend gets a suite to
pass rather than an argument to win.

---

## 4. Defect found: quadratic teardown

Found by benchmark. Every correctness test passed throughout — the third time in
this project that structural tests and performance tests have proven to verify
different things (F2 in Phase 2.3, O(scene) projection in Phase 2.4).

The 50k build benchmark cost 3,031 ms against 77 ms at 10k: 5× the nodes, 39×
the time. Profiling put it in `dispose()`, and specifically in Three's
`Scene.clear()`, which is `remove(...this.children)` — spreading 50,000
arguments falls off a V8 fast path.

| Scene children | `Scene.clear()` |
| --- | --- |
| 10,000 | 4 ms |
| 50,000 | 1,828 ms |

Replaced with a direct detach loop. Equivalent, since nothing subscribes to
Three's `removed` event.

| | Before | After |
| --- | --- | --- |
| dispose 10,000 | 100 ms | 1.4 ms |
| dispose 50,000 | 3,159 ms | 2.2 ms |
| dispose 100,000 | — | 3.3 ms |

**~1,400× at 50k, now linear**, guarded by a stress test on the ratio.

Worth recording as a case of the "GPU driver" instruction working: the driver
had a slow path, and the fix went inside the adapter. No interface changed and
no invariant was weakened. Had the fix required exposing Three's internals
upward, the correct response would have been an `IMPLEMENTATION_FINDING.md`.

---

## 5. Results

```
Fast tests        85 passed   (backend, failure, property)
Stress tests       9 passed   (10k / 50k / 100k)
Boundary tests    38 passed   (was 27)
Full repo         23/23 tasks green — types, lint, test, build
```

Measured (CPU, headless, Node 24.15):

| | 1,000 | 10,000 | 50,000 |
| --- | --- | --- | --- |
| Transform sync, 1% changed | 0.4 µs | 3.5 µs | 26.8 µs |
| Render submission | 25.7 µs | 269 µs | 3.51 ms |

Backend construction 3.2 µs; empty frame 5.8 µs; cache hit 5.0 µs vs miss 9.7 µs.

Transform sync is O(changed) with a flat ~0.05 µs per node. Render submission is
O(scene), which is correct — submitting draws is proportional to what is drawn.

**The pipeline is now O(change) end to end.** Reconciler 7 µs at 50k (Phase 2.4)
plus backend 26.8 µs for 1% changed. Neither term scales with scene size.

---

## 6. Boundary enforcement extended (2.5n)

The existing checker proved only that `three` is imported by one package. That
is necessary but not sufficient: a package could name a Three type re-exported
through the adapter without ever mentioning `three`.

`RENDER_BACKEND_TYPES` was added to `tools/engine-layers.mjs` and is checked by
the CI script and the test suite independently, as with every other boundary
rule, so the two cannot drift silently. The adapter's public entry is separately
asserted to expose no Three type.

Negative-tested: a file declaring `{ m: Matrix4 }` in `engine-reconciler` exits
1 naming the file and type; removing it exits 0.

---

## 7. Technical debt

**T1 (carried, unchanged).** `engine-scene` document application is O(scene) —
53 ms at 50k. Now the dominant cost in the pipeline by three orders of
magnitude, since projection is 7 µs and backend sync is 26.8 µs. Not addressed
in this phase because it belongs to `engine-scene`, and Phase 2.5 was authorised
for the render adapter. **It should be scheduled before any phase that claims an
end-to-end frame budget.**

**T2 (new, low).** `WebGLRendererHost` is written but exercised only for
construction. It cannot be tested further without a browser. Phase 2.6 is the
first phase that can, and should.

**T3 (new, low).** VRAM figures are estimates from buffer byte lengths. Sound
for relative comparison and for budget enforcement; not an absolute. Real
figures need driver counters.

---

## 8. Assessment

The architecture survived contact with a real rendering library without bending.
Both moments where it could have — the readonly `type` property and the
quadratic `clear()` — were resolved inside the adapter, and in the first case
the type system was pointing at a genuine modelling error rather than getting in
the way.

The result that matters most is not a benchmark. It is that the reconciler
cannot tell the two backends apart by their output. Every other claim in this
report is about *this* backend; that one is about the architecture, and it is
the claim Phase 2.5 existed to test.

What Phase 2.5 does **not** establish is that anything renders. No pixel has
been produced. The Unknown column in `RENDER_BACKEND_VERIFICATION.md §7` is the
agenda for Phase 2.6, and those claims should be re-verified there rather than
inherited from here.
