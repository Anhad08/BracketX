# Phase 6 — Verification

**Date:** 2026-08-02 · **Subject:** Time & Animation, completed
**Verdict:** **VERIFIED.** Every ROADMAP_V2 Phase 6 requirement has an executing
assertion, and the requirement-to-evidence mapping is
[PHASE_6_REQUIREMENT_TRACE.md](./PHASE_6_REQUIREMENT_TRACE.md).

| Label | Meaning |
| --- | --- |
| **Proven** | Demonstrated by an executing test or measurement here |
| **Derived** | Follows from something Proven, plus a stated argument |
| **Assumed** | Believed, not tested; the risk is stated |
| **Unknown** | Cannot be established here; what would establish it is stated |

---

## 1. Reproduce

```
pnpm turbo run check-types lint test build      34/34
node tools/check-boundaries.mjs                 exit 0

@bracketx/engine-scene       126 tests
@bracketx/engine-runtime     137 tests
@bracketx/engine-reconciler   71 tests
@bracketx/engine-host        184 tests   (35 of them Phase 6)
showcase                     324 tests
showcase e2e                  33 tests   (4 of them Phase 6)

pnpm --filter @bracketx/engine-host bench      §4
```

---

## 2. The five requirements

### R1 — One timeline model. **Proven.**

The claim is not "these share an interface" — that is cheap and unfalsifiable.
The claim is **they cannot disagree about what time it is**, and that is what is
asserted:

- One playhead calculation. `cursorSeconds` is the only place
  `(frame − startFrame) × speed / rate` appears; `Animator.#secondsFor`
  delegates to it. `frameForSeconds` is its inverse, asserted round-trip.
- One player. An authored clip and an ad-hoc timeline are played together and
  their `ClipState.seconds` asserted **equal to ten decimal places**, having
  taken entirely different routes into the animator.
- Ordered, addressable, typed positions: markers sort at load, resolve by id,
  carry a free-form `kind` and a payload. Two markers with one id are **refused**
  — addressable means addressable.

**Sequencing readiness, Proven rather than promised:** a `cue` marker and an
`event` marker sit on one timeline; `crossedMarkers(..., "cue")` returns only the
cue, `crossedEvents` only the event, and an unfiltered call returns both in time
order. That is the Phase 9 contract, executing today.

### R2 — Delay and stagger. **Proven.**

Delay shifts a track without shifting the timeline. Stagger fans one track
across a collection's instances in four directions, with either a per-instance
`interval` or a fixed `total` — and the `total` form is the one data-driven
content needs, asserted to hold the same 0.6s spread across 4 rows and 40.

Three properties matter more than the feature:

**Identity is untouched.** Ninety frames of a staggered reveal are stepped with
`nodesCreated` and `nodesDestroyed` asserted zero on *every* frame, and the
mirror size asserted unchanged. Stagger shifts sample time, never a node id.

**Order is the collection's, not the mirror's.** Instances of one template share
the template's order key and the mirror breaks that tie by insertion — which
measured out as exactly **reversed**. A stagger driven by mirror child order
would have run bottom-to-top and looked like a design choice. `#instancesOf`
reads the collection and applies the engine's own exported `identityOf`.

**Completion is at the span, not the duration.** A staggered track is still
moving after the nominal duration. `timelineSpan` is Proven to report
0.5 + 0.75 = 1.25s for a 0.5s timeline staggered across four instances, the
clip is Proven still playing past the duration, and Proven held at the end of the
span with the **last** row at its final value.

### R3 — Declared state transitions. **Proven.**

`hidden → visible` and `warning → success` resolve, compile, and animate. Neither
name is privileged — that is the ROADMAP_V2 exit criterion, asserted directly.

**A transition is a timeline**, and the test asserts that literally: the
compiled object passes `validateTimeline`, and after `setStates` the animator
reports exactly one playing timeline, marked transient.

Two behaviours worth their own assertions:

