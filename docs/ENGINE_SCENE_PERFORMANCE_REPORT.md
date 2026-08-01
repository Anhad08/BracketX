# engine-scene Performance Report — Initiative P-001

**Date:** 2026-08-01
**Package:** `@bracketx/engine-scene`
**Companion:** `ENGINE_SCENE_VERIFICATION.md` — evidence labels and limits
**Status:** Complete. Five optimizations shipped, three rejected, three bottlenecks documented as remaining.

---

## 0. Summary

engine-scene was the dominant cost in the engine — roughly 53 ms against 7 µs
for projection and 27 µs for backend sync. The investigation found that the
headline number was not one problem but two, and that the larger of them had
nothing to do with tree traversal.

**The root cause was order key length.** Appending siblings one at a time —
the most ordinary thing an editor does — produced order keys that grew by one
character every five appends. At 40,000 siblings the key was 8,000 characters.
Sibling arrays therefore held O(n²) characters, which made every sortedness
scan, every string comparison, and every serialization pass quadratic. This
also meant the engine could not complete an 80,000-node scaling measurement at
all: key generation overflowed the stack.

The second cause was ordinary redundancy: `replaceNode` kept searching after it
had found its target and allocated an array at every node it visited, and
`applyOperation` walked the tree two to six times per edit.

Headline result, wide tree at 50,000 nodes:

| Operation | Before | After | Gain |
| --- | --- | --- | --- |
| `node.insert` | 101.83 ms | 6.31 ms | **16.1×** |
| `insertChild` | 68.45 ms | 3.63 ms | **18.9×** |
| `node.setProp` | 60.35 ms | 2.13 ms | **28.3×** |
| `removeNode` | 30.65 ms | 2.35 ms | **13.0×** |
| `replaceNode` | 30.42 ms | 2.16 ms | **14.1×** |
| `findNode` | 18.60 ms | 2.99 ms | **6.2×** |
| `countNodes` | 18.26 ms | 2.13 ms | **8.6×** |
| `walk` | 20.35 ms | 4.57 ms | **4.5×** |

Every fitted scaling exponent is now between 0.85 and 1.27, where 1.0 is
linear. `order.ts` fell from 30.2% of engine-scene CPU time to 2.5%.

Serialization and validation were **not** improved and are now the largest
remaining cost. That is deliberate and explained in §8.

---

## 1. Method

Measurement infrastructure lives in the package and is reproducible:

```
pnpm --filter @bracketx/engine-scene perf          # profile + tables
pnpm --filter @bracketx/engine-scene test:stress   # 25 regression guards
```

- **CPU profile** via `node:inspector`, 100 µs sampling. Writes a
  `.cpuprofile` (openable in Chrome DevTools for the flame graph) and a
  self-time hotspot table. Self time, not inclusive time — that distinguishes
  a function doing work from a function calling something slow.
- **Timing** reports the *minimum* of several rounds. Interference from GC, the
  scheduler, or another worker can only make a sample slower, so the fastest
  observed run is the closest estimate of true cost. Means drift with machine
  load; minima do not.
- **Allocation** under `--expose-gc`, with a double collection before and after
  each sample.
- **Structural sharing** measured directly by counting nodes that changed
  object identity between two trees — the exact measure of what an edit
  rebuilt.
- **Scaling exponent** fitted by least squares over a doubling series
  (5k → 80k), rather than comparing two endpoints where one outlier can make
  linear look quadratic.

Machine: Windows 11, Node 24.15, single fork. Run-to-run variance on this
machine is 10–40%, which is why every committed regression guard asserts a
*ratio* and never a millisecond figure.

---

## 2. Profile — before

Self time, top 10 of 25, from the committed baseline in `perf-baseline/`:

