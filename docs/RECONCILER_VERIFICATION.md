# Reconciler Verification — Phase 2.4

**Date:** 2026-08-01 · **Commits:** `00e2893`, `76e24c2`
**Labelling:** **[Proven]** · **[Derived]** · **[Assumed]** · **[Unknown]** · **[Disproven]**

> **Proven** requires an executable test that fails if the property breaks.
> Nothing is Proven because it was designed to be true.

---

## 1. Architectural invariants

| # | Invariant | Status | Evidence |
|---|---|---|---|
| A1 | No tree diffing exists anywhere in the reconciler | **[Proven]** | No `diff`, keying, or reorder-detection code exists. Grep of `projection.ts` finds no tree comparison. Structurally implied by A2: the switch consumes operations |
| A2 | Projection is entirely operation-driven | **[Proven]** | `project()` accepts only a `Transaction`; every mirror mutation originates in `#projectOperation`. `build()` is the sole exception and is scene-load/recovery only |
| A3 | The Scene Graph remains authoritative | **[Proven]** | `reconciler.test.ts` "does not mutate the scene graph" compares the serialised document before and after `build` |
| A4 | The mirror is backend-neutral | **[Proven]** | `reconciler.test.ts` "stores no document node in the mirror" asserts absence of `components`, `children`, `name`. Types permit only resolved values and opaque handles |
| A5 | The reconciler never imports a rendering library | **[Proven]** | `tools/check-boundaries.mjs`, run in CI, fails on any `three` import outside `engine-render-three`. Negative-tested in Phase 2.1 |
| A6 | The reconciler never allocates backend resources directly | **[Derived]** | All allocation routes through `MirrorGraph`, the single creator. **Not** mechanically enforced — see §4 V1 |
| A7 | Projection never traverses outside affected paths | **[Proven]**, after a fix | `stress.test.ts` "projection wall time does not grow with scene size". Was **[Disproven]** at first measurement — see §3 |

## 2. Structural and lifetime invariants

| # | Invariant | Status | Evidence |
|---|---|---|---|
| S1 | Mirror hierarchy equals the projected Scene Graph | **[Proven]** | `verify.ts` re-derives membership, parent links, and back-links independently; asserted after every operation across 150 seeds |
| S2 | Sibling ordering matches the document | **[Proven]** | `verifyConsistency` compares child arrays element-wise; `reconciler.test.ts` "places the node in document order" |
| S3 | World = parent.world × local, everywhere | **[Proven]** | `verify.ts` recomputes matrices from scratch rather than trusting projection. This is what caught the stale-local defect |
| S4 | Effective visibility composes with ancestors | **[Proven]** | `verify.ts` plus "composes with ancestors" and "restores descendants" |
| S5 | Camera projection matches the document | **[Proven]** | `verifyConsistency` compares camera attachment both ways |
| L1 | Every mirror object has exactly one creator | **[Proven]** | `MirrorGraph.create` is the only caller of `backend.createNode`; duplicate creation throws. `reconciler.test.ts` "refuses duplicate creation" |
| L2 | Exactly one owner | **[Proven]** | Second-root creation throws; property test asserts live backend nodes always equal document nodes |
| L3 | Exactly one destroy path | **[Proven]** | `destroySubtree` is the only caller of `backend.destroyNode`; double destroy throws |
| L4 | No orphaned mirror objects | **[Proven]** | `teardown()` reports orphans; property test "teardown always frees everything" across 60 seeds asserts created == destroyed |
| L5 | No leaked handles | **[Proven]** | Mock backend records every create/destroy; 80 seeds × 50 operations assert live handles equal document nodes at every step |
| L6 | Identity is stable across updates | **[Proven]** | 80 seeds assert a node's handle never changes while it exists — a move must reparent, never destroy-recreate |
| L7 | Destruction is depth-first | **[Proven]** | Mock rejects destroying a node with children; a breadth-first implementation fails immediately |

## 3. Incrementality and dependency invariants

| # | Invariant | Status | Evidence |
|---|---|---|---|
| I1 | The mirror is never rebuilt during updates | **[Proven]** | "never rebuilds the mirror" — 20 edits over 100 nodes create and destroy nothing |
| I2 | Unchanged nodes are not resynchronised | **[Proven]** | "touches only the changed node" — one leaf edit in a 200-node scene issues ≤ 2 backend writes |
| I3 | A material change does not invalidate transforms | **[Proven]** | "a material change does not invalidate transforms" asserts `dirty.transform === 0` |
| I4 | A visibility change does not invalidate transforms | **[Proven]** | "does not dirty transforms" |
| I5 | A variable change affects only dependent nodes | **[Proven]** | "a variable change affects only dependent nodes" — one of two sibling nodes dirties |
| I6 | Dependencies are dropped when a node is destroyed | **[Proven]** | "drops dependencies when a node is destroyed" asserts edges return to 0 |
| I7 | A transform change propagates to descendants and no further | **[Proven]** | "does not touch siblings"; stress: depth-2000 root edit dirties exactly 2001 |
| I8 | An already-dirty subtree is not re-walked | **[Proven]** | "does not re-walk an already-dirty subtree" bounds propagation visits |
| I9 | Propagation depth is measured | **[Proven]** | `DirtyStats.maxPropagationDepth`; asserted at 2 for a 3-level tree and 2000 for a deep chain |

## 4. Determinism