- **Visibility holds across the transition, in both directions.** Going out, the
  first keyframe is `true` with `step` easing and the last is `false` — the node
  stays visible for the animation and disappears when it finishes. Going in, the
  first keyframe is already `true`. A midpoint step would blink a graphic out
  halfway through its own exit.
- **A completed transition is released, not held.** Its end values are what the
  state already produces, so holding would pin a duplicate on top of itself
  forever. Asserted: after the transition, `animator.playing` is empty and no
  `transition_*` timeline remains registered.

Backwards compatibility is Proven: a scene with no declared transition cuts
exactly as it did before Phase 6.

### R4 — Late join converges. **Proven, four ways, on a fingerprint.**

The audit found this **Derived but untested**. It is now compared as a single
string containing the frame, the session hash, every animated value, and every
node's full world matrix — because a test that compared one property would pass
while everything else diverged.

| Route | Result |
| --- | --- |
| Played to frame N vs seeked to frame N | identical |
| Running session vs one joining mid-flight | identical |
| Live command sequence vs `replay` of it | identical |
| Same, for a **staggered** timeline | identical |

The staggered case is the one that matters: per-instance offsets are exactly
where a naive implementation would accumulate.

**Also Proven:** seeking across three markers fires none of them, while playing
across one fires it. Dragging a timeline must not trigger every cue in a show.

### R5 — Reconciliation. **Proven by document and by test.**

`SCENE_FORMAT §10` is rewritten to the implemented model, with §10.5 recording
the three things the old state-bound model could not express. **F3 is closed**:
states are author-defined.

The fossil is gone. `validate.ts` no longer ends its state block with
`void stateIds;` — state names are validated, duplicates refused, and
transitions checked against declared states. `SceneState.duration` now carries
the meaning the original §10 example implied.

---

## 3. What the browser proved that headless could not

Four scenes are permanent verification assets. One of them found a real defect
that no headless test would have:

> **A staggered reveal computed perfectly and did not move.**

A laid-out child takes its position from its container, so animating
`transform.position` on it produces correct values that the layout then
overrides. The animation was real and invisible. There is now a headless test
asserting **both facts at once** — the value is `-2` and the world matrix is `0`
— so the next person reads it instead of rediscovering it.

Browser-Proven: rows arrive in collection order top-to-bottom; a transition
appears on the same ruler as a clip and clears when it completes; the timeline
shows `+0.3s` for a delayed track and `stagger` / `span` for a staggered one;
seeking to frame 3,600 lands on 3,600 with the clock paused.

---

## 4. Measured

One machine, mock backend. **Published values only** — nothing below is an
estimate.

### The frame, for comparison

| | mean |
| --- | --- |
| 100 rows, unstaggered clip | 0.0026 ms |
| 2,000 rows, unstaggered clip | 0.0025 ms |

### Stagger — on the sampled path

| | mean | p99 |
| --- | --- | --- |
| Frame with a staggered track, 100 instances | 0.041 ms | 0.287 ms |
| Frame with a staggered track, 1,000 instances | 0.433 ms | 4.06 ms |
| Frame with a staggered track, 5,000 instances | 3.355 ms | 12.02 ms |
| `sampleTimeline` alone, 5,000 instances | 0.798 ms | 3.74 ms |
| One stagger offset | 0.0001 ms | 0.0001 ms |
| `timelineSpan`, closed form | 0.0001 ms | 0.0002 ms |
| 8 staggered tracks over 1,000 instances | 0.688 ms | 1.26 ms |

**Read this honestly.** A staggered track is O(instances) per frame, and that is
inherent: 5,000 rows each at a different point in their slide is 5,000 nodes that
genuinely moved. Of the 3.355 ms at 5,000 instances, **0.798 ms is sampling** and
the rest is the projection of 5,000 dirty nodes — a cost any implementation pays.

At 1,000 instances a staggered reveal is **2.6% of a 16.67 ms frame**. At 5,000
it is **20%**, and 5,000 simultaneously animating rows is not a scene anyone
ships. A staggered timeline that is not playing costs **zero**.

