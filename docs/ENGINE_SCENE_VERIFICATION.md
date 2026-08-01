# engine-scene Verification — Initiative P-001

**Date:** 2026-08-01
**Package:** `@bracketx/engine-scene`
**Companion:** `ENGINE_SCENE_PERFORMANCE_REPORT.md` — measurements and decisions
**Verdict:** **VERIFIED.** Every architectural invariant is Proven by executable evidence. One assumption was **Disproven** and is the reason the initiative found what it did.

Evidence labels follow the convention used since `ARCHITECTURE_VERIFICATION.md`:

| Label | Meaning |
| --- | --- |
| **Proven** | Demonstrated by an executing test or measurement in this repository |
| **Derived** | Follows necessarily from something Proven, plus a stated argument |
| **Assumed** | Believed true, not yet tested; the risk is stated |
| **Unknown** | Cannot be established in this environment; what would establish it is stated |
| **Disproven** | Tested and found false |

---

## 1. How to reproduce

```
pnpm --filter @bracketx/engine-scene test           126 passed
pnpm --filter @bracketx/engine-scene test:stress     25 passed
pnpm --filter @bracketx/engine-scene perf            profile + tables
pnpm turbo run check-types lint test build           23/23 successful
node tools/check-boundaries.mjs                      exit 0
```

126 fast tests (106 pre-existing, unchanged, plus 20 new invariant tests) and
25 stress/regression guards. The 106 pre-existing tests passed unmodified
before and after every optimization — that is the primary evidence that
semantics did not change.

---

## 2. Assumptions that changed status

This is the section that matters most. The initiative began with a stated
belief about where the time was going, and that belief was wrong.

### A1 — "The bottleneck is tree traversal." **Disproven (partially).**

The initiative brief attributed the ~53 ms to O(scene) document application,
and the natural reading was that traversal was the cost. Traversal was real but
second.

**Measured:** `order.ts` was **30.2%** of engine-scene self time — `midpoint`
16.6%, `assertValid` 11.0%, `generateKeyBetween` 2.6% — against `replaceNode`
6.9% and `findNode` 5.9%.

The cause was that appending siblings one at a time produced order keys growing
one character per five appends: 8,000 characters at 40,000 siblings. Sibling
arrays therefore held O(n²) characters, so every sortedness scan, string
comparison, and serialization pass was quadratic. The traversal was not slow
because of its structure; it was slow because of what it was comparing.

Had this been an intuition-led optimization pass, the traversal would have been
tuned and the quadratic left in place. **Measuring first was not a formality.**

### A2 — "The existing test suite would catch a performance defect of this size." **Disproven.**

All 106 tests passed before and after. A test asserting an order key is *valid*
cannot notice it is 8,000 characters long. This is the third time in the
project that structural tests and performance tests have proven to verify
different things (F2 in Phase 2.3, O(scene) projection in Phase 2.4).

### A3 — "Structural sharing is effective." **Proven, and it always was.**

A setProp on a 50,000-node wide scene rebuilt exactly **2 nodes** both before
and after. Sharing was never the problem. What was wrong is that the traversal
allocated 1.29 MB on its way past those 2 nodes.

**Evidence:** `changedNodeCount` in `perf-support.ts` counts nodes that changed
object identity; the stress guard "an edit rebuilds only the ancestor path"
asserts `rebuilt ≤ depth` across wide, balanced, and mixed shapes at 50,000
nodes.

### A4 — "Fractional indexing causes the key growth." **Disproven.**

`generateNKeysBetween`, which splits around the midpoint, produced a maximum
key length of **3** for the same 40,000 keys that sequential append made 8,000
characters. The defect was confined to the append path, not to the scheme.

### A5 — "Deep scenes are slow." **Disproven — they crash.**

Every traversal recurses per level and throws `RangeError` past a hard limit.
`validateDocument` fails at ~1,344. A scene too deep to validate is also too
deep to save. This is a robustness defect, not a performance one, and it is
documented as remaining work rather than fixed here (see §5).

---

## 3. Architectural invariants — all Proven

Each was required by the initiative brief. Each is asserted by a named test in
`src/invariants.test.ts` or `src/stress.test.ts`, run in CI.

### I1 — The scene graph is immutable. **Proven.**

- `applyOperation` leaves the input document canonically identical.
- `replaceNode` leaves the input root and its `children` array identical **by
  reference**.
- The shared empty-children array returned by `childrenOf` is `Object.isFrozen`
  — without that, a caller pushing to it would give every leaf in the process a
  child. This risk was introduced by optimization #3 and is closed by test.

### I2 — Operation correctness is unchanged. **Proven.**

The rewritten operation paths still reject every case they rejected before,
with the same messages:

- duplicate sibling order key (the check moved inside the insertion traversal)
- missing node on `setProp` (existence now rides along with the replacement)
- missing parent on `insert`
- moving a node beneath its own descendant

Plus a new guard specific to optimization #5: `withChildInserted` splices at the
insertion point rather than appending and re-sorting, so a test asserts an
insert in the *middle* still yields sorted siblings.

### I3 — Canonical serialization is stable. **Proven.**

- serialize → deserialize → canonicalize round-trips to identical bytes.
- Two documents reaching the same state by different construction routes
  canonicalize identically — the property hashing and deduplication rest on.
- An optimized document still passes `validateDocument`.

### I4 — Hashing is deterministic. **Derived from I3.**

Hashing consumes `canonicalize` output (`engine-runtime/hash.ts`). Identical
canonical bytes give identical hashes; I3 proves the bytes are identical. No
separate test is needed, and adding one would test `JSON.stringify`.

### I5 — Structural sharing is preserved. **Proven.**

