# Runtime Verification — Phase 2.3

**Date:** 2026-08-01 · **Commits:** `071df91`, `1524b1f`, `1beec48`
**Labelling:** **[Proven]** · **[Derived]** · **[Assumed]** · **[Unknown]** · **[Disproven]**

> **Proven** requires an executable test that fails if the property is broken.
> Nothing is Proven because it was designed to be true.

---

## 1. Invariants

| # | Invariant | Status | Evidence |
|---|---|---|---|
| I1 | No delta-time accumulation anywhere in the engine | **[Proven]** | `clock.test.ts` "reaches the same frame in one jump or many small steps"; `determinism.test.ts` "reaches the same frame regardless of timestamp granularity" across 80 seeds and 4 rates. Accumulation would make the answer depend on host reporting granularity |
| I2 | No ambient time reads outside a clock source | **[Proven]** | `runtime.test.ts` "never reads a platform clock" spies on `Date.now` across a play/tick/step sequence. Scheduler's `now` defaults to a counter, not a wall clock |
| I3 | Evaluating frame N directly equals playing forward to N | **[Proven]** | `determinism.test.ts` "holds for arbitrary step decompositions" — 120 seeds, random chunk sizes, asserting equal frame, equal exact seconds, and equal timecode |
| I4 | No application code registers a Signal handler | **[Derived]** | Enforced by type boundary: `SignalBus` is reachable only from `Runtime.signals`, and no application package exists yet. **Not** mechanically enforced — see §4 |
| I5 | No operation over the chunk budget runs unchunked on the frame thread | **[Proven]** *(detection)* | `runtime.test.ts` "reports a stage that exceeds the chunk budget". Detection is proven; **compliance is [Unknown]** until real subsystems register |
| — | Show time is monotonic | **[Proven]** | `clock.test.ts` "never moves backwards, under any timestamp sequence" (2000 disordered timestamps); `determinism.test.ts` across 60 seeds x 300 timestamps |
| — | Replay of identical commands produces identical state | **[Proven]** | `determinism.test.ts` — 250 seeds x 200 commands ≈ 50,000 commands, comparing canonical state exactly |
| — | Queue dispatch and direct replay agree | **[Proven]** | `determinism.test.ts` "holds when the same script runs through the runtime queue", 60 seeds. A recorded show must reproduce what happened |
| — | `runtime.reset` returns exactly to the pristine state | **[Proven]** | `determinism.test.ts` "returns a dirtied runtime exactly to its pristine state", 100 seeds |
| — | Reset then replay reproduces the first run | **[Proven]** | `determinism.test.ts` "holds across 100 random scripts" |
| — | Runtime state never serialises | **[Proven]** | `state.test.ts` asserts absence of `serialize`/`toJSON`; no serialisation function exists in the module |
| — | Runtime state holds no document structure | **[Proven]** | `state.test.ts` and property test assert absence of `root`, `nodes`, `format` |
| — | Commands are not invertible | **[Proven]** | `state.test.ts` asserts no `invertCommand` export. RFC-002 §4.3 as corrected |
| — | A rejected command mutates nothing | **[Proven]** | `determinism.test.ts` "never lets a rejected command mutate state", 80 seeds |
| — | Batches apply atomically | **[Proven]** | `state.test.ts` — one invalid member rejects all three; state unchanged |
| — | Stage order follows phase, not registration | **[Proven]** | `runtime.test.ts` registers render before time and asserts execution order |
| — | P0 work is never deferred or degraded | **[Proven]** | `runtime.test.ts` — P0 runs 5/5 frames under sustained overrun while P2 is skipped |
| — | Degradation requires sustained pressure | **[Proven]** | `runtime.test.ts` — no degradation on frames 0–1, degraded on frame 2 with `degradeAfter: 3` |
| — | Starved deferred work is promoted | **[Proven]** | `runtime.test.ts` — runs within 62 frames despite a permanently over-budget frame |
| — | Signals refuse recursive dispatch | **[Proven]** | `runtime.test.ts` expects `EventError` |
| — | Events published by a handler defer to the next drain | **[Proven]** | `runtime.test.ts` — depth 1 after first drain, 2 after second |
| — | A throwing handler does not stop delivery | **[Proven]** | `runtime.test.ts` — sibling handler still runs, error reported |
| — | Illegal lifecycle transitions fail | **[Proven]** | `runtime.test.ts` — parameterised over four illegal pairs; `playing` unreachable except from `ready` |
| — | Two runtimes do not interfere | **[Proven]** | `runtime.test.ts` — independent `ServiceRegistry` instances; no module-level mutable state exists |
| — | Id allocation is deterministic | **[Proven]** | `runtime.test.ts` — two fresh allocators produce identical sequences |
| — | Canonical hashing is order-insensitive | **[Proven]** | `state.test.ts` — object key order, Map insertion order, Set insertion order, and -0 |