Two things were made cheap deliberately, because both are on the sampled path:
`staggerMax` is closed-form rather than a loop over instances, and the host
memoises `instancesOf` for the duration of one sample — `sampleTimeline` asks
once per staggered track and `timelineSpan` asks again, so an unmemoised
resolver rebuilt a 5,000-element id list twice per track per frame. That change
alone took the 5,000-instance frame from 3.84 ms to 2.81 ms in the run that
measured it.

### Transitions — the state-change path, not the frame path

| | mean |
| --- | --- |
| Resolve a transition (10 or 200 stateful nodes) | 0.0003 ms |
| Compile a transition, 10 stateful nodes | 0.029 ms |
| Compile a transition, 200 stateful nodes | 0.619 ms |
| Sample a compiled transition, 10 stateful nodes | 0.0022 ms |
| Sample a compiled transition, 200 stateful nodes | 0.037 ms |
| `setStates` end to end, 200 stateful nodes | 2.93 ms |

Resolution is O(rules) and free. Compilation is O(stateful nodes × changed
properties) and happens **once per state change**, not per frame. Sampling — the
part that does run every frame — is 0.037 ms for 200 animating nodes.

`setStates` at 2.93 ms is dominated by the full `rebuild` that state changes
already did before Phase 6; compilation is 0.619 ms of it. **Derived:** a state
change on a 200-node scene costs about a fifth of a frame, once.

### Seeking and late join

| | mean |
| --- | --- |
| Seek, 1,000 rows, unstaggered | 0.039 ms |
| Seek, 1,000 rows, staggered | 0.420 ms |
| Late join at frame 3,600, 100 rows | 0.857 ms |
| Late join at frame 3,600, 1,000 rows | 8.43 ms |

Late join measures **everything**: construct a host, load the document, cue the
timeline, seek 3,600 frames, render one frame, dispose. There is no warm-up term
in it because there is no warm-up — seeking to frame 3,600 costs the same as
seeking to frame 1.

### Scaling

| | mean |
| --- | --- |
| Sample 200 tracks | 0.024 ms |
| Sample a 600-keyframe track | 0.0002 ms |

A ten-second clip keyed every frame samples in 0.2 µs. The binary search holds.

---

## 5. Limits

| Claim | Status | What would establish it |
| --- | --- | --- |
| Timings hold on other hardware | **Assumed** | Runs elsewhere. Ratios should hold; absolutes are one machine's |
| A looping timeline whose stagger outruns its duration | **Known limitation, documented** | It wraps on `duration`, so the tail is cut. SCENE_FORMAT §10.2 states the span rule; validation does not yet refuse the combination |
| Per-property transition timing | **Not built** | No consumer has asked. `StateTransition` carries one duration and easing |
| Phase 9 extends rather than replaces the model | **Derived** | The cue kind, the filter and the cursor are Proven to work today; that Phase 9 *uses* them cannot be Proven before Phase 9 exists |
| Stagger at 100,000 instances | **Unknown** | Measured to 5,000. It is O(instances) by construction, so 100,000 would be ~67 ms — well past a frame, and a scene nobody has |
| Transition compilation on a very large stateful scene | **Measured to 200 nodes** | 0.619 ms. Linear, so 2,000 would be ~6 ms once per state change |

---

## 6. Assessment

The audit found R1 unbuilt, R2 and R3 half-built, R4 untested and R5 divergent.
All five are now closed, with a requirement-to-evidence table that did not exist
before and whose absence is the reason the gaps survived a phase.

Two defects surfaced during the work and both are recorded as tests rather than
as prose: mirror child order is **reversed** for equal order keys, which would
have made every staggered reveal run backwards; and **layout owns position**, so
animating a laid-out child is real and invisible. Neither was in the requirement
list. Both would have shipped.

**Verdict: VERIFIED.** There is exactly one timeline model, five readers of it,
and no second timeline abstraction anywhere in the project.
