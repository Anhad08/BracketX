# BracketX — Final Architecture Review

**Status:** Architecture freeze review · **Date:** 2026-07-30 · **Reviewer:** Engineering
**Scope:** every subsystem, every prior ADR and RFC
**Posture:** adversarial. Prior decisions were re-derived, not defended.

---

## 1. Executive Summary

# APPROVED WITH CHANGES

The **foundations are sound and I would not rebuild them**: 3D-first, GPU-first,
scene graph as source of truth, snapshot-at-rest with operations-in-motion,
camera as a node, adopt-the-rasterizer, and a lint-enforced replaceable render
adapter. Those decisions survive adversarial review intact and several are
genuinely strong.

**What does not survive is the assumption that the architecture is complete.**
Roughly 40% of the engine has been *declared* rather than *designed*. The
declared parts read as finished because they are written in the same confident
register as the designed parts, and that is the most dangerous property of the
current document set.

Three findings change prior decisions:

1. **The dual-path text design breaks cross-target determinism.** It is not a
   gap — it is a defect, and it invalidates a headline claim. Reverses
   [RFC-003 §7](./RFC-003-rendering-architecture-3d.md#7-text--the-largest-technical-risk).
2. **There is no production platform in the MVP.** "Browser is not the
   production platform" and "native runtime is post-launch" cannot both hold.
3. **The scope is roughly 2× what the stated team can deliver.** The
   architecture is achievable; the plan around it is not.

None of these is fatal. All must be resolved before the first production line of
engine code.

**Score: 5.3 / 10 weighted** (§8). That number reflects *completeness as much as
correctness* — undesigned is not the same as wrong, but at a freeze gate it
counts against you identically.

## 2. Critical issues — must fix before implementation

Ranked by severity.

### C1 — Text pipeline breaks determinism · **Critical** · reverses a documented decision

RFC-003 §7 specifies a dual path: Canvas2D raster-to-texture for screen-space
text, MSDF for world-space, with §7 also routing complex-script shaping through
"the platform shaper (raster path)".

**Both halves depend on the host platform's text engine, which differs across
our four runtime targets.** Chrome, OBS's CEF, a headless cloud renderer, and a
future native runtime do not share a font stack, a shaper version, or
rasterization behaviour. The same scene therefore lays out and rasterizes
differently depending on where it renders.

This directly contradicts
[ENGINE_ARCHITECTURE §4](./ENGINE_ARCHITECTURE.md#4-runtime)'s state-determinism
guarantee. Text *layout* — line breaks, fit-to-box shrink results, glyph
advances — is engine state, not pixels. If layout is platform-dependent, a
cloud-rendered graphic can break to two lines where the operator's preview
showed one. That is an on-air failure produced by architecture.

**Resolution — own the entire text pipeline, single path:**

```
font binary (WOFF2/TTF)
   → our parser (glyph outlines, metrics, GPOS/GSUB tables)
   → HarfBuzz (WASM) for shaping — one version, shipped with us
   → our SDF/MSDF rasterizer → dynamic atlas
   → geometry + atlas texture → render adapter
```

No platform text engine anywhere. Identical on every target because every
component ships with us.

This is **simpler than what it replaces** — one pipeline instead of two, one
selection rule fewer, one class of cross-target bug eliminated. It is also the
approach `troika-three-text` already validates
([RENDER_ENGINE_EVALUATION §5](./RENDER_ENGINE_EVALUATION.md#5-text--the-deciding-criterion)):
it parses fonts directly rather than delegating to the browser, which is
precisely *why* it works.

**Cost:** we lose platform hinting at small sizes. Acceptable — broadcast text is
large by definition, and grayscale AA is already forced by transparent output.

### C2 — No production platform exists in the MVP · **Critical** · contradiction

The current decision list holds simultaneously:

- "Browser is an editor/runtime target, **not the production platform**"
- "Native runtime **reserved**" (i.e. not built, post-launch)

If both are true, **BracketX has no production platform at launch.** The MVP
ships an authoring tool whose only output is a target we have declared
insufficient for production.

**Resolution — pick one, explicitly:**

| Option | Consequence |
|---|---|
| **(a) Browser via OBS browser source *is* the v1 production platform** | Honest, achievable, matches how the first hundred users will actually work. Requires retracting the "not the production platform" statement for v1. **Recommended.** |
| (b) Pull the native runtime into MVP | Architecturally purer, adds 6–12 months and a C++/native skillset the team does not have |

Recommend (a), stated plainly in the roadmap: *the browser is the production
platform for v1; native output is what makes BracketX a broadcast-facility
product, and it is post-launch.* Ambiguity here produces a positioning claim
engineering cannot support.

### C3 — The Event System does not exist · **High**

Referenced once, in
[ENGINE_ARCHITECTURE §13](./ENGINE_ARCHITECTURE.md#13-engine--application-separation),
as "Events — subscribe to engine state changes." That is a bullet, not a design.

Every subsystem needs it and none can proceed without it: applications react to
state, the control surface reflects on-air changes, automation triggers on
conditions, AI observes results, plugins extend behaviour, and the editor
invalidates views.

**Required design:** a typed event bus with declared event kinds, synchronous
in-frame delivery separated from asynchronous out-of-frame delivery, explicit
ordering guarantees, and back-pressure. The critical constraint: **an event
handler must never be able to stall a frame.** Handlers registered against the
frame loop run in a bounded budget or are deferred.

Without this, every subsystem invents its own callback pattern and they will not
compose.

### C4 — No frame budget or degradation policy · **High**

The runtime is specified as a pure function of `(document, variables, time)`,
which is correct and valuable. It says nothing about **what happens when a frame
does not fit in 16.6ms.**

For a broadcast system this is the difference between a graceful and a visible
failure. A production engine must degrade deliberately: skip non-essential
passes, reduce atlas regeneration, defer asset streaming, drop editor overlays —
and never simply miss the frame.

**Required design:** a scheduler with work classified by priority (on-air
critical / important / deferrable), a per-frame budget, and a documented
degradation ladder. Plus the honest counterpart: **degradation must be
observable**, because a system quietly dropping quality during a live show is
worse than one that reports it.

### C5 — Memory and GPU resource lifetime is unowned · **High**

Addressed in one line ("the engine must know an asset's cost and be able to
evict"). For 8-hour events this is where the system actually fails.

Unspecified: who owns a GPU buffer's lifetime; when atlases evict and by what
policy; how textures are reference-counted across scenes; what happens when VRAM
is exhausted mid-show; whether unloading is deterministic or GC-driven.

Three.js manages GPU resources but **will not know our lifetimes** — our scene
graph is authoritative and its objects are a disposable cache, so disposal is
ours to drive. This is a direct consequence of ADR-012 that ADR-012 did not
address.

**Required design:** explicit ownership with reference counting, a documented
eviction policy per resource class, a hard VRAM budget with defined
over-budget behaviour, and a leak test in CI — the 60-minute flat-memory
requirement already exists but nothing enforces it.

### C6 — Timeline is under-designed; multi-output sync is absent · **High**

~15 lines across two documents for a subsystem the review correctly names as
core. Four specific gaps:

1. **Two clocks are conflated.** Authoring time (scrubable, seekable,
   deterministic) and show time (monotonic, live, un-rewindable) have different
   semantics. One abstraction covering both will leak.
2. **Timecode is "reserved" without a design.** SMPTE timecode is not a clock
   source you add later — it changes the frame loop's authority. Reserve the
   *seam*, not the phrase.
3. **Multi-output synchronisation is entirely absent.** Two render surfaces
   showing the same animation must agree to within a frame. This is a hard
   distributed-timing problem and nothing in the architecture addresses it.
4. **Genlock implications are unexamined.** Broadcast frame timing is driven by
   external reference, not `requestAnimationFrame`.

Items 3 and 4 are the ones that decide whether BracketX is a broadcast product
or an overlay tool.

### C7 — Plugin sandboxing is declared, not designed — and is likely unachievable as specified · **High**

[ENGINE_ARCHITECTURE §14](./ENGINE_ARCHITECTURE.md#14-plugin-architecture) says
plugins are "sandboxed" and "must not reach the render surface's frame budget."
**No browser mechanism delivers that for code running in the frame loop.**
Workers cannot touch the render context; the main thread has no preemption.
A plugin that runs arbitrary per-frame JavaScript can stall a frame, and no
amount of API design prevents it.

**Resolution — constrain plugins to be declarative, not imperative:**

| Plugin capability | Allowed |
|---|---|
| Declare node/component types with typed properties | Yes |
| Ship parameterised scene templates | Yes |
| Provide data sources that write variables (off-frame, in a Worker) | Yes |
| Ship editor panels (sandboxed iframe, outside the render loop) | Yes |
| **Run arbitrary code per frame** | **No** |
| **Ship custom shaders** | Not in v1 — a shader can hang a GPU |

This narrows the plugin story considerably and is the correct trade. It should be
written down before anyone promises otherwise.

### C8 — Scope exceeds team capacity by roughly 2× · **High** · not an architecture defect

Summing what the architecture now requires: a 3D scene graph and runtime, a
scheduler, an event system, a render adapter and render graph, **an entire text
engine including shaping and SDF generation**, an animation system, a timeline,
a variable and binding system, an asset ingest pipeline, an editor, a control
surface, a live transport, an AI layer, and a first application.

Conservatively **4–6 engineer-years to a credible v1.** The roadmap assumes 2–3
engineers, mostly sequential.

The architecture is not wrong. **The plan around it is.** Options: extend the
timeline to ~30 months, cut MVP scope substantially, or hire two more engineers
including one specialist. Choosing none of these is choosing the first by
default, in month 20, badly.

### C9 — The first application does not validate the 3D bet · **Medium**

Tournament management is bracket trees, standings, and player cards — text and
data binding, almost no 3D. It will exercise the text engine and variable system
hard, which is genuinely valuable, and validate **~40% of the engine**.

The 3D infrastructure ships unvalidated by a real product, so 3D defects surface
with application #2, after the abstractions have hardened around 2D usage.

**Mitigation:** require at least one genuinely 3D deliverable in the first
application — a 3D trophy reveal, a camera-animated bracket transition, or a
stinger. Small in scope, and it forces the 3D path through a real product.

## 3. Reversals of prior decisions

| # | Decision | Verdict |
|---|---|---|
| **R1** | [RFC-003 §7](./RFC-003-rendering-architecture-3d.md#7-text--the-largest-technical-risk) dual-path text | **REVERSED** — single owned pipeline (C1) |
| **R2** | [SCENE_FORMAT §6.2](./SCENE_FORMAT.md#62-ordering--order): "Z-order is document order" | **REVERSED** — a 2D holdover carried into a 3D format. In 3D, draw order comes from depth testing and transparency sorting. Document order governs *screen-space subtrees only*; world-space order is a render-graph concern. |
| **R3** | [SCENE_FORMAT §3](./SCENE_FORMAT.md#3-envelope): `timeline` in the scene envelope | **REMOVED** — over-engineering. Within a scene, `states` plus per-node tracks are sufficient. Sequencing *across* scenes is show state (Phase 6), not scene state. Ships a concept before its consumer exists. |
| **R4** | [RFC-002 §4.2](./RFC-002-scene-document-model.md#42-mergeable-sibling-ordering) fractional ordering | **RETAINED, re-argued.** Its original justification was z-order, which R2 just removed. It survives on the narrower grounds of concurrent-edit merge and deterministic iteration. Weaker justification, same cost — flagged so it is re-examined if [P3](./PRODUCT.md#7-open-product-questions) resolves single-operator. |
| **R5** | glTF as the only interchange format | **RETAINED, with a watch item.** glTF is correct for assets. **OpenUSD** is becoming the interchange standard in exactly the virtual-production space BracketX targets. Not now — but the asset layer should not assume glTF is the only importable scene description, and this should be re-evaluated by 2028. |

Everything else — ADR-002, 003, 004, 005, 008, 010, 011, 012, RFC-002's core,
SCENE_FORMAT's coordinate system, versioning, and forward-compatibility rules —
survives review unchanged.

## 4. Subsystem audit

### 4.1 Engine Core

| Component | State | Note |
|---|---|---|
| Scene graph | **Designed** | Node + components is correct. Right-handed Y-up metres is right. |
| Runtime | **Designed** | Pure function of `(document, variables, time)` is the strongest single decision in the architecture. |
| Scheduler | **Missing** | C4 |
| Event system | **Missing** | C3 |
| Memory ownership | **Missing** | C5 |
| Lifetime management | **Missing** | C5 |
| Plugin boundaries | **Declared only** | C7 |

The core's *shape* is right and its *machinery* is absent. That is a better
failure than the reverse, but it is four subsystems of real work.

### 4.2 Rendering

Adopt-Three.js survives review. The render adapter seam with lint enforcement is
the right mechanism and the 3–5k-line budget gives lock-in an actual number.

**Weaknesses:**
- **Render graph ownership is asserted, not designed.** We own a render graph
  above Three.js; nothing specifies its pass model, resource aliasing, or
  scheduling. Babylon's Frame Graph exists precisely because this is hard.
- **Materials and lighting are unaddressed.** SCENE_FORMAT defers to glTF PBR
  and marks material definition open (F4). Broadcast has specific needs — flat
  unlit surfaces for keying, emissive for LED walls — that PBR defaults fight.
- **Transparency ordering has no policy.** Order-independent transparency,
  sorted blending, or depth-prepass is a decision with visible consequences and
  no owner.

### 4.3 Text Engine · **weakest subsystem**

Named the largest technical risk twice, then specified in ~15 lines with a
determinism defect (C1). After the R1 reversal it needs a real design covering:
font loading and fallback chains; HarfBuzz-WASM shaping; bidi and RTL; Arabic
joining; CJK atlas growth **and eviction under memory pressure**; SDF generation
and its quality floor; deterministic fit-to-box; layout caching and
invalidation; and per-frame cost under live text updates.

This is a subsystem on the order of 6–10 engineer-weeks on its own. It is the
single most under-resourced item in the plan relative to its importance.

### 4.4 Timeline

See C6. Animation semantics (states, tracks, dot-path properties, no physics)
are well-specified and correct. Everything around them — clocks, sync, timecode,
live-vs-authoring semantics — is not.

Undo interaction is also unexamined: undoing an animation edit *during live
playback* has no defined behaviour.

### 4.5 Scene Format

Strongest document in the set. Coordinate system, identifiers, versioning,
forward-compatibility rules, and the components model all survive.

Changes: R2 (z-order), R3 (remove `timeline`). Open item F2 (euler vs quaternion
for imported animation) is **more urgent than its "Phase 2" label** — it decides
whether glTF animation imports round-trip at all, and euler-lerp versus slerp is
a visible difference on any camera arc.

### 4.6 Runtime Targets

| Target | Supported | Note |
|---|---|---|
| Browser (editor) | **Yes** | Well-served |
| Browser (OBS output) | **Yes** | Baseline tier; must be excellent, not tolerated (C2) |
| Cloud rendering | **After C1** | Was broken by platform-dependent text; single pipeline fixes it |
| Native runtime | **Reserved, undesigned** | C2. Three.js does not run natively — the native target implies a *second render adapter*, which is exactly what the seam is for, and is a real argument the seam was worth building |
| Offline rendering | **Yes** | Falls out of the pure-function runtime |

The pure-function runtime is what makes three of these five nearly free. It is
the architecture's best decision.

### 4.7 AI

**Genuinely AI-native in substrate, not yet in design.** Operations-in-motion
([RFC-002 §5](./RFC-002-scene-document-model.md#5-operations)) means AI mutates
scenes through the same typed, invertible, validated operations as a human —
which is exactly right, and rare. AI edits are undoable, auditable, and cannot
corrupt a document.

**What is missing:** a scene *understanding* representation. Generating a
lower-third requires knowing what a lower-third is, and the format deliberately
has no such concept (§7 of SCENE_FORMAT: components are primitives, not
broadcast semantics). AI therefore needs semantic scaffolding — the `tags` field
and template metadata are the hooks, but no design uses them.

Also unspecified: whether an AI generation is one transaction or many (open item
S4), which decides undo granularity for AI edits.

### 4.8 Applications

**The cleanest boundary in the architecture.** Variables + cues + templates +
events, with applications forbidden from touching the scene graph. Enforceable
by lint the same way the render adapter is.

One risk: the boundary has never been tested, because no application exists.
Boundaries validated by exactly one consumer are usually wrong in ways only the
second consumer reveals — which is precisely why the "build the engine through
the first application" recommendation matters, and why the SDK must not be
published until a second consumer exists.

### 4.9 Scalability

| Scale | Supported |
|---|---|
| Single operator | Yes |
| Small tournament | Yes |
| Large esports event (multi-operator, multi-output) | **No** — C6 sync gap |
| Broadcast studio | **No** — needs native I/O and genlock |
| Multi-user collaboration | Format-ready, system not built (by design) |
| Distributed production | **No design** |

Distributed production is a 2030 problem, not a 2026 one. But the seam should be
reserved now: **show state should be an event-sourced log rather than mutable
state**, which makes distribution a replication problem later instead of a
rewrite. That is a cheap decision today and expensive to retrofit.

## 5. Recommended improvements — not blocking

1. **Write ENGINE_INVARIANTS.md** — a short list of properties that must hold
   forever (runtime purity, document authority, no renderer types above the
   adapter, no application concepts in engine code), each with an automated
   check. Invariants that are only prose decay.
2. **Adapter size as a tracked CI metric**, failing above 5k lines — the lock-in
   number should be enforced, not remembered.
3. **Golden-frame testing**: render fixed scenes at fixed times, compare state
   snapshots (not pixels) across targets. This is what makes state determinism
   testable rather than aspirational.
4. **Reserve show state as an event-sourced log** (§4.9).
5. **Decide the material model early** — broadcast unlit/emissive needs conflict
   with PBR defaults.
6. **Resolve F2 (euler vs quaternion) before Phase 2**, not during.
7. **Budget the text engine as its own phase.** Hiding it inside "Rendering"
   guarantees it is under-resourced.

## 6. Risks

### Technical
| Risk | P | Impact | Mitigation |
|---|---|---|---|
| Text engine harder than estimated | **High** | **Severe** | Own phase; prototype before committing to the rest of Phase 3 |
| Frame budget missed with encoder contention | High | Severe | Harness before renderer; degradation ladder (C4) |
| Multi-output sync proves very hard | Medium | Severe | Design in Phase 6; may cap event size until solved |
| Three.js `r`-release churn | High | Low | Pinned versions; breakage concentrated in the adapter |

### Architectural
| Risk | P | Impact | Mitigation |
|---|---|---|---|
| Engine/app boundary wrong (one consumer) | **High** | Moderate | Second consumer before SDK is public |
| Render graph under-designed vs Babylon's | Medium | Moderate | Design it explicitly; reversal conditions already documented |
| Scene format needs a breaking change by v3 | Medium | Moderate | Forward-compat rules make this survivable |

### Operational
| Risk | P | Impact | Mitigation |
|---|---|---|---|
| No production platform at launch (C2) | **Certain until resolved** | **Severe** | Decide now |
| Live failure with no rollback path | High | Severe | On-air incident runbook exists in Phase 9; needs to exist by Phase 6 |

### Hiring
| Risk | P | Impact | Mitigation |
|---|---|---|---|
| Cannot hire real-time 3D/text specialists | **High** | **Severe** | This is the top *business* risk. Text and rendering both need depth that generalists will not have. Consider contracting the text engine |
| Bus factor on the one person who understands the engine | High | Severe | Invariants document; pairing on core subsystems |

### Maintenance
| Risk | P | Impact | Mitigation |
|---|---|---|---|
| We now own text, picking, gizmos, render graph, scheduler, events | **Certain** | Moderate | Deliberate. But it is ~2× the maintenance surface of a Three.js wrapper |
| troika unmaintained | Medium | Low | We own text regardless after R1 |

### Performance
| Risk | P | Impact | Mitigation |
|---|---|---|---|
| Atlas churn spikes on live text updates | **High** | Severe | Pre-warm at scene load; eviction policy; T2 spike |
| VRAM exhaustion in long events | Medium | Severe | C5 budget and eviction |

### Scalability
| Risk | P | Impact | Mitigation |
|---|---|---|---|
| Architecture caps event size | Medium | Moderate | Acceptable for v1; event-sourced show state reserves the seam |

## 7. Future opportunities the architecture unlocks

Decisions already made that make later capabilities cheap:

- **Pure-function runtime** → cloud rendering, offline rendering, deterministic
  replay, golden-frame testing, and time-travel debugging all become near-free.
- **Operations-in-motion** → AI editing, collaboration, audit trails, and
  version history are one substrate.
- **Camera as a node** → tracked cameras, virtual studios, and multi-camera
  production need no new concept.
- **Variables as the single seam** → data feeds, operator input, template
  parameters, and AI all use one mechanism.
- **Render adapter seam** → the native runtime becomes a second adapter rather
  than a second engine. This is the seam's largest payoff and it was justified
  on weaker grounds.
- **Owned text pipeline (post-R1)** → identical text on every target, and the
  freedom to do variable fonts, per-glyph animation, and kinetic typography that
  a platform text engine forbids.

## 8. Architecture scores

Scored on **design completeness and quality combined**. Undesigned is not wrong,
but at a freeze gate it counts the same.

| Subsystem | Score | Weight | Rationale |
|---|---|---|---|
| Scene Graph | **8** | 12% | Component model, coordinate system, identity all correct. Minor R2/R3 fixes |
| Serialization / Format | **8** | 8% | Strongest document. Versioning and forward-compat genuinely well done |
| Rendering | **7** | 12% | Adopt decision sound and evidenced; render graph and materials undesigned; unvalidated empirically |
| Runtime / Scheduler | **5** | 10% | Pure-function core excellent; no scheduler, no degradation policy |
| Timeline | **4** | 8% | Animation right; clocks, sync, timecode absent |
| **Text Engine** | **4** | 15% | Highest weight, near-lowest score. Paper design with a determinism defect |
| Memory / Lifetime | **3** | 7% | Barely addressed; where 8-hour events fail |
| AI | **5** | 5% | Excellent substrate, no design, no semantic layer |
| Plugin System | **3** | 5% | Declared; sandboxing unachievable as written |
| Event System | **2** | 5% | Effectively does not exist |
| Maintainability | **7** | 6% | Good boundaries and enforcement; large owned surface |
| Scalability | **5** | 7% | Fine to mid-size; no distribution story |

**Weighted total: 5.3 / 10**

Deliberately not inflated. For comparison: 8+ would mean every subsystem
designed and the critical issues closed. The foundations would score 8; the
missing 40% drags the total.

The **text engine carrying the highest weight and the second-lowest score** is
the single most important line in this table.

## 9. Final recommendation

**As CTO signing a 10-year roadmap: yes, I approve — conditionally, and the
conditions are not negotiable.**

**Why approve.** The decisions that are expensive to reverse are right. 3D-first
is correct and irreversible-if-wrong. The pure-function runtime is the kind of
decision that pays for a decade — it makes cloud rendering, offline rendering,
testing, and replay fall out rather than be built. Operations-in-motion gives
AI, collaboration, and history one substrate. Adopting the rasterizer is
evidence-backed and correctly scoped. The seams are real and lint-enforced, not
aspirational.

**What must close before implementation:**

1. **C1** — reverse the text design to a single owned pipeline
2. **C2** — declare the v1 production platform
3. **C3, C4, C5** — design the event system, scheduler, and memory ownership
4. **C8** — reconcile scope with team; pick extend, cut, or hire, explicitly
5. Run the [empirical spike](./RENDER_ENGINE_EVALUATION.md#11-this-is-a-paper-evaluation--the-empirical-spike-still-must-run), **T2 first**

**What I would not approve:** starting Phase 2 implementation today. Not because
the architecture is wrong, but because four subsystems that other subsystems
depend on have not been designed, and one documented decision is defective.
Building on C3–C5 as they stand means each consumer invents its own scheduler,
event pattern, and disposal policy — and those never converge afterwards.

**Estimated work to close: 3–4 weeks of design, no implementation.** Against a
multi-year build, that is cheap. Against the cost of discovering C1 during cloud
rendering in month 20, it is free.

**The honest summary:** this is a strong architecture that is about 60% designed
and 100% documented, and the gap between those numbers is the risk. Close the
gap and I would sign it without reservation.

---

## Appendix — required changes to existing documents

| Document | Change |
|---|---|
| [RFC-003](./RFC-003-rendering-architecture-3d.md) §7 | Replace dual-path text with the single owned pipeline (R1/C1) |
| [SCENE_FORMAT.md](./SCENE_FORMAT.md) §6.2 | Remove "z-order is document order"; scope to screen-space subtrees (R2) |
| [SCENE_FORMAT.md](./SCENE_FORMAT.md) §3, §10 | Remove `timeline` from the envelope (R3) |
| [SCENE_FORMAT.md](./SCENE_FORMAT.md) F2 | Promote euler-vs-quaternion to a pre-Phase-2 gate |
| [ENGINE_ARCHITECTURE.md](./ENGINE_ARCHITECTURE.md) §14 | Rewrite plugins as declarative-only (C7) |
| [ENGINE_ARCHITECTURE.md](./ENGINE_ARCHITECTURE.md) | Add: scheduler, event system, memory ownership (C3–C5) |
| [ROADMAP.md](./ROADMAP.md) | Text engine as its own phase; reconcile scope with team (C8); 3D deliverable in app #1 (C9) |
| New | ENGINE_INVARIANTS.md with automated checks |
