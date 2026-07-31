# Render Backend Verification — Phase 2.5

**Subject:** `@bracketx/engine-render-three`, the first production `MirrorBackend`
**Date:** 2026-08-01
**Verdict:** **VERIFIED WITH LIMITS.** Every architectural invariant is proven or derived. Every claim that depends on real GPU hardware is labelled Unknown and listed in §7.

Evidence labels follow the convention used since `ARCHITECTURE_VERIFICATION.md`:

| Label | Meaning |
| --- | --- |
| **Proven** | Demonstrated by an executing test or measurement in this repository |
| **Derived** | Follows necessarily from something Proven, plus a stated argument |
| **Assumed** | Believed true, not yet tested; the risk is stated |
| **Unknown** | Cannot be established in this environment; what would establish it is stated |
| **Disproven** | Tested and found false |

---

## 1. What was verified

94 tests execute against this backend: 85 fast, 9 stress. A further 38 boundary
tests and one CI script check its isolation from outside. The benchmark suite
supplies the measurements quoted throughout.

```
pnpm --filter @bracketx/engine-render-three test          85 passed
pnpm --filter @bracketx/engine-render-three test:stress    9 passed
pnpm --filter @bracketx/engine-render-three bench          (figures in §4)
npx vitest run tools/boundaries.test.ts                   38 passed
node tools/check-boundaries.mjs                           exit 0
pnpm turbo run check-types lint test build                23/23 successful
```

---

## 2. The central claim: Three.js is replaceable

This is the claim the whole phase exists to establish. It is not one property
but four, and the fourth is the one that actually matters.

### V1 — No other package imports `three`. **Proven.**

Enforced by `tools/check-boundaries.mjs` and independently by
`tools/boundaries.test.ts`, both reading `tools/engine-layers.mjs` as the single
source of truth. Negative-tested: a stray import exits 1 naming the file.

### V2 — No other package names a Three.js type. **Proven.**

V1 alone is insufficient. A package could reference a Three type re-exported
through the adapter and never mention `three`, passing an import check while
making the backend un-swappable. Phase 2.5n added `RENDER_BACKEND_TYPES` and
checks it both ways. Negative-tested: a file declaring `{ m: Matrix4 }` in
`engine-reconciler` exits 1 with the file and type named; removing it exits 0.

### V3 — No Three.js type appears in the adapter's public surface. **Proven.**

`packages/engine-render-three/src/index.ts` is asserted to match no Three type
name and no `three` import. The adapter uses Three freely inside; what it may
never do is put a Three type in a signature the engine can see. That distinction
is the difference between a driver and a dependency.

### V4 — The reconciler cannot detect which backend it is driving. **Proven.**

The strongest available form of the claim, and the only one that would survive
someone writing a second backend. `backend.test.ts` builds the same document
through `MockMirrorBackend` and `ThreeMirrorBackend` and asserts the resulting
snapshots are byte-identical:

```
expect(JSON.stringify(three.snapshot().nodes))
  .toBe(JSON.stringify(mock.snapshot().nodes));
```

A conformance suite runs the same lifecycle assertions against both. If a future
WebGPU backend passes this suite, it is substitutable by construction rather
than by inspection.

**Caveat, stated plainly:** V4 proves the two backends agree on *mirror
structure*. It does not prove they would produce identical *pixels* — nothing in
this environment can. See §7.

---

## 3. Architectural invariants

### R9 — one source of truth for every transform. **Proven.**

`matrixAutoUpdate` and `matrixWorldAutoUpdate` are disabled on every object and
on the scene itself. World matrices are written verbatim from the engine, which
has already computed them. Three never derives a transform, so no second
computation exists to disagree with the first.

Two tests pin the consequences:

- A child whose world matrix is never written stays at identity even when its
  parent moves. The backend does not compute — contract clause C3. Under
  auto-update this test would fail, which is what makes it meaningful.
- The attachment mesh is synced explicitly. With traversal disabled, Three would
  never reach it, and the mesh would render at the origin.