| Rank | Function | Share |
| --- | --- | --- |
| 1 | `midpoint` — order.ts | **16.6%** |
| 2 | `requireNode` — operations.ts | **13.1%** |
| 3 | `assertValid` — order.ts | **11.0%** |
| 4 | `serialize` — serialize.ts | 8.5% |
| 5 | `replaceNode` — tree.ts | 6.9% |
| 6 | `updateNode` — operations.ts | 6.1% |
| 7 | `findNode` — tree.ts | 5.9% |
| 8 | `childrenOf` — tree.ts | 3.8% |
| 9 | `pathToNode` — tree.ts | 3.3% |
| 10 | `walk` — tree.ts | 3.0% |

`order.ts` totalled **30.2%** (midpoint + assertValid + generateKeyBetween).
Nobody predicted that. The initiative brief assumed the cost was tree
traversal, and it was — but only second.

`requireNode` at 13.1% is pure redundancy: a full-tree search whose answer the
very next call rediscovers.

## 2b. Profile — after

| Rank | Function | Share |
| --- | --- | --- |
| 1 | `serialize` — serialize.ts | 21.7% |
| 2 | `findNode` — tree.ts | 16.5% |
| 3 | `walk` — tree.ts | 11.5% |
| 4 | `normalise` — serialize.ts | 9.5% |
| 5 | `childrenOf` — tree.ts | 6.5% |
| 6 | `replaceNode` — tree.ts | 5.5% |
| 7 | `nonFinitePaths` — validate.ts | 5.4% |
| … | `requireNode` | **0.8%** |
| … | `assertValid` + `generateKeyBetween` | **2.5%** |

The profile is now dominated by serialization, which is genuinely O(document)
and not on the per-frame path.

---

## 3. The root cause, measured

`generateKeyBetween(previous, null)` in a loop — appending a sibling — minted
the midpoint between the previous key and "after everything". Each step covers
only half the remaining digit range, so after about five steps it must descend
a place and the key grows.

| Sequential appends | Key length (before) | Key length (after) |
| --- | --- | --- |
| 10 | 2 | 1 |
| 100 | 20 | 3 |
| 1,000 | 200 | 17 |
| 5,000 | 1,000 | 83 |
| 10,000 | 2,000 | 165 |
| 40,000 | **8,000** | **657** |

`generateNKeysBetween`, which splits around the midpoint, produced a maximum
length of 3 for the same 40,000 keys. So this was never a property of
fractional indexing — it was a defect confined to the append path.

**The fix:** appending needs *any* key greater than the previous one, so mint
the shortest. Bump the rightmost digit that is not the maximum and drop
everything after it; if every digit is already the maximum, extend by the
smallest non-zero digit. That yields 61 keys per length instead of 5.

This also removed a hard failure. The baseline could not complete an 80,000-node
scaling fit at all: `midpoint` recursed once per character of an ever-growing
key and overflowed the stack. After the fix, 100,000 sequential appends complete
in 1.36 s with no overflow.

---

## 4. Complexity table (P2)

`n` = nodes in the document, `d` = depth to the node, `w` = siblings at a level.
"Measured" is the fitted exponent k in cost ~ n^k, wide/balanced.

| Operation | Before | After | Expected | Measured k (after) | Dominant allocation |
| --- | --- | --- | --- | --- | --- |
| `findNode` | O(n·L) | O(n) | O(n) | 1.06 / 0.88 | none |
| `pathToNode` | O(n·L + d²) | O(n + d) | O(n + d) | 0.85 / 0.82 | one path array |
| `parentOf` | O(n·L + d²) | O(n + d) | O(n + d) | — | one path array |
| `walk` | O(n·L) | O(n) | O(n) | 0.93 / 0.91 | generator frames |
| `countNodes` | O(n·L) | O(n) | O(n) | 1.27 / 0.93 | none |
| `replaceNode` | O(n·L) time, **O(n) alloc** | O(visited) time, O(d·w) alloc | O(d·w) | 1.16 / 0.92 | ancestor sibling arrays |
| `insertChild` | O(n·L + w log w) | O(visited + w) | O(d + w) | — | one sibling array |
| `removeNode` | O(n·L) | O(visited) | O(d·w) | — | ancestor sibling arrays |
| `node.setProp` | **2 traversals** | 1 traversal | 1 | 0.95 / 0.85 | ancestor path |
| `node.insert` | **4 traversals** | 2 traversals | 2 | — | ancestor path |
| `node.move` | **6 traversals** | 4 traversals | 4 | — | ancestor path ×2 |
| `serialize` | O(n·L) | O(n·L) | O(n) | ~1.0 | whole JSON string |
| `canonicalize` | O(n·L log k) | O(n·L log k) | O(n log k) | ~1.0 | whole JSON string |
| `validateDocument` | O(n·L) | O(n·L) | O(n) | ~1.0 | issue list |

