# Roadmap v2 — Capability-Oriented

**Status:** Supersedes ROADMAP.md Phases 3–16 · **Date:** 2026-08-01
**Unchanged:** Phases 0, 1, 2 and all completed work. **Do not re-plan completed phases.**
**Source:** [PROJECT_ALPHA_REVIEW.md](./PROJECT_ALPHA_REVIEW.md)

Every phase is now labelled **ENGINE** (a capability) or **APPLICATION**
(product, business, or content). Estimates carry over unless the scope changed;
where it did, the delta is stated.

---

## Completed

| | | |
| --- | --- | --- |
| Phase 0 | Foundation | ✅ |
| Phase 1 | Assets | ✅ |
| Phase 2 | Scene Engine (2.1–2.6) | ✅ — renders its own format to verified pixels |
| Phase 3 | Rendering & Outputs | ✅ — `1436938` |
| Phase 4 | Composition | ✅ — `a8275a9`, `beb1f75` |
| Phase 6 | Time & Animation | ✅ — `6ec5f29`, completed 2026-08-02 |
| Phase 7 | Live Control | ✅ — `6b4338d` |
| P-001 | Scene performance | ✅ |
| R-001 | Traversal depth ceiling | ⏳ open, scheduled pre-release |

> **Numbering warning.** Commit `6ec5f29` is titled *"Phase 5 — animation"* using
> the numbering of the superseded `ROADMAP.md`, where Phase 5 was the Animation
> Engine. Under **this** roadmap that work is **Phase 6**. ROADMAP_V2 Phase 5
> (Authoring Surface) has not been started — correctly; it is the application
> layer Studio will be.
>
> The mislabel is not itself harmful. What it hid is: the work was checked
> against old Phase 5's exit criteria rather than this phase's, and the
> difference is exactly what is missing. See
> [PHASE_6_AUDIT.md](./PHASE_6_AUDIT.md).

---

## Phase 3 — Rendering & Outputs · **ENGINE** · *was: Rendering Engine*

**4–6 weeks** (down from 6–9 — most of the original scope landed in 2.5/2.6)

**Capability:** frames are produced deterministically and delivered to an output
the engine does not choose.

- **Output abstraction** — `bindOutput` / `unbindOutput`; one scene, many
  outputs. Resolution, alpha mode, and cadence belong to the output.
- **One implementation:** `canvas`. The token-authenticated URL that OBS consumes
  becomes a *configuration of `canvas`*, not the design centre.
- Sustained-load harness: zero dropped frames over 60 minutes, flat memory.
- Malformed scene renders nothing. Never a stack trace on an output.

**Exit:** a scene renders to two outputs of different resolutions simultaneously,
correctly, from one document.

---

## Phase 4 — Composition · **ENGINE** · *new, extracted from old Phase 7*

**5–7 weeks**

The largest new engine work in the roadmap, and the reason old Phase 7 dissolves.

- **Collections & instancing** — a repeated sub-scene driven by a collection.
  Rosters, brackets, tickers, leaderboards, agendas, playlists are all this.
- **Scene composition** — a scene may contain another scene. Required by
  instancing and by templates.
- **Templates** — typed, declared parameters; instantiate into a scene.
- **Design tokens** — scoped named values, implemented as variables at workspace
  scope, **not** as a second resolver.
- **Layout** — anchors, fit, clip. Minimal. Not a constraint solver.

**Exit:** a 16-entry list renders from a 16-item collection and one template ·
changing the collection to 8 items updates without rebuilding the scene · a
template instantiated at two output resolutions anchors correctly.

> Additive to `SCENE_FORMAT` under §13 rule 4 — no version bump. If instancing
> proves non-additive, stop and file an ADR-013 finding.

---

## Phase 5 — Authoring Surface · **APPLICATION** · *was: Scene Editor*

**In progress.** Shipping as **Streamatrix Studio**. The shared-runtime and
operation-log-undo rules are unchanged and remain non-negotiable.

Only correction: the frame guide derives from `world.output`, never a hardcoded
1920×1080.