### Ownership and lifetime. **Proven.**

- A node is destroyed only as a leaf; destroying a parent with children throws.
- The attachment mesh is not counted as a child. It lives in `object.children`
  alongside child nodes, so deriving the hierarchy from Three's array would
  refuse a legitimate destroy. `childHandles` is tracked explicitly. This also
  removed an O(n²) lookup from `snapshot()`.
- Every pool balances after a full lifecycle; `isBalanced()` is asserted after
  every step of every property-test sequence.
- Use-after-destroy and never-issued handles produce distinct messages. At 3am
  the difference between "this was freed" and "this was never real" is the whole
  diagnosis.

### Refuse, never evict. **Proven.**

`ENGINE_RUNTIME §4.4` inverts normal engine behaviour: taking an on-air graphic
off screen to make room is worse than failing to bring up a new one. Over
budget, `createGeometry` returns `{ ok: false, reason: { kind:
"budget-exceeded" } }`, the existing resource is untouched, and the backend
stays usable. A cache hit is still served when the budget is full — refusing an
allocation that costs nothing would take a graphic off air for no reason.

### Failure is never a partial mutation. **Proven.**

A rejected operation leaves the snapshot byte-identical and the pools balanced.
Tested directly rather than assumed.

---

## 4. Measurements

Windows 11, Node 24.15, single machine, no GPU. Figures are CPU cost.

### Auto-update, enabled vs disabled (2.5d)

The phase required evidence, not an argument from determinism. Both paths do the
same work — produce correct world matrices for a 10,000-node scene:

| Nodes moved per frame | Enabled | Disabled | Ratio |
| --- | --- | --- | --- |
| 100 of 10,000 | 0.4930 ms | 0.0010 ms | **498×** |
| 10,000 of 10,000 | 0.5345 ms | 0.1317 ms | **4.1×** |

Auto-update cannot know that only 100 nodes changed, so it re-traverses the
scene every frame. The second row is deliberately the case most favourable to
Three — every node moving, where explicit sync loses its structural advantage —
and it is still 4× slower. The decision holds on performance and on determinism
independently, which is worth more than either alone.

### Scale

| | 1,000 | 10,000 | 50,000 |
| --- | --- | --- | --- |
| Transform sync, 1% changed | 0.4 µs | 3.5 µs | 26.8 µs |
| Render submission | 25.7 µs | 269 µs | 3.51 ms |

Startup: backend construction 3.2 µs, empty frame 5.8 µs.

Transform sync is O(changed) — the per-changed-node cost is flat at roughly
0.05 µs. Render submission is O(scene), which is correct: submitting draws is
inherently proportional to what is drawn. At 50k meshes it consumes 3.51 ms of a
16.6 ms frame.

**Derived:** the pipeline is O(change) end to end for transform updates. The
reconciler was measured at 7 µs for 50k in Phase 2.4; the backend adds 26.8 µs
for 1% changed. Neither is proportional to scene size.

### Resources

Cache hit 5.0 µs vs cache miss 9.7 µs — content addressing is ~2× cheaper than
allocating, so dedupe pays for itself rather than costing more than it saves.

---

## 5. Defect found and fixed: quadratic teardown

Found by benchmark, not by any correctness test — the same pattern as F2 in
Phase 2.3 and the O(scene) projection in Phase 2.4. Every structural test passed
throughout.

The 50k build benchmark took 3,031 ms where 10k took 77 ms: 5× the nodes for
39× the time. Profiling isolated it to `dispose()`, and from there to Three's
`Scene.clear()`:

| Scene children | `Scene.clear()` |
| --- | --- |
| 10,000 | 4 ms |
| 50,000 | 1,828 ms |

Three implements `clear()` as `remove(...this.children)`. Spreading tens of
thousands of arguments falls off a V8 fast path. This is Three's defect, not the
architecture's.

`#detachSceneChildren()` replaces it — clear each `parent` pointer and truncate
the array. Equivalent, because nothing subscribes to Three's `removed` event.