## 2. What is not proven

| Claim | Status | Why |
|---|---|---|
| The runtime meets the frame budget with real subsystems | **[Unknown]** | No subsystem exists yet. Benchmarks measure an empty kernel |
| Chunking compliance (I5) | **[Unknown]** | Detection works; nothing is registered to violate it yet |
| I4 is enforced rather than merely true | **[Derived]** | No application code exists. Needs a lint rule when it does — §4 |
| Event delivery is bounded in *time* | **[Disproven]**, and documented as such | `maxPerDrain` bounds how many handlers start, not how long one runs. ARCHITECTURE_VERIFICATION D4. Genuine isolation needs Workers |
| Determinism holds across machines | **[Assumed]** | All tests ran on one machine. Arithmetic is integer or exact-rational, so **[Derived]** it should hold, but cross-platform CI has not run |
| No memory growth over a long session | **[Unknown]** | Queue and history are bounded by construction, but no soak test exists |

## 3. Benchmarks

Recorded 2026-08-01, Node 24, Windows, single machine. **Not** a performance
target — a baseline so a later optimisation can be judged against a number.

| Operation | Throughput | Per-unit |
|---|---|---|
| Command enqueue + dispatch | 10,102/s per 100 | **~1.0 µs/command** |
| Command replay (no queue) | 190/s per 10,000 | **~0.53 µs/command** |
| Empty scheduler frame | 19.9 M/s | ~50 ns |
| Frame, 10 stages | 11.4 M/s | ~88 ns |
| Frame, 100 stages | 612 K/s | ~1.6 µs |
| Events, 1,000 / 1 subscriber | 37.6 K/s | ~27 ns/event |
| Events, 1,000 / 10 subscribers | 16.0 K/s | ~62 ns/event |
| Coalesced, 1,000 → 16 keys | 39.9 K/s | ~25 ns |
| Signals, 1,000 / 3 subscribers | 41.9 K/s | ~24 ns |
| Canonicalise 500-variable state | 216 K/s | ~4.6 µs |
| Hash 500-variable state | 189 K/s | ~5.3 µs |
| `clock.step` | 26.4 M/s | ~38 ns |
| `clock.advanceTo` | 2.89 M/s | ~346 ns |
| `toTimecode` (drop-frame) | 9.2 M/s | ~109 ns |
| **Steady-state tick** | 2,111/s per 1,000 | **~0.47 µs/tick** |
| Tick + 100 commands | 9,350/s | ~107 µs |
| Runtime reset | 8,940/s | ~112 µs |

**Reading:** a steady-state tick costs ~0.47 µs against a 16,600 µs budget —
about 0.003%. Command dispatch at ~1 µs means 1,000 commands in a frame would
cost ~1 ms, or 6% of budget. **[Derived]** the kernel is not a bottleneck; the
work that matters has not been written.

**Replay is ~2× faster than queue dispatch** because it skips sequence
assignment, batch pre-validation, and history retention. **[Derived]** that gap
is the queue's bookkeeping cost, which buys cancellation and atomic batches.

### Benchmark-driven fix

`tick()` computed a state hash on every frame regardless of whether anyone read
it, and canonicalisation cost scales with variable count. Deferring it behind a
lazy getter made steady-state ticking **6.7× faster** (3.16 µs → 0.47 µs).

**[Proven]** by before/after measurement. Found by benchmarking, not review —
every test passed both before and after.

## 4. Gaps requiring work in later phases

| # | Gap | Phase |
|---|---|---|
| V1 | I4 needs a lint rule once application packages exist | 2.6+ |
| V2 | Cross-platform determinism needs CI on a second architecture | 2.4 |
| V3 | Memory soak test — 60 minutes of ticking, asserting bounded growth | 3 |
| V4 | Chunking compliance once real subsystems register | 2.4+ |
| V5 | Frame budget under real load | 3 |

## 5. Conclusion

**[Proven]** The runtime is deterministic under replay, isolated from document
state, monotonic in show time, and ordered explicitly rather than incidentally.
Twenty-six invariants are executable; five are Unknown pending subsystems that
do not exist; one is Disproven and documented rather than claimed.

**[Unknown]** whether it is fast enough, because nothing real runs on it yet.
