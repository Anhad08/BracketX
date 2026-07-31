# Implementation Report — Phase 2.4, Reconciler

**Date:** 2026-08-01 · **Branch:** `phase-2-engine`
**Commits:** `00e2893` (projection engine, mirror graph) · `76e24c2` (property, stress, benchmarks, diagnostics)
**Gate:** §12

---

## 1. Architecture implemented

The projection engine connecting the authoritative Scene Graph to any
rendering backend. It is not a renderer and not a scene graph.

| Subsystem | Module | Role |
|---|---|---|
| Mock backend | `mock-backend.ts` | Contract verification and failure injection |
| Mirror graph | `mirror.ts` | Backend-neutral mirror, lifetime ownership |
| Dirty tracking | `dirty.ts` | Five independent propagation channels |
| Dependencies | `dependencies.ts` | Variable → node index |
| Resolution | `resolve.ts` | Resolved-value contract and path routing |
| Projection | `projection.ts` | build / project / teardown |
| Verification | `verify.ts` | Independent structural re-derivation |
| Reconciler | `reconciler.ts` | The three-verb facade |
| Diagnostics | `diagnostics.ts` | Deterministic snapshots |

### The shape of the design

**Projection, not diffing.** Operations already carry what changed (RFC-002
§4.3), so the reconciler switches on the operation rather than comparing trees.
Only three traversals exist, each proportional to the change: a new subtree on
insert, descendants on transform or visibility because the maths composes, and
a destroyed subtree depth-first.

**Lifetime here, instances there.** Per IF-001, `MirrorGraph` is the single
creator and single destroy path, expressed over opaque handles. The backend owns
instances. This is what lets the reconciler be backend-neutral while still
owning ownership.

**Five dirty channels, not one.** They propagate differently — transform and
visibility compose to descendants; material and camera affect exactly one node.
A single channel would invalidate work that did not change.

## 2. Files added

```
packages/engine-reconciler/src/
  mock-backend.ts        InspectableMirrorBackend, leak detection, failure injection
  mirror.ts              MirrorGraph, MirrorNode, ownership assertions
  dirty.ts               DirtySet, five channels, propagation metrics
  dependencies.ts        DependencyIndex, DependencyRecorder
  resolve.ts             VariableSource, localMatrixOf, channelForPath
  projection.ts          Projector — build / project / invalidateVariables / teardown
  verify.ts              verifyConsistency, assertConsistent
  reconciler.ts          Reconciler facade
  diagnostics.ts         hierarchy, lifetime, dependency snapshots
  reconciler.test.ts     40 tests
  property.test.ts       7 property tests, 150 seeds
  stress.test.ts         11 stress tests, to 100k nodes
  reconciler.bench.ts    16 benchmarks
  vitest.stress.config.ts
docs/
  RECONCILER_VERIFICATION.md
  IMPLEMENTATION_REPORT_PHASE_2_4.md
```

## 3. Files modified

| File | Change |
|---|---|
| `engine-reconciler/src/index.ts` | Public surface |
| `engine-reconciler/package.json` | `bench`, `test:stress` |
| `engine-reconciler/vitest.config.ts` | Exclude stress from the fast path |
| `turbo.json`, root `package.json` | `test:stress` task |
| `.github/workflows/ci.yml` | Stress step |

Nothing outside `engine-reconciler`, `docs/`, and workspace config was touched.

## 4. Public API

**Reconciler** — `build`, `project`, `invalidateVariables`, `teardown`,
`verify`, `stats`
**MirrorGraph** — `create`, `destroySubtree`, `reparent`, `setAttachment`,
`childrenOf`, `ancestorsOf`, `teardown`
**Projector** — `build`, `project`, `invalidateVariables`, `dependencies`
**Verification** — `verifyConsistency`, `assertConsistent`
**Diagnostics** — `snapshotDiagnostics`, `describeHierarchy`,
`describeLifetime`, `lifetimeBalanced`
**Testing** — `MockMirrorBackend`, `MirrorBackendViolation`
**Tracking** — `DirtySet`, `DependencyIndex`, `DependencyRecorder`

## 5. Complexity

| Subsystem | Design | Implementation | Testing | Debugging | Maintenance |
|---|---|---|---|---|---|
| Mock backend | Low | Medium | Low | Low | Low |
| Mirror graph | Medium | Medium | Medium | Medium | Medium |
| Dirty tracking | **High** | Low | Medium | **High** | Medium |
| Dependencies | Low | Low | Low | Low | Low |
| Projection | **High** | **High** | **High** | **High** | **High** |
| Verification | Medium | Medium | Low | Low | Medium |
| Diagnostics | Low | Low | Low | Low | Low |

Projection is the hardest in every column, and dirty tracking is hardest to
debug because its failures are *absences* — work that should have happened and
did not. That is why verification re-derives independently rather than checking
projection's own records.

## 6. Property testing

150 seeds × 60 random operations over randomized scenes, asserting after
**every** operation:

- Mirror consistency (membership, hierarchy, ordering, transforms, visibility, cameras)
- Live backend handles equal document nodes
- Teardown frees everything
- Handles never change while a node exists
- Identical sequences produce identical snapshots
- `build` and `project` reach the same mirror (R9)
- No crashes over 150-operation sequences

Seeded LCG; every assertion carries its seed.

## 7. Stress testing

| Scenario | Result |
|---|---|
| Build 1k / 10k / 50k | Correct, lifetime balanced |
| Build 100k | Correct |
| Leaf edit in 50k | 1 node dirty, ≤ 2 backend writes |
| Same edit at 1k / 10k / 50k | Dirty count identical |
| Root edit, depth 2,000 | Exactly 2,001 dirty, depth 2,000 |
| Leaf edit, depth 2,000 | 1 dirty, depth 0 |
| 1,000 sequential edits | Zero creates, zero destroys |
| Teardown 50k | Everything freed |