| | Before | After |
| --- | --- | --- |
| dispose 10,000 | 100 ms | 1.4 ms |
| dispose 50,000 | 3,159 ms | 2.2 ms |
| dispose 100,000 | (not measured) | 3.3 ms |

**~1,400× at 50k, and now linear.** A stress test guards the ratio, so
reinstating `Scene.clear()` fails CI.

This is the "treat Three.js as a GPU driver" instruction paying off in a way
worth recording: the driver had a slow path, and the response was to route
around it inside the adapter. No engine interface changed, and no architectural
invariant was weakened. Had the fix required exposing Three's internals upward,
that would have been an `IMPLEMENTATION_FINDING.md` instead.

---

## 6. Context loss and recovery

**Proven** against the simulated host:

- Draws are dropped while the context is lost rather than throwing.
- On restore, every resource is recreated and **handles are preserved**. This is
  what lets a GPU reset not restart the engine: the mirror still points at the
  same ids, so no reconciliation is needed and nothing above the backend learns
  it happened. The snapshot is byte-identical across loss and restore.
- Mutations are accepted while the context is lost. The engine does not stop
  when the GPU does; commands keep arriving and the mirror must stay correct so
  the restore has something to rebuild.
- Repeated loss collapses to one event; a restore with no preceding loss is
  ignored; loss before anything exists is harmless.
- 20 loss/restore cycles under a 10,000-mesh load leave the mirror intact and
  the pools balanced.

**Unknown:** whether real driver-initiated context loss behaves identically. See
§7.

---

## 7. Limits — what this verification does *not* establish

Stated explicitly, because a verification document that overstates its reach is
worse than none.

| Claim | Status | What would establish it |
| --- | --- | --- |
| Draw calls reach the GPU | **Unknown** | A browser with a real WebGL2 context |
| Rendered output is correct | **Unknown** | Reference-image comparison in a browser |
| VRAM figures match reality | **Unknown** | `WEBGL_debug_renderer_info` / driver counters. Ours is an estimate from buffer byte lengths — sound for relative comparison, not an absolute |
| GPU frame time | **Unknown** | `EXT_disjoint_timer_query` on hardware |
| Driver context loss behaves as simulated | **Unknown** | `WEBGL_lose_context` in a browser |
| Shader compilation cost | **Unknown** | Not exercised; Phase 2.6 |
| Behaviour under real memory pressure | **Assumed** | Budget logic is proven; real driver OOM is not |

The `RendererHost` seam is what makes everything else testable, and it is also
exactly where the untested region begins. `WebGLRendererHost` is written but
exercised only for construction. **Phase 2.6 must close this list** — it is the
first phase that puts pixels on screen, and these claims should be re-verified
there rather than inherited.

One honest note on the benchmarks: they measure CPU submission cost with a
headless host. They establish that the *engine* is not the bottleneck. They say
nothing about whether the GPU is.

---

## 8. Assessment

The architecture survived contact with a real rendering library without being
weakened. The two moments where it could have bent:

1. **`Object3D.type` is readonly.** The original approach retagged an `Object3D`
   as a `Mesh` and TypeScript refused. The available responses were a cast or a
   remodel. The type error was correct: a node is a transform and a mesh is an
   attachment, exactly as `SCENE_FORMAT §6/§7` already said. The remodel also
   removed an O(n²) lookup. A cast would have preserved a wrong model and hidden
   the quadratic.

2. **Quadratic `Scene.clear()`.** Fixed inside the adapter with no interface
   change.

Neither required reopening ADR-013. No `IMPLEMENTATION_FINDING.md` was produced
for this phase.

The strongest single result is V4: the reconciler cannot distinguish the two
backends by their output. That converts "Three.js is replaceable" from a design
intention into an executable, enforced property — and gives any future WebGPU
backend a suite to pass rather than an argument to win.

**Verdict: VERIFIED WITH LIMITS.** Proceed to Phase 2.6, whose first
responsibility is the Unknown column in §7.
