# Phase 6 — Requirement Trace

**Date:** 2026-08-02 · **Source of requirements:** `ROADMAP_V2.md` § Phase 6
**Rule:** every requirement points at implementation, tests, and — where it is on
a hot path — a benchmark. **No requirement may remain implied.**

This document exists because of the process finding in
[PHASE_6_AUDIT.md §4](./PHASE_6_AUDIT.md): three requirements went unbuilt for a
phase, and the reason nobody noticed is that nobody had written this table.

---

## Legend

| | |
| --- | --- |
| **Impl** | The file and symbol that does the thing |
| **Test** | The executable assertion. `timeline.test.ts` blocks are named after the requirement |
| **Bench** | The measurement, where cost matters. `—` means not on a hot path |
| **Scene** | The permanent visual verification asset |

All test paths are relative to `packages/engine-host/src/` unless stated.
All scene paths are `apps/showcase/src/scenes/timeline.tsx`.

---

## R1 — One timeline model

> *"Ordered addressable positions with typed events. Animation and Phase 9
> sequencing are two readers of it, not two timelines."*

| Sub-requirement | Impl | Test | Bench |
| --- | --- | --- | --- |
| The model itself | `engine-scene/timeline.ts` → `Timeline`, `TimelineTrack`, `TimelineMarker` | `R1 · one timeline model` | — |
| **Ordered** positions | `normalizeTimeline` sorts markers at load | `carries ordered, addressable, typed positions` | — |
| **Addressable** positions | `TimelineMarker.id`, `markerAt` | same, plus `refuses two markers with one id` | — |
| **Typed** positions | `TimelineMarker.kind`, `MARKER_EVENT`, `MARKER_CUE` | `lets two readers share one timeline without seeing each other` | — |
| One playhead calculation | `cursorSeconds`, `frameForSeconds`; `Animator.#secondsFor` delegates to it | `uses one playhead calculation for every reader` | — |
| One player for every kind | `Animator.playTimeline`; `SceneHost.setStates` uses it | `runs an authored clip and a compiled transition through the SAME player` | — |
| Clamp / wrap | `timelineTime` | `clamps or wraps, depending only on loop` | — |
| An animation clip **is** a timeline | `export type AnimationClip = Timeline` | typechecks across the workspace | — |
| Markers fire on advance only | `crossedMarkers`, half-open interval | `does not fire markers on a seek, however many it crosses` | — |
| Scaling | — | `sample 200 tracks`, `sample a 600-keyframe track` | ✅ |

**Sequencing readiness (explicitly required).** `MARKER_CUE` is reserved and
`crossedMarkers(..., kind)` filters, so a Phase 9 sequencer reads cues off the
same timeline the animator reads events off, through the same cursor. Proven by
`lets two readers share one timeline without seeing each other` — a cue and an
event on one timeline, each visible only to its own reader. **Phase 9 extends
the model; it adds no model.**

---

## R2 — Delay and stagger

> *"Property interpolation, easing, duration/delay/stagger."*
> Plus, from the prompt: *stagger direction, stagger intervals, collections
> without application-side code, identity preserved.*

| Sub-requirement | Impl | Test | Bench |
| --- | --- | --- | --- |
| Interpolation, easing | `engine-scene/animation.ts` (pre-existing) | `animation.test.ts` → `easing`, `interpolation` | ✅ pre-existing |
| **delay** | `TimelineTrack.delay`; applied in `sampleTimeline` | `R2 · delay` → `shifts a track without shifting the timeline` | — |
| delay validation | `validateTimeline` | `rejects a negative delay rather than sampling before the start` | — |
| **stagger interval** | `TimelineStagger.interval`, `staggerOffset` | `R2 · stagger offsets` → `offsets forward by default` | `one stagger offset` |
| **stagger total** | `TimelineStagger.total` | `derives the interval from a total, which is what data-driven content wants` | — |
| **stagger direction** | `StaggerDirection`, four cases in `staggerOffset` | `reverses`, `runs from the centre outwards and from the edges inwards` | — |
| Degenerate counts | `staggerOffset` guards | `is inert for a single instance in every direction` | — |
| **Collections, no application code** | `SampleOptions.instancesOf`; `SceneHost.#instancesOf` | `fans a track across a collection's instances with no application code` | `frame with a staggered track, 100 / 1,000 / 5,000 instances` |
| **Identity preserved** | stagger shifts time, never ids | `preserves identity — a staggered reveal creates and destroys nothing` | — |
| Order is the collection's | `SceneHost.#instancesOf` reads the collection, not the mirror | same test asserts row 1 leads row 2; browser test asserts it visually | — |
| Unresolved collection | fallback in `sampleTimeline` | `stays inert when the collection has not resolved yet` | — |
| Completion at the **span** | `timelineSpan`, `Animator.#spanFor`, `clampToSpan` | `finishes only when the LAST instance finishes` | `timelineSpan, closed form` |
| Stagger validation | `validateTimeline` | `refuses a stagger that declares neither an interval nor a total` | — |
| Layout interaction | — | `produces values for a laid-out child, but LAYOUT still owns its position` | — |
| Scaling | resolver memoised per sample | — | `8 staggered tracks over 1,000 instances` |