`L` was the mean order-key length, which was itself O(n) before the fix — that
is the `n·L` term, and it is why so many rows were quadratic. `L` is now
effectively bounded for realistic sibling counts.

`node.insert` cannot drop below 2 traversals: one full scan to reject a
duplicate id anywhere in the document, one path walk to the parent. The
duplicate-id check is a correctness requirement, not overhead.

---

## 5. Data structure review (P3)

| Structure | Why chosen | Still right? | Alternatives | Cost to change |
| --- | --- | --- | --- | --- |
| **Sibling storage: plain sorted array** | Serializes directly to JSON; iteration order is the document order | **Yes** for realistic widths. Changing one child of a `w`-child parent must copy the array — inherent to immutability | Persistent vector / RRB-tree, giving O(log w) update | High: changes SCENE_FORMAT serialization or adds a conversion layer. Not justified below ~10,000 siblings |
| **Order key: base-62 fractional string** | Mergeable concurrent inserts; deterministic iteration | **Yes**, with a documented ceiling. Pure fractions in [0,1) cannot append unboundedly at bounded length | Magnitude-prefixed keys (an integer part), giving O(log n) | **Architectural** — changes SCENE_FORMAT §6.2. See §7 |
| **Node lookup: recursive scan by id** | No index to invalidate; document stays a plain value | **Yes** at current scale. O(n) with a small constant | `Map<id, path>` cached in a `WeakMap` keyed on the root | Medium. See §7 |
| **Immutable update: path copy** | Structural sharing lets the reconciler skip subtrees by reference | **Yes.** Measured optimal: a balanced 50k edit rebuilds 6 nodes | — | — |
| **Parent lookup: derived by search** | No parent pointers, so a node is a value and subtrees are freely movable | **Yes.** Parent pointers would make every node cyclic and unserializable | Parent map alongside the document | Medium, same as node lookup |
| **Components: array on the node** | Matches SCENE_FORMAT §7 | **Yes.** Component counts are small and bounded | — | — |
| **Traversal: recursion** | Simple, matches the shape of the data | **No** — see §8. Hard depth ceilings, lowest at ~1,344 | Explicit stack | Low, mechanical, but touches every traversal |

---

## 6. Optimizations implemented (P4/P5)

All five are **Safe**: no interface change, no semantic change, no format
change. 106 existing tests passed unchanged throughout.

| # | Change | Class | Gain | Complexity |
| --- | --- | --- | --- | --- |
| 1 | `order.ts` — append mints the shortest greater key | Safe | 12× shorter keys; removed a stack overflow; unblocked every other row | Low |
| 2 | `replaceNode` stops at the node it finds | Safe | 14× on wide; O(n) → O(d·w) allocation | Low |
| 3 | `childrenOf` shares one frozen empty array | Safe | Removes one allocation per leaf per visit | Trivial |
| 4 | `pathToNode` accumulates into one array | Safe | O(d²) → O(d) allocation | Low |
| 5 | `operations.ts` — one traversal per edit, not 2–6 | Safe | `requireNode` 13.1% → 0.8% | Low |

**Why #2 is safe.** Ids are unique — `validate.ts` enforces it — so the first
subtree reporting a change contains the target and no sibling can also contain
it. Stopping is not a heuristic; it is a consequence of the uniqueness
invariant.