- Untouched siblings survive an edit by reference.
- An untouched branch survives a deep edit by reference.
- At 50,000 nodes across three shapes, `rebuilt ≤ depth`.

This is the property Phase 2.4's O(change) projection depends on. Optimization
#2 changed `replaceNode`'s traversal, so this is the invariant most at risk from
this initiative, and it is guarded at both unit and stress scale.

### I6 — Replay is deterministic. **Proven.**

- The same transaction applied twice to the same document produces
  byte-identical canonical output — asserted at 50,000 nodes over 500
  operations.
- `generateKeyBetween` is a pure function of its bounds. This matters more
  after the change than before: replay on another machine diverges if key
  generation is not deterministic.
- Insert-then-undo round-trips to the original bytes, at unit scale and at
  10,000 nodes.

### I7 — Deterministic iteration order. **Proven.**

- `walk` yields parents before children, children in order-key order.
- `childrenOf` still sorts defensively when a document arrives scrambled —
  the guarantee that survives documents from disk or another client.
- Order keys are strictly increasing over 20,000 sequential appends. A shorter
  key is worthless if it sorts wrongly, so the performance guard and the
  correctness guard sit side by side.
- Siblings are in order through a 50,000-node mixed tree.

ENGINE_RECONCILIATION invariant R9 (build and project produce identical
mirrors) rests on this.

### I8 — Backend neutrality. **Proven.**

`engine-scene` is a leaf in the layer model — it depends on nothing. Unchanged
by this initiative and enforced independently by `tools/check-boundaries.mjs`
and 38 boundary tests.

### I9 — No architecture was reopened. **Proven.**

No optimization changed an interface, a document format, or a semantic. The
106 pre-existing tests are the evidence: they were not modified. ADR-013 was
not engaged, and no `IMPLEMENTATION_FINDING.md` was required.

The one optimization that *would* have required reopening — magnitude-prefixed
order keys — was rejected for that reason and recorded in the report §7 R1.

---

## 4. Performance claims

| Claim | Status | Evidence |
| --- | --- | --- |
| Order keys grow ~n/61 appending, not ~n/5 | **Proven** | 40,000 appends: 8,000 chars → 657 |
| 100,000 sequential appends no longer overflow | **Proven** | Stress guard; the baseline overflowed in `midpoint` at 80,000 |
| Every traversal is linear | **Proven** | Fitted exponents 0.85–1.27 over a 5k→80k doubling series, wide and balanced |
| Wide 50k `node.setProp`: 60.35 ms → 2.13 ms | **Proven** | `perf-baseline/` vs `perf-after/`, committed |
| Wide 10k edit allocation: 1,050,300 → 257,465 bytes | **Proven** | `measureAllocation` under `--expose-gc` |
| Balanced 50k edit costs 2,086 bytes | **Proven** | Same |
| Growth factors stay under 2.5× normalised | **Proven** | Five stress guards, failing CI |
| engine-scene is no longer the pipeline's dominant term by orders of magnitude | **Derived** | 0.29 ms balanced / 2.13 ms wide at 50k, against 7 µs projection. Still largest, now by ~40× not ~7,000× |

### Claims deliberately **not** made

| Claim | Status | What would establish it |
| --- | --- | --- |
| These figures hold on other hardware | **Unknown** | Runs on other machines. Absolute times are Windows 11 / Node 24.15, single fork, with 10–40% run-to-run variance. This is why every committed guard asserts a ratio |
| Real broadcast documents behave like these shapes | **Assumed** | Profiling an authored production scene. The shapes are synthetic; "balanced" (fan-out 8) is the closest to an authored package and is the figure quoted for realistic cost |
| Serialization is fast enough for its actual use | **Assumed** | 137 ms at 50,000 nodes is acceptable for a save and would not be for a frame. It is not on the frame path, but no save-latency budget has been written down |
| No further quadratic remains | **Derived, not Proven** | Exponents were fitted for five traversals on two shapes. `serialize`, `canonicalize`, and `validateDocument` were measured for scaling but not exponent-fitted |

---

## 5. Known defect, not fixed

**B2 — recursion depth ceilings.** Measured by binary search in
`limits.perf.ts`:

| Function | Max depth |
| --- | --- |
| `validateDocument` | ~1,344 |
| `serialize` | ~1,520 |
| `canonicalize` | ~1,728 |
| `countNodes` | ~3,520 |
| `walk` | ~4,416 |
| `pathToNode` | ~6,080 |
| `replaceNode` | ~7,168 |
| `findNode` | ~8,832 |

Past these depths the package throws `RangeError` rather than degrading. The
binding limit is ~1,344, and it means **a scene too deep to validate is also
too deep to save.**

Deliberately out of scope: this is a correctness and robustness problem, and
converting eight traversals to explicit stacks is a mechanical change deserving
its own commit and its own tests rather than riding along inside a performance
initiative. The stress suite tests deep trees at 3,000 nodes — under the lowest
ceiling — with a comment saying why, so the limitation is visible in the tests
rather than hidden by them.

**Recommended as the next work on this package.** An authored 1,344-deep scene
is unlikely; a programmatically generated one is not, and the failure mode is a
crash on save.

---

## 6. Assessment

The initiative asked for evidence-based optimization and for an honest answer
if the existing implementation turned out to be the right trade-off. Both
happened: five optimizations were justified and shipped, three were rejected
with reasons recorded, and three bottlenecks were documented as accepted or
deferred rather than papered over.

The most useful outcome is not the 28× on `node.setProp`. It is that the
assumption behind the initiative — that traversal was the cost — was measurably
wrong, and the discipline of profiling before optimizing is what surfaced an
8,000-character order key that 106 passing tests could not see.

**Verdict: VERIFIED.** Every invariant Proven, every optimization measured, the
one remaining defect documented with its evidence and its recommended fix.