| | | |
| --- | --- | --- |
| Studio Phase 1 | The engine's first editor — document store, selection, viewport, file management | ✅ 2026-08-02 |
| Studio Phase 3A | Authoring — timeline, keyframes, presets, arrange, templates, Preview/Program | ✅ 2026-08-02 |
| Studio Phase 3B | **Text engine** — blocked on T2/T3/T4 | ⛔ [IF-003](./IMPLEMENTATION_FINDING_IF-003.md) |
| Studio Phase 3C | The six official templates | ⛔ needs 3B |
| — | 3D viewport | ⏳ after 3B |

> **The timeline UI binds to the model Phase 6 froze** — no second abstraction.
> `cursorSeconds` is the one playhead calculation, and Studio's editor derives
> from it, which is what "one timeline" means operationally.
>
> **Phase 3A found a Phase 2 bug the amendment's own tests could not see:**
> lights were created and never attached, because `MirrorGraph.setAttachment`
> had no `light` case. Predicted by IF-003 §6 and caught the first time a light
> was authored through a **document**. Fixed, with the regression asserted at the
> backend rather than at the mirror. See
> [IMPLEMENTATION_REPORT_STUDIO_PHASE_3.md §3](./IMPLEMENTATION_REPORT_STUDIO_PHASE_3.md).

---

## Phase 6 — Time & Animation · **ENGINE** · *was: Animation Engine*

**6–8 weeks · ✅ COMPLETE.** Partially delivered by `6ec5f29`; audited
2026-08-02 ([PHASE_6_AUDIT.md](./PHASE_6_AUDIT.md)) and completed the same day
([PHASE_6_COMPLETION_REPORT.md](./PHASE_6_COMPLETION_REPORT.md)).

| | Requirement | Status |
| --- | --- | --- |
| R1 | **One timeline model** — ordered addressable positions with typed events. Animation and Phase 9 sequencing are two readers of it, not two timelines. | ✅ `engine-scene/timeline.ts`. One playhead calculation, shared by every reader |
| R2 | Property interpolation, easing, duration/**delay**/**stagger**. | ✅ including stagger direction, per-instance interval or fixed total, and collection fan-out with identity preserved |
| R3 | **Named states with declared transitions.** | ✅ a transition compiles to a `Timeline` and runs on the same player as a clip |
| R4 | Deterministic playback; late-join settles to a correct state. | ✅ Proven four ways on a full-state fingerprint |
| R5 | **Exit:** a scene using state names other than in/idle/out animates correctly. | ✅ `transitions` scene: `warning → success` |

`SCENE_FORMAT §10` is reconciled to the implemented model and **F3 is closed**
(states are author-defined). Evidence:
[PHASE_6_REQUIREMENT_TRACE.md](./PHASE_6_REQUIREMENT_TRACE.md) — every
requirement points at implementation, tests and benchmarks.

> **The rule this phase leaves behind.** There is exactly one timeline model.
> Animation playback, state transitions, sequencing, the Studio timeline and
> replay are all readers of it. Future phases may **extend** it; none may
> replace it or add a second.

---

## Phase 7 — Live Control · **ENGINE + APPLICATION** · *was: Live Production*

**7–9 weeks.** Scope unchanged. Highest remaining technical risk; keep it here.

Engine: control transport, state machine (queued → active → inactive),
reconnection, **telemetry**. Application: the control surface UI, which stays
dense, keyboard-driven, and unambiguous — Principle 1 requires it.

Vocabulary generalised (*activate* / *deactivate* / *advance*); the application
may still say "on air" to operators, because that is what operators say.

---

## Phase 8 — Authoring API · **ENGINE** · *extracted from old Phase 8*

**2–3 weeks**

Programmatic, validated document construction through operations. Already exists
in embryo (operations, `SceneHost.apply`, `validateDocument`); this names it,
stabilises it, and tests it as a public contract.

Clients: AI, importers, automation, marketplace install, migrations.

**Exit:** a scene built entirely through the API is byte-identical to the same
scene authored in the editor · an invalid construction fails visibly and leaves
existing work untouched.

---

## Phase 9 — Sequencing · **ENGINE** · *was: Automation (moved earlier)*

**4–6 weeks** (down from 6–8 — the timeline exists, verified 2026-08-02)