**Scenes:** `stagger` (direction, total, row count), `delay` (three delays on one
timeline).

---

## R3 — Named states with declared transitions

> *"The engine assigns no meaning to any state name; `in`/`idle`/`out` become a
> convention of the broadcast pack."*

| Sub-requirement | Impl | Test | Bench |
| --- | --- | --- | --- |
| Named states, no privileged names | `NodeStateOverride`, `state.set` (Phase 4) | `privileges no state name` | — |
| **Declared transitions** | `engine-scene/transition.ts` → `StateTransition` | `R3 · declared transitions` | — |
| Resolution order | `resolveTransition` | `resolves a declared rule over a state default` | `resolve a transition, 10 / 200 stateful nodes` |
| `SceneState.duration` as the default | `resolveTransition` fallback | `falls back to the duration declared on the state being entered` | — |
| Explicit cut | `duration: 0` short-circuit | `cuts when nothing declares a duration` | — |
| **Compiles to a timeline** | `compileStateTransition` | `compiles a state change into a timeline, not into a second system` | `compile a transition, 10 / 200 stateful nodes` |
| Boolean handling both ways | `keyframesFor` | `holds visibility across the whole transition, in both directions` | — |
| Colour tween | `keyframesFor` + `interpolate` | `interpolates a colour a state changed` | — |
| No empty timeline | `compileStateTransition` returns null | `compiles nothing when a state change moves nothing` | — |
| **Animates automatically** | `SceneHost.setStates` | `animates automatically when the state is set, through the same player` | `setStates end to end, 200 stateful nodes` |
| Released, not held | `PlayOptions.hold`, `Animator` completion | same test | — |
| Backwards compatible | absent transitions ⇒ cut | `cuts instantly when no transition is declared, exactly as before` | — |
| Validation | `validate.ts` transitions block | `rejects a transition naming an undeclared state` | — |
| Sampling cost | — | — | `sample a compiled transition, 10 / 200` |

**Scene:** `transitions` — `hidden → visible` and `warning → success`, both
declared, neither privileged.

---

## R4 — Deterministic playback; late join settles

> *"Deterministic playback; late-join settles to a correct state."*
> Prompt: *seeking, replay, joining during playback all converge to identical
> runtime state. Do not rely on inference.*

| Sub-requirement | Impl | Test | Bench |
| --- | --- | --- | --- |
| Determinism (pre-existing) | pure sampling | `animation.test.ts` → `determinism` | — |
| **Seek == play** | `cursorSeconds`, stateless sampling | `R4 · late join converges` → `a session that PLAYED there and one that SEEKED there are identical` | `seek, 1,000 rows, unstaggered / staggered` |
| **Join mid-flight** | same | `a session JOINING mid-flight settles to the running one, with no warm-up` | `join at frame 3,600, 100 / 1,000 rows` |
| **Replay** | `SceneHost.replay` | `replaying the command sequence reaches the same state` | — |
| Converges with stagger | per-instance offsets are derived, never accumulated | `converges for a STAGGERED timeline too, where per-instance offsets could drift` | — |
| No cue storm on seek | `emitEvents` false when seeking | `does not fire markers on a seek, however many it crosses` | — |

The comparison is a **fingerprint**, not a spot check: frame, session hash,
every animated value, and every node's full world matrix, compared as one
string. A test that compared one property would pass while the rest diverged.

**Scene:** `late-join` — seek to 0 / 60 / 137 / 480 / 3600 on a looping timeline.

---

## R5 — Timeline reconciliation

> *"Resolve the divergence between SCENE_FORMAT §10 and the implementation.
> Do not leave them inconsistent."*

| Sub-requirement | Impl / Doc | Test |
| --- | --- | --- |
| §10 rewritten to the implemented model | `docs/SCENE_FORMAT.md` §10 (Timelines) | — |
| Decision recorded, with reasons | §10.5 — three things the state-bound model could not express | — |
| **F3 closed** | §15 — states are author-defined | `privileges no state name` |
| `SceneState` given a meaning | `types.ts` `SceneState.duration` = default transition seconds | `falls back to the duration declared on the state being entered` |
| `void stateIds;` fossil removed | `validate.ts` — state names validated, transitions checked against them | `rejects a transition naming an undeclared state` |
| Duplicate state names refused | `validate.ts` | covered by `validate` suite in `engine-scene` |
| New id kinds named | `ids.ts` `anm`, `trn`; §13 prefix list | `scenes.test.ts` → `builds a valid document` for `transitions` |
| §3 note corrected | `docs/SCENE_FORMAT.md` §3 | — |

---

## Requirements NOT met

None. Every line of ROADMAP_V2 § Phase 6 has an implementation and an executing
assertion above.

## Deliberately out of scope

| | Why |
| --- | --- |
| A Phase 9 sequencer | Phase 9's work. The model and the reserved `cue` kind are here; the reader is not, and building it now would be speculative. |
| Per-property transition overrides | `StateTransition` carries one duration and easing for the whole change. No consumer has asked for per-property yet, and adding it would be a guess. |
| Motion paths, physics, springs | Excluded by SCENE_FORMAT §10.2 — each breaks the determinism requirement. |