**Why #5 is safe.** The replacer only runs when the node is found, so the flag
it sets is an exact existence test, not an approximation of one. The error
message for a missing node is unchanged.

---

## 7. Optimizations rejected

Each was considered against measured evidence and declined. Recording why is
the point — a future reader should not have to rediscover the reasoning.

### R1 — Magnitude-prefixed order keys. **Rejected: architectural.**

Would give O(log n) append instead of the current O(n/61). This is the only
remaining fix for key growth, and it is a real one.

Rejected because it changes the key *format*, and therefore SCENE_FORMAT §6.2,
which ADR-013 froze. It is also not merely additive: a document containing keys
from both schemes would order them by plain string comparison, which would
interleave them wrongly. Adopting it needs a migration, not a patch.

Not raised as an `IMPLEMENTATION_FINDING.md` because nothing is blocked. The
engine is correct at every scale tested; this is a scaling ceiling on a shape
(tens of thousands of siblings under one parent) that no broadcast scene has.
Revisit if a real document approaches ~10,000 siblings in one group.

### R2 — `Map<id, node>` index cached on the document. **Rejected: no measured benefit.**

Would make `findNode` O(1) instead of O(n).

Rejected because every edit produces a new root, so the index would be rebuilt
per edit — O(n) to save an O(n) lookup, which is a loss. Making it incremental
(patching only the ancestor path, which is all that changes identity) would
work, but it adds a cache with an invalidation rule to a package whose current
appeal is that a document is a plain value with no derived state. Measured
`findNode` is 2.99 ms at 50,000 nodes and is not the bottleneck. Revisit only
if lookup becomes dominant.

### R3 — Skip the defensive sort in `childrenOf`. **Rejected: correctness.**

`childrenOf` scans siblings for sortedness on every call. Trusting the document
instead would remove an O(w) scan per visit.

Rejected because the scan is what guarantees deterministic iteration for a
document that came from disk, from another client, or from a version of the
software with a different key generator. Deterministic sibling order is what
ENGINE_RECONCILIATION invariant R9 rests on. The scan is O(w) against a
traversal that is already O(n); it does not change the complexity class, and it
is the cheapest place in the system to catch a corrupt document.

---

## 8. Remaining bottlenecks

Stated plainly, because the initiative is only complete if these are explicit.

### B1 — Serialization is now the largest cost. **Accepted.**

| | 1k | 10k | 50k |
| --- | --- | --- | --- |
| `serialize` | 2.56 ms | 27.12 ms | 136.72 ms |
| `canonicalize` | 1.31 ms | 24.53 ms | 122.86 ms |
| `validateDocument` | 1.72 ms | 16.23 ms | 89.70 ms |

Unchanged by this initiative and now 38.8% of the profile. All three are
genuinely O(document): you cannot write a document without touching every node.

Accepted because **none of them is on the per-frame path.** Serialization
happens on save; validation on load and at transaction boundaries. A 137 ms
save of a 50,000-node scene is acceptable; a 137 ms frame is not, and this is
not one. If saving ever needs to be faster the fix is incremental
canonicalization keyed on structural sharing — untouched subtrees keep their
identity and could keep their serialized bytes — which is a real opportunity
and a large piece of work.

### B2 — Recursion depth ceilings. **Documented, not fixed.**

Every traversal recurses per level and throws `RangeError` past a hard limit:

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

**A scene too deep to validate is also too deep to save.** The binding limit is
~1,344 and it fails as a crash, not as degradation.

Not fixed here because it is a correctness/robustness issue rather than a
performance one, and converting eight traversals to explicit stacks is a
mechanical change that deserves its own commit and its own tests rather than
riding along with a performance initiative. **Recommended as the next piece of
work on this package.** A 1,344-deep authored scene is unlikely but a
programmatically generated one is not, and the failure mode is a crash on save.

### B3 — Wide-parent edits copy the sibling array. **Inherent.**