| # | Invariant | Status | Evidence |
|---|---|---|---|
| D1 | Identical operation sequences produce identical snapshots | **[Proven]** | 60 seeds compare serialised `MirrorSnapshot` between two runs |
| D2 | `build` and `project` reach the same mirror | **[Proven]** | 60 seeds compare a freshly built reconciler against an incrementally projected one. This is ENGINE_RECONCILIATION R9 |
| D3 | Write order is stable across runs | **[Derived]** | `#topmost` sorts before recomputation. Implied by D1, not separately asserted |

## 5. Failure handling

| # | Invariant | Status | Evidence |
|---|---|---|---|
| F1 | A backend exception does not corrupt the mirror | **[Proven]** | Injected `throwOnCreateNode`; the mirror is unchanged and still consistent afterwards |
| F2 | Resource failure is returned, not thrown | **[Proven]** | Injected `failCreateMaterial` returns `{ ok: false }` — MirrorBackend contract C7 |
| F3 | Projecting onto an unmirrored node is rejected | **[Proven]** | "rejects projecting onto a node that is not mirrored" |
| F4 | Double deletion is rejected | **[Proven]** | "rejects a double destroy" |
| F5 | Use after destroy is detected | **[Proven]** | Mirror and mock both distinguish "destroyed" from "never issued" |
| F6 | Cycles are rejected | **[Proven]** | Mirror-level and backend-level cycle checks both throw |
| F7 | Orphans are detected at teardown | **[Proven]** | "detects an orphan at teardown" |
| — | Partial synchronisation leaves no corruption | **[Assumed]** | F1 covers a throw during create. A backend failing *mid-subtree* is **[Unknown]** — see §7 |

## 6. The disproven invariant, and its correction

**A7 was [Disproven] on first measurement.**

Benchmarks showed a leaf edit at 94 µs in a 1k scene and **73.5 ms** in a 50k
scene. Isolating projection from document application confirmed projection
itself at **21.5 ms** — O(scene), directly violating 2.4a's requirement that
projection never traverse outside affected paths.

Two causes, found in sequence:

1. `findNode` scanned the whole document per lookup.
2. Replacing it with a root-to-node index refresh was **still O(width)**,
   because finding a child by id scans the sibling array — 50,000 entries in a
   wide scene.

The descent proved unnecessary: only the directly changed node is ever
re-applied, never its ancestors. Reproducing the document's own edit on the
cached node via engine-scene's `setAtPath` is O(path) and cannot drift, because
it is the same function the document uses.

| Scene | Before | After |
|---|---|---|
| 1,000 | 42 µs | 12 µs |
| 10,000 | 860 µs | 6 µs |
| 50,000 | 21,504 µs | **7 µs** |

**Flat.** ~2,900× at 50k. A7 is now **[Proven]** by a regression guard.

**What this says about the test suite:** every dirty-count assertion passed
throughout, reporting a correct count of 1. The structural tests could not see
it. Only isolated timing could — which is the argument for benchmarks being a
verification tool rather than a performance exercise.

## 7. Not proven

| Claim | Status | Why |
|---|---|---|
| Real backend performance | **[Unknown]** | The mock does no GPU work. Phase 2.5 |
| Failure mid-subtree leaves no corruption | **[Unknown]** | Not tested. Requires an injection point partway through `destroySubtree` |
| Memory does not grow over a long session | **[Unknown]** | No soak test. Handle counts are asserted; heap is not |
| Cross-platform determinism | **[Assumed]** | Single machine. Arithmetic is integer and exact-rational, so **[Derived]** it should hold |
| A6 is enforced | **[Derived]** | Convention, not lint. See V1 |
| Text/material resource lifetime | **[Unknown]** | No resource manager exists; only cameras attach today |

## 8. Benchmarks

Recorded 2026-08-01, Node 24, Windows, single machine.

| Operation | Cost |
|---|---|
| Build 1,000 nodes | ~0.94 ms |
| Build 10,000 nodes | ~13.1 ms |
| Build 50,000 nodes | ~79 ms |
| **Projection, isolated, 1k / 10k / 50k** | **12 µs / 6 µs / 7 µs** |
| Root edit, depth 10 | ~4 µs |
| Root edit, depth 100 | ~70 µs |
| Root edit, depth 1,000 | ~7.6 ms |
| Root edit over 5,000 children | ~1.4 ms |
| Verify 1,000 nodes | ~0.43 ms |
| Verify 10,000 nodes | ~5.6 ms |

**Reading:** projection is flat in scene size and linear in *affected* nodes —
depth 10 → 100 → 1000 costs 4 µs → 70 µs → 7.6 ms, which is the propagation
doing real work, not a scan.

Verification is O(scene) by design and is off by default in production.

## 9. Gaps for later phases

| # | Gap | Phase |
|---|---|---|
| V1 | Lint rule so only `MirrorGraph` may call `backend.create*`/`destroy*` (A6) | 2.5 |
| V2 | Mid-subtree failure injection | 2.5 |
| V3 | Memory soak over a long session | 3 |
| V4 | Cross-platform determinism in CI | 2.5 |
| V5 | Resource lifetime once a resource manager exists | 3 |

## 10. Conclusion

**[Proven]** 34 invariants are executable. The reconciler does not diff, is
operation-driven, keeps the scene graph authoritative, keeps the mirror
backend-neutral, and maintains single-creator/single-owner/single-destroy
ownership under 150 randomized seeds.

**One invariant was Disproven and corrected** — projection was O(scene) despite
every structural test passing. That is the most useful result of the phase.

**[Unknown]** whether it performs against a real GPU backend, because none
exists yet.