## 8. Benchmarks

Full table in [RECONCILER_VERIFICATION §8](./RECONCILER_VERIFICATION.md#8-benchmarks).

**Headline: isolated projection is 12 µs / 6 µs / 7 µs at 1k / 10k / 50k.**
Flat in scene size, linear in affected nodes.

## 9. Known limitations

1. **Only cameras attach.** Mesh and material attachment await a resource
   manager. `setAttachment` supports them; nothing constructs them yet.
2. **Verification is O(scene)** and off by default in production.
3. **`invalidateVariables` re-resolves whole nodes**, not individual properties.
   Correct but coarser than necessary.
4. **Mid-subtree backend failure is untested.**
5. **`channelForPath` routes unknown paths to `material`** — the narrowest
   non-propagating channel, so an unknown property costs one node. Conservative
   but not precise.
6. **Stress suite takes ~60 s** and is excluded from the fast path.

## 10. Unknowns

| # | Unknown | Resolved by |
|---|---|---|
| U1 | Performance against a real GPU backend | 2.5 |
| U2 | Whether the MirrorBackend contract survives contact with Three.js | 2.5 |
| U3 | Memory over a long session | 3 |
| U4 | Cross-platform determinism | CI on a second architecture |
| U5 | Resource lifetime under eviction | 3 |

## 11. Implementation findings

Three defects. None meets ADR-013's reopening criteria.

### F1 — Transform changes composed from a stale local matrix · fixed

`#flush` recomputed world matrices without re-reading the changed node's local
transform. Propagation was correct; its input was not.

Found by the consistency verifier, which re-derives from the document rather
than trusting projection — precisely the case a self-consistent implementation
cannot catch. Fixed by separating "this node's own values changed" from "this
node needs recomputing because an ancestor changed": only the former is re-read,
so descendants stay cheap.

### F2 — Projection was O(scene), not O(change) · fixed · **the significant one**

Detailed in
[RECONCILER_VERIFICATION §6](./RECONCILER_VERIFICATION.md#6-the-disproven-invariant-and-its-correction).
21.5 ms → 7 µs at 50k nodes, ~2,900×.

Two causes in sequence: `findNode` scanning the document, then a replacement
index-refresh that was still O(width) because finding a child by id scans the
sibling array. The descent proved unnecessary — only the directly changed node
is ever re-applied — so reproducing the document's own edit via `setAtPath` is
O(path) and cannot drift.

**Every structural test passed throughout**, reporting a correct dirty count of
1. Only isolated timing exposed it.

### F3 — Stress suite starved the parallel test runner · fixed

At 140 s the stress tests caused a vitest worker RPC timeout, reported as a
task failure while all 58 tests passed. Moved to `test:stress`, single-fork,
its own CI step — the same separation integration tests already have.

## 12. ADR-013 reopening requests

**None.**

| Criterion | Met |
|---|---|
| A published requirement cannot be satisfied | No — 2.4a's "never traverse outside affected paths" was violated by implementation and fixed, not by the design |
| Two published invariants contradict | No |
| A subsystem boundary cannot be maintained | No |
| **A benchmark disproves an architectural assumption** | **No — but close.** The benchmark disproved an *implementation* claim. The architecture's assumption that projection can be O(change) was confirmed once the implementation matched it |
| A prototype disproves an assumption | No |
| A documented invariant cannot be enforced | No |
| A correctness proof is invalid | No |
| A production scenario exposes undefined behaviour | No |

## 13. Technical debt introduced

| # | Debt | Severity | Note |
|---|---|---|---|
| T1 | `engine-scene` document application is O(scene) — 53 ms at 50k | **High** | `findNode` and `replaceNode` both scan. Outside this phase, but it now dominates the pipeline: projection is 7 µs against 53 ms of document work |
| T2 | A6 (no direct backend allocation) is convention, not lint | Medium | V1 |
| T3 | `#index` duplicates document node references | Low | Bounded by node count; cleared on teardown |
| T4 | `invalidateVariables` re-resolves whole nodes | Low | Correct, coarse |
| T5 | Two timing-sensitive tests | Medium | Mitigated by min-of-N; still the most likely flake source |

**T1 is the one to act on.** Projection is now three orders of magnitude
cheaper than the document update feeding it, so the bottleneck has moved
entirely into `engine-scene`.

## 14. Lessons learned

**Structural tests and performance tests verify different things, and neither
substitutes for the other.** Every dirty-count assertion passed while projection
was O(scene). The counts were correct; the work behind them was not. A suite
with only structural assertions would have shipped an unusable reconciler with
full green.

**A verifier must not share the implementation's assumptions.** F1 was caught
because `verify.ts` recomputes world matrices from the document rather than
comparing against what projection recorded. Had it trusted projection's own
state, the stale-local defect would have been invisible.

**Fixing the obvious cause is not the same as fixing the problem.** Replacing
`findNode` with an index felt like the fix, and measurement showed it was not —
the replacement was still O(width). Re-measuring after the first fix is what
found the second cause.

**Slow tests are not free.** The stress suite's cost surfaced as an unrelated
RPC timeout, which is a much worse failure signal than "this is slow."

**Ready for Phase 2.5 — Render Backend (Three.js).** The MirrorBackend contract
is fully exercised by a working implementation, projection is proven flat in
scene size, and `engine-render-three` remains the only package permitted to
import a rendering library.
