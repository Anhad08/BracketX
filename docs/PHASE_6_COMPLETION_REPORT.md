# Phase 6 — Completion Report

**Date:** 2026-08-02 · **Phase:** Time & Animation (ROADMAP_V2)
**Companions:** [PHASE_6_VERIFICATION.md](./PHASE_6_VERIFICATION.md) ·
[PHASE_6_REQUIREMENT_TRACE.md](./PHASE_6_REQUIREMENT_TRACE.md) ·
[PHASE_6_AUDIT.md](./PHASE_6_AUDIT.md)

The last architectural gap before Studio is closed. There is exactly one
timeline model in BracketX, and five things read it.

---

## 1. What was missing, and what closed it

| | Audit finding | Closed by |
| --- | --- | --- |
| **R1** | No timeline model. A clip sampler with untyped events. | `engine-scene/timeline.ts` — `Timeline`, `TimelineMarker`, `TimelineCursor` |
| **R2** | `stagger` appeared twice in the repo, both times in a roadmap. No `delay`. | `TimelineTrack.delay`, `TimelineStagger`, `SampleOptions.instancesOf` |
| **R3** | States named things; they could not move. | `engine-scene/transition.ts` — declared transitions **compiled to timelines** |
| **R4** | Late-join Derived, untested. | `timeline.test.ts` → `R4 · late join converges`, four routes, fingerprint comparison |
| **R5** | `SCENE_FORMAT §10` described a model nobody built. `validate.ts` ended with `void stateIds;`. | §10 rewritten, F3 closed, `SceneState.duration` given meaning, fossil removed |

---

## 2. R1 — the one timeline

A timeline is three things and nothing else:

```ts
interface Timeline {
  duration: number;                    // how long it is
  tracks: readonly TimelineTrack[];    // what it drives
  markers?: readonly TimelineMarker[]; // ordered, addressable, typed positions
}
```

A timeline with no tracks is a pure cue list. A timeline with no markers is a
pure animation. **`AnimationClip` is an alias, not a subtype** — a subtype would
become a second model the day someone added a field to one of them.

### Why "one model" is a property, not a slogan

Sharing an interface is cheap and proves nothing. The operational claim is that
five readers **cannot disagree about what time it is**, and that is enforced by
there being exactly one place the playhead is computed:

```ts
export function cursorSeconds(cursor, frame, rate): number {
  return ((frame - cursor.startFrame) * cursor.speed) / rate;
}
```

`Animator.#secondsFor` delegates to it. A compiled transition runs through
`Animator.playTimeline` — the same player, not a parallel one. Phase 9's
sequencer will call the same function. The test asserts an authored clip and an
ad-hoc timeline report identical playheads to ten decimal places having entered
the animator by different routes.

`frameForSeconds` is the inverse, which is what a Studio ruler click needs.

### Markers, and the Phase 9 seam

`kind` is a free-form string and the engine assigns meaning to none of them —
the same decision `LiveCommandRecord.source` made, for the same reason: an
engine that enumerates its readers needs extending for every new one.

`MARKER_EVENT` is what animation emits. **`MARKER_CUE` is reserved and declared
now**, so Phase 9 adds a reader rather than a model. That is asserted today: a
cue and an event share one timeline, and each reader sees only its own.

### The file split that makes it possible

`animation.ts` is the **value** layer — easing, interpolation, one keyframed
track. `timeline.ts` is the **model** layer and imports it. The dependency runs
one way: a timeline needs to interpolate, but interpolation must not need a
timeline, or the two would be circular and the next subsystem would define its
own copy of one of them.

---

## 3. R2 — delay and stagger

A staggered reveal is the most common animation in broadcast graphics, and
before this it was **not expressible over live data at all**: a collection's
instance ids do not exist until the data resolves, so there was nothing to
author a clip against.

```json
{ "target": "nod_slide", "path": "transform.position.0",
  "delay": 0.1,
  "stagger": { "total": 0.6, "direction": "forward" } }
```

`interval` is per instance; **`total` fixes the overall spread and derives the
interval**, which is what data-driven content actually needs — *reveal over 0.6
seconds* must hold whether eight rows arrive or eighty. Four directions:
`forward`, `reverse`, `center`, `edges`.

### Three decisions worth defending

**The resolver is injected.** `sampleTimeline` takes `instancesOf`; the host
supplies it from the mirror. Teaching the pure evaluator about the mirror would
have made the entire animation layer untestable without a backend.

**Order comes from the collection, not the mirror.** This is not a detail.
Instances of one template share the template's order key, and the mirror breaks
that tie by insertion — which measured out as exactly **reversed**. A stagger
driven by mirror child order would have run bottom-to-top and looked like a
deliberate design choice, which is the worst kind of wrong. `#instancesOf` walks
the collection and applies the engine's own `identityOf`, now exported so there
is one copy of the naming rule rather than three.

**Completion is at the span, not the duration.** A staggered track is still
moving after the nominal duration — the last instance starts late and takes as
long as the track does. Clamping at `duration` froze the tail of every reveal
part-way, which is what the first implementation did and what
`finishes only when the LAST instance finishes` now prevents.

---

## 4. R3 — states that move

The obvious implementation of transitions is a transition engine: a thing that
watches state changes and tweens properties. That would be a second timeline,
with a second playhead, and the two would disagree.

So a state change **compiles to a `Timeline`** and is handed to the same player
that runs clips. One playhead, one seek, one replay — and Studio can draw a
transition on the same ruler as an animation because it is the same object.

