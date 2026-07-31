# BracketX Engine Runtime

**Status:** Phase 2 design · **Authored:** 2026-07-30 · **Owner:** @Pixelborne
**Closes:** [FINAL_REVIEW](./ARCHITECTURE_FINAL_REVIEW.md) C3 (events), C4
(scheduler), C5 (memory), C6-partial (clock)
**Constrained by:** [ADR-013](./ARCHITECTURE.md#adr-013) — designs *within* the
frozen architecture, reopens nothing

> Four subsystems in one document because they are one problem: **the frame loop
> and the resources it consumes.** The clock decides when a frame happens, the
> scheduler decides what fits in it, the event system decides what may run
> inside it, and memory ownership decides what the GPU is holding while it runs.
> Designing them separately is how they end up disagreeing.
>
> The text engine is separate — [TEXT_ENGINE.md](./TEXT_ENGINE.md) — because it
> is a content pipeline, not a frame-loop concern. It consumes this document's
> budgets and eviction rules.

---

## 1. Runtime Clock

### 1.1 The problem with milliseconds

Broadcast frame rates are 25, 29.97, 30, 50, 59.94, and 60. **29.97 is not
representable in integer milliseconds** — one frame is 33.3667ms. Accumulating
that over an 8-hour event drifts by seconds.

Any engine that treats milliseconds as canonical time will disagree with a
broadcast facility's timecode, and that disagreement grows all day.

### 1.2 Canonical time is a frame number

```
Time = { frame: integer, rate: { numerator, denominator } }
```

Rates are exact rationals: `30000/1001` for 29.97, `60/1` for 60. Milliseconds
are **derived and display-only** — never accumulated, never authoritative.

Keyframe times in [SCENE_FORMAT](./SCENE_FORMAT.md) stay in milliseconds. That
is correct and requires no change: milliseconds are the right unit for
*authoring* an animation ("600ms reveal"), and the evaluator converts frame →
ms at lookup. Authoring units and clock units are different concerns, and
conflating them is what produces drift.

### 1.3 Two clocks, deliberately separate

[FINAL_REVIEW C6](./ARCHITECTURE_FINAL_REVIEW.md#c6--timeline-is-under-designed-multi-output-sync-is-absent)
found these conflated. They have different semantics and one abstraction over
both will leak.

| | Scene time | Show time |
|---|---|---|
| Meaning | Position within an animation state | Position within a live production |
| Seekable | **Yes**, any direction | **Forward only** |
| Origin | State entry | Show start / external reference |
| Used by | Editor scrubbing, animation evaluation | Live playback, cue timing, timecode |
| Monotonic | No | **Yes** |

Animation evaluates against **scene time**. Live playback advances **show time**
and derives scene time from state-entry points. The editor drives scene time
directly and has no show time at all.

### 1.4 Clock sources

The engine never reads `Date.now()`, `performance.now()`, or a
`requestAnimationFrame` timestamp. A `Clock` is **injected**, and this is what
makes the same engine serve four runtime targets:

| Source | Target | Behaviour |
|---|---|---|
| `RafClock` | Browser, live | Snaps rAF timestamps to the nearest output frame |
| `FixedStepClock` | Cloud, offline | Frame counter; runs faster or slower than realtime |
| `ScrubClock` | Editor | Seeks arbitrarily, including backward |
| `ExternalClock` | **Reserved** — genlock, SMPTE timecode | Frame authority comes from hardware |

`ExternalClock` is reserved as an *interface*, not a phrase. Designing the clock
so authority can move outside the process is the whole reason this section
exists before implementation rather than after.

### 1.5 Frame quantisation

**Raw rAF timestamps are never used directly.** They are snapped to the output
frame grid.

Without this, frame N arriving at 16.683ms versus 16.667ms produces different
animation state, and rendering "the same frame" twice gives different results.
Broadcast is frame-based; treating time as continuous imports jitter the format
does not have.

### 1.6 The delta-time prohibition

> **No code in the engine may use delta time.**

Every evaluation is a pure function of absolute time. Nothing integrates,
accumulates, or advances "by dt".

This single rule is what makes the determinism guarantee in
[ENGINE_ARCHITECTURE §4](./ENGINE_ARCHITECTURE.md#4-runtime) testable rather
than aspirational: evaluating frame N directly must equal playing forward to
frame N, and delta accumulation is the only common way to break that. It also
rules out physics and springs in animation, which
[SCENE_FORMAT §10](./SCENE_FORMAT.md#10-animation) already forbids for the same
reason.

Enforced by lint and by a golden-frame test that evaluates a scene forward,
then seeks directly, and compares state.

### 1.7 Multi-output synchronisation

Multiple outputs (programme, preview, a video wall) share **one show clock with
a declared epoch**. Each output renders the frame corresponding to the show
clock, not its own accumulated position.

**A late output skips frames; it never lags.** Rendering a stale frame to catch
up puts two outputs visibly out of step, which is worse than a dropped frame on
one.

Distributed sync — outputs on separate machines — is out of scope for v1 and is
the reason `ExternalClock` exists as an interface. It is named in
[ENGINE_ARCHITECTURE §12](./ENGINE_ARCHITECTURE.md#12-live-output) as a native
runtime concern.

## 2. Scheduler

### 2.1 Priority classes

Work is classified on submission. There are three classes and no others —
a fourth would immediately be argued about.

| Class | Contains | Guarantee |
|---|---|---|
| **P0 — on air** | Scene evaluation, draw submission for live outputs | **Never deferred, never degraded** |
| **P1 — important** | Preview outputs, atlas generation for visible text, layout invalidation | Deferred only under sustained pressure |
| **P2 — deferrable** | Asset streaming, atlas pre-warm, picking buffer, editor overlays, thumbnails | Deferred freely |

### 2.2 Chunking, because JavaScript cannot preempt

There is no preemption on the main thread. A scheduler that cannot interrupt
work can only *decline to start* it.

> **Any operation that may exceed 2ms must either run in a Worker or be
> chunked into bounded units.**

This applies to glyph rasterisation, asset parsing, scene deserialisation, and
atlas packing. It is a hard rule because a single unchunked 40ms operation drops
two frames regardless of how good the scheduler is.

### 2.3 The degradation ladder

Taken in order when the frame budget is missed for **3 consecutive frames** —
not on a single spike, which is normal.

| Step | Action | Visible? |
|---|---|---|
| 1 | Defer all P2 work | No |
| 2 | Reuse stale glyph atlases rather than regenerating | Barely |
| 3 | Halve preview output frame rate | Preview only |
| 4 | Disable optional passes — post effects, DOF | Yes, on air |
| 5 | Reduce internal render scale for **preview only** | Preview only |
| 6 | Report unable-to-sustain | Operator sees it |

**On-air output resolution and frame rate are never reduced.** Every other lever
is pulled first. A production system that quietly softens the programme feed to
stay within budget has failed at its only job.

### 2.4 Degradation is observable

Every ladder step emits an event (§3). A system silently degrading during a live
show is worse than one reporting it — the operator can make a call about a
problem they can see, and none about a problem they cannot.

## 3. Event System

### 3.1 Two channels

The constraint that shapes everything: **a handler must never be able to stall a
frame.** No browser mechanism enforces that on main-thread code, so the design
achieves it by construction — untrusted handlers are never invited into the
frame.

| | Signals | Events |
|---|---|---|
| Timing | Synchronous, inside the frame | Asynchronous, after the frame |
| Subscribers | **Engine subsystems only** | Applications, plugins, AI, editor, control surface |
| Registration | Compile-time, bounded set | Runtime, unbounded |
| Ordering | Deterministic, declared | Per-source FIFO |
| Can stall a frame | Yes — which is why the set is closed | **No** |

Applications and plugins may subscribe **only** to Events. This is the whole
mechanism behind [FINAL_REVIEW C7](./ARCHITECTURE_FINAL_REVIEW.md#c7--plugin-sandboxing-is-declared-not-designed--and-is-likely-unachievable-as-specified)'s
"plugins are declarative, not imperative".

### 3.2 Dispatch

Events raised during a frame are **queued, not delivered**. After the frame, the
queue drains within a bounded time slice; anything remaining waits for the next
frame. The queue is therefore never a source of frame overrun.

### 3.3 Back-pressure

A data feed writing a variable at 60Hz, or an operator dragging a slider,
generates events faster than anything wants to consume them.

**Coalescing by key**: last-value-wins per `(kind, subject)` within a dispatch
cycle. Twelve `variable.changed` events for `homeScore` become one carrying the
final value.

Where coalescing is not valid — state transitions, errors — the queue is
bounded and overflow is **reported, never silently dropped**. A dropped error is
a debugging session.

### 3.4 Ordering

**Per-source FIFO. No global ordering across sources.**

Global ordering is expensive to guarantee and almost never needed. Promising it
and then breaking it under load is worse than not promising it — so it is not
promised.

### 3.5 Catalogue

Events are a public API surface the moment plugins exist, so the catalogue is
typed and versioned like any other API.

| Event | Raised when |
|---|---|
| `document.changed` | A transaction is applied (carries the operation list) |
| `variable.changed` | A variable's value changes (coalesced) |
| `state.entered` / `state.exited` | An animation state transitions |
| `output.frameRendered` | An output completes a frame |
| `resource.loaded` / `resource.evicted` | Asset lifecycle (§4) |
| `budget.exceeded` / `budget.degraded` | Scheduler pressure (§2.4) |
| `error.raised` | Any recoverable engine error |

## 4. Memory Ownership

### 4.1 BracketX owns lifetime; Three.js owns allocation

A direct consequence of [ADR-012](./ARCHITECTURE.md#adr-012) that ADR-012 did
not address: our scene graph is authoritative and the Three.js object graph is a
disposable cache, so **Three.js cannot know when a resource is dead**. Disposal
is driven by us or it does not happen.

### 4.2 Handles and reference counting

Resources are referenced by **handle**, never by object identity. Handles are
reference-counted. Reaching zero makes a resource **eligible for eviction, not
immediately evicted** — switching between two scenes must not thrash the assets
they share.

### 4.3 Budgets per resource class

One global VRAM number is useless for making eviction decisions, because the
classes have different costs and different consequences.

| Class | Eviction policy |
|---|---|
| Textures | Refcount-zero, then LRU |
| Geometry | Refcount-zero, then LRU |
| Glyph atlases | LRU per page ([TEXT_ENGINE](./TEXT_ENGINE.md)) |
| Render targets | Pooled and aliased by the render graph; never evicted mid-frame |

### 4.4 On-air resources are pinned

> **Nothing referenced by an on-air output may be evicted, for any reason.**

This inverts normal engine behaviour. A game engine evicts to fit; a broadcast
engine must not, because the eviction is visible to an audience.

**When the budget is exhausted and nothing evictable remains, the engine refuses
to load and reports it.** Failing to bring up a new graphic is recoverable.
Blanking one that is on air is not.

### 4.5 Deterministic disposal

No reliance on garbage collection for GPU resources. Disposal happens at defined
points: scene unload, state exit plus a grace period, and explicit eviction.

A 60-minute flat-memory requirement already exists in
[RFC-003 §9](./RFC-003-rendering-architecture-3d.md#9-performance) with nothing
enforcing it. **A leak test now runs in CI**: a simulated hour of scene changes
and text updates, asserting bounded growth in both heap and GPU handle count.

## 5. Interaction between the four

The reason this is one document:

- The **clock** decides a frame is due.
- The **scheduler** admits P0 work, then P1, then P2 until the budget is spent.
- Work exceeding budget triggers degradation, which raises **events**.
- **Memory** pressure defers P2 asset streaming and can force the scheduler to
  reuse stale atlases (ladder step 2).
- Eviction raises **events** so the editor can show what was dropped.
- The **text engine** consumes all four: it is P1/P2 work, its atlases are a
  memory class, its layout is clock-deterministic, and it raises events on
  font-load failure.

## 6. Invariants

Candidates for `ENGINE_INVARIANTS.md`, each with an automated check.

| # | Invariant | Check |
|---|---|---|
| I1 | No delta time anywhere in the engine | Lint |
| I2 | No ambient time reads (`Date.now`, `performance.now`, rAF timestamps) outside a clock source | Lint |
| I3 | Evaluating frame N directly == playing forward to frame N | Golden-frame test |
| I4 | No application or plugin code registers a Signal handler | Type boundary + lint |
| I5 | No operation over 2ms on the frame thread | Runtime assertion in dev builds |
| I6 | GPU handle count is bounded over a simulated hour | CI leak test |
| I7 | On-air-referenced resources are never evicted | Runtime assertion + test |

## 7. Open items

| # | Item | Owner | Due |
|---|---|---|---|
| U1 | Frame budget split across P0/P1/P2 — needs measurement, not a guess | Engineering | Phase 3 |
| U2 | Grace period before state-exit disposal | Engineering | Phase 3 |
| U3 | Whether `ExternalClock` lands with the native runtime or earlier for testing | Engineering | Phase 6 |
| U4 | Event catalogue versioning scheme, once plugins are real | Engineering | Phase 13 |