> **Estimate restored.** The audit found this discount resting on a timeline
> that had not been built. Phase 6 R1 delivered it, so the discount stands.
>
> **Phase 9 extends the model; it does not replace it.** `MARKER_CUE` is
> reserved, `crossedMarkers(..., kind)` filters, and `cursorSeconds` is the one
> playhead calculation — all executing today, asserted by
> `timeline.test.ts` → *lets two readers share one timeline without seeing each
> other*. A second timeline abstraction is the one outcome R1 exists to prevent.

Cue sequences over the Phase 6 timeline. Triggers: time, data condition, manual.
Conditional logic. Dry-run.

Moved ahead of launch because a cue sequence is the difference between a
graphics tool and a production system, and it is cheap once the timeline exists.

**Exit:** a full sequence executes from one cue · dry-run reports without
touching an output · any automated action is manually overridable instantly.

---

## Phase 10 — Content Packs · **APPLICATION** · *was: Graphics Components*

**4–6 weeks** (down from 5–7 — these are now templates, not engine code)

- `packs/broadcast` — lower-third, scoreboard, ticker, timer, roster
- `packs/tournament` — bracket

Built from Phase 4 composition primitives. **No engine code.** If a pack cannot
be expressed in templates, collections, and layout, that is a gap in Phase 4 and
must be reported as one rather than patched with engine code.

**Exit:** a complete graphics package built from packs alone in under 30 minutes
· every pack is data, verified by the boundary checker.

---

## Phase 11 — AI Authoring · **APPLICATION** · *was: AI v1* · **cuttable**

**3–4 weeks** (down from 4–6 — the Authoring API carries the weight)

Prompt → scene, through the Phase 8 Authoring API, composed from Phase 10 packs,
respecting tokens. Cut criterion unchanged. Cutting it now costs the application
feature only, not a capability.

---

## Phase 12 — Public Launch · **APPLICATION**

**5–7 weeks.** Unchanged.

One recommendation: of the three external teams required before launch, aim for
**two different verticals**. That is the "two real consumers" test §13 demands,
obtained for free.

---

# Post-launch — demand-selected

## Phase 13 — Data Sources · **ENGINE + packs** · *was: Integrations*
**6–8 weeks.** Adapter contract writing variables; push and pull; declared
staleness; degrade to last-known-good, never blank. Concrete providers ship as
connector packs.

## Phase 14 — Collaboration · **ENGINE**
**8–10 weeks.** Unchanged. Builds on the operation log as designed.

## Phase 15 — Extensions · **ENGINE** · *was: Plugin SDK*
**8–10 weeks.** Four extension points in order: content packs · data adapters ·
**output targets** · panels. Ship 1–3; defer panels until content and data
demonstrably cannot serve the need — Principles 2 and 4 hold longer that way.

## Phase 16 — Marketplace · **APPLICATION**
**6–8 weeks.** Unchanged. Explicitly outside the engine.

## Phase 17 — Stream Output · **ENGINE** · *split from Cloud Platform*
**4–6 weeks.** A `stream` output implementation: encode and transport. Verifiable
against the existing headless host.

## Phase 18 — Cloud Operations · **PLATFORM** · *split from Cloud Platform*
**8–10 weeks.** Orchestration, autoscaling, metering, multi-region. **Demand-
gated**, exactly as the original text insisted.

## Phase 19 — Enterprise · **PLATFORM**
**8–10 weeks.** Unchanged. Demand-gated.

---

## Deferred, recorded, not scheduled

**Media / video as a first-class type.** Needed by concerts and virtual
production; wanted by nobody currently on the roadmap. Comparable in size to the
text engine (decode, sync, colour). Revisit when a customer asks. Until then,
those two verticals are honestly marked incomplete in
[PROJECT_ALPHA_REVIEW §7](./PROJECT_ALPHA_REVIEW.md).

---

## What changed at the top line

| | Old | New |
| --- | --- | --- |
| Engine phases before launch | 3 | **6** |
| Application phases before launch | 6 | **4** |
| Broadcast nouns in engine phases | 11 | **0** |
| Weeks to launch | ~44 | ~45 |

The schedule is essentially unchanged. The work moved between layers rather than
growing: Phase 4 (Composition) absorbs what Phase 7 was going to hand-build, and
Phase 10 shrinks because content packs are data.