```json
"states": [{ "id": "st_visible", "name": "visible", "duration": 0.25 }],
"transitions": [
  { "id": "trn_reveal", "from": "hidden", "to": "visible",
    "duration": 0.5, "easing": "easeOutCubic" }
]
```

Resolution: a declared rule first, then `SceneState.duration` for the state being
entered, then a cut. First match in document order wins — ordering rather than
specificity scoring, because an author can reorder rules and see the result,
whereas a scoring rule has to be reverse-engineered.

### The boolean rule

Interpolable properties tween. **Booleans hold `from || to` and step at the
end.** Both halves matter:

- Going out, a node stays visible for the whole animation and disappears when it
  finishes. A midpoint step would blink the graphic out halfway through its own
  exit.
- Going in, it is visible from the first frame, or its entrance animates
  something nobody sees.

### Released, not held

A completed clip **holds** its final frame — a lower third must not snap back
off-screen. A completed transition **releases**, because its end values are
already what the state produces and holding would pin a duplicate on top of
itself forever. `PlayOptions.hold` distinguishes them, and the difference is the
one between "finished" and "cancelled".

---

## 5. R5 — the reconciliation

`SCENE_FORMAT §10` specified state-bound animation: per-node tracks carrying a
`stateId`, `t` in milliseconds from the state's start. It was never built.

**The implementation won**, and §10.5 records why — three things the state-bound
model could not express:

1. **A timeline that spans states.** An animation bound to a `stateId` cannot
   outlive the state that started it.
2. **Sequencing.** Phase 9 cues belong to no state and to no node.
3. **Staggered collections.** A track bound to one node cannot fan out across
   instances that do not exist yet.

Everything else in the section was rewritten to describe what exists. Additive
under §13 rule 4 — no version bump, and every pre-Phase-6 document still loads.

**F3 is closed:** states are author-defined and the engine privileges no name.

**The fossil is gone.** `validate.ts` used to end its state block with
`void stateIds;` — a dead binding where the linkage was meant to be. State names
are now validated, duplicates refused, and transitions checked against them.
`SceneState.duration` carries the meaning the original §10 example implied,
converted from milliseconds to seconds; nothing read it, so nothing broke.

Two id kinds were named: `anm_` for a timeline and `trn_` for a transition.

---

## 6. Two defects the work surfaced

Neither was on the requirement list. Both would have shipped.

**Mirror child order is reversed for equal order keys.** §3 above. Caught by
dumping the child list while debugging a stagger that ran backwards.

**Layout owns position.** A staggered reveal computed perfectly and did not
move: a laid-out child takes its position from its container, so animating
`transform.position` on it is real and invisible. Found by a browser test that
could not explain why nothing happened. There is now a headless test asserting
**both facts at once** — the animated value is `-2` and the world matrix is `0` —
so the next person reads it instead of rediscovering it. The showcase scene
animates a child *inside* the laid-out row, which is what a real broadcast pack
would do anyway.

---

## 7. Cost

Measured, one machine, mock backend. Full table in the verification document.

```
frame, 2,000 rows, unstaggered clip                 0.0025 ms
frame, staggered track, 1,000 instances             0.433  ms   (2.6% of a frame)
frame, staggered track, 5,000 instances             3.355  ms   (20% of a frame)
  of which sampling                                 0.798  ms
resolve a transition                                0.0003 ms
compile a transition, 200 stateful nodes            0.619  ms   (once per change)
sample a compiled transition, 200 nodes             0.037  ms
seek, 1,000 rows, staggered                         0.420  ms
late join at frame 3,600, 1,000 rows                8.43   ms   (whole construction)
```

Stagger is O(instances) per frame and that is inherent — 5,000 rows at 5,000
different points is 5,000 nodes that genuinely moved. Two things were made cheap
because they sit on the sampled path: `staggerMax` is closed-form rather than a
loop, and the host memoises `instancesOf` per sample, since `sampleTimeline` asks
once per staggered track and `timelineSpan` asks again. That memo alone took the
5,000-instance frame from 3.84 ms to 2.81 ms.

A staggered timeline that is not playing costs nothing.

---

## 8. What Studio binds to

The contract for the editor's timeline, so it is written down before the editor
exists:

| Need | API |
| --- | --- |
| Draw a ruler | `Timeline.duration`, `timelineSpan(timeline, counts)` for the true extent |
| Draw keyframes | `TimelineTrack.keyframes`, offset by `delay` |
| Draw a stagger | `TimelineTrack.stagger`, `staggerOffset(stagger, i, n)` |
| Draw markers | `Timeline.markers`, filtered by `kind` |
| Draw the playhead | `Animator.clipState(id).seconds` — never a second clock |
| Click to seek | `frameForSeconds(cursor, seconds, rate)` → `playback.seek` |
| Show transitions | same list; `Animator.isTransient(id)` distinguishes them |
| Scrub without firing cues | seeking passes `emitEvents: false` already |

The workbench's Timeline tool is built entirely on those calls, so the pattern
is not hypothetical — it is running, and it draws delay lead-ins, stagger tags
and the span today.

---

## 9. Scope

Delivered: R1–R5, four permanent showcase scenes (`stagger`, `delay`,
`transitions`, `late-join`), 35 Phase 6 headless tests, 4 Phase 6 browser tests,
22 benchmarks, and the requirement trace.

Not delivered, deliberately: a Phase 9 sequencer (Phase 9's work — the model and
the reserved cue kind are here, the reader is not), per-property transition
timing (no consumer has asked), and motion paths / physics / springs (excluded
by §10.2 — each breaks determinism).

**Studio is unblocked.** The timeline it binds to is final, measured, and the one
every other reader uses.