An edit under a 50,000-child parent allocates ~1.25 MB, because changing one
element of an immutable 50,000-entry array means copying it. Structural sharing
is exact — the edit rebuilds 2 nodes — but the array copy is unavoidable
without a persistent vector (R1's cousin, same architectural cost).

Realistic shapes do not hit this:

| Shape (50k nodes) | Nodes rebuilt | Bytes per edit |
| --- | --- | --- |
| balanced | 6 (0.0%) | **2,086** |
| mixed | 137 (0.3%) | 42,768 |
| wide | 2 (0.0%) | 1,251,990 |

Allocation tracks *ancestor depth × sibling width*, exactly as immutability
requires. The balanced figure — 2 KB to edit a 50,000-node document — is the
one that reflects real authored scenes.

---

## 9. Memory analysis (P8)

| Scene | Shape | Nodes rebuilt | Rebuilt % | Bytes/edit |
| --- | --- | --- | --- | --- |
| 10,000 | wide | 2 | 0.0% | 257,465 |
| 50,000 | wide | 2 | 0.0% | 1,251,990 |
| 1,000 | deep | 501 | 50.1% | 137,250 |
| 4,000 | deep | 2,001 | 50.0% | 561,100 |
| 10,000 | balanced | 6 | 0.1% | 2,268 |
| 50,000 | balanced | 6 | 0.0% | 2,086 |
| 10,000 | mixed | 51 | 0.5% | 16,886 |
| 50,000 | mixed | 137 | 0.3% | 42,768 |

Before the optimizations, a 10,000-node wide edit allocated 1,050,300 bytes;
it now allocates 257,465 — a **4.1× reduction** — while rebuilding the same 2
nodes. Structural sharing was already exact; what changed is that the traversal
no longer allocates on its way past.

The deep row reads as a 50% rebuild because editing the middle of a chain
rebuilds every ancestor above it. That is correct behaviour, not waste: those
ancestors genuinely changed.

Transaction replay, 50 operations:

| Scene | Total | Per operation |
| --- | --- | --- |
| 1,000 | 0.97 ms | 19 µs |
| 10,000 | 7.91 ms | 158 µs |
| 50,000 | 29.61 ms | 592 µs |

---

## 10. Pipeline position

Where engine-scene now sits, per edit, on a realistic (balanced) 50,000-node
scene:

| Stage | Cost |
| --- | --- |
| Scene document update | **0.29 ms** (was ~53 ms on the shape originally measured) |
| Projection | 7 µs |
| Backend sync | 27 µs |
| Runtime tick | 0.47 µs |

engine-scene is still the largest term, and that is correct — it is the only
stage that must copy data. It is no longer three orders of magnitude larger
than everything else.

For the wide 50,000-node shape that produced the original 53 ms figure, the
same operation is now **2.13 ms**.

---

## 11. Future opportunities

Not scheduled; recorded so they are not rediscovered.

1. **Iterative traversals** — removes B2's crash ceiling. Highest value of
   anything remaining, and it is a robustness fix as much as a performance one.
2. **Incremental canonicalization** — cache serialized bytes per subtree keyed
   on node identity. Structural sharing already provides the cache key. Would
   attack B1, the largest remaining cost.
3. **Magnitude-prefixed order keys** — R1. Needs an ADR and a migration.
4. **Persistent vector for siblings** — only if a real document ever carries
   thousands of siblings under one parent.

---

## 12. Assessment

The brief asked for measurement before optimization, and that ordering earned
its keep: the largest cost in the package was in `order.ts`, which nobody had
suspected, while the tree traversal everyone expected to find was real but
second. Had this been an optimization pass driven by intuition, the traversal
would have been tuned and the quadratic left in place.

Three of the findings were things the existing test suite could never have
caught, because all 106 tests passed before and after. A test that asserts an
order key is *valid* cannot notice that it is 8,000 characters long.

The honest bottom line: engine-scene is now linear in every operation measured,
its remaining costs are either off the frame path (B1) or inherent to
immutability (B3), and its one genuine defect (B2, the depth ceiling) is a
robustness problem that this initiative deliberately did not fix and should be
addressed next.
