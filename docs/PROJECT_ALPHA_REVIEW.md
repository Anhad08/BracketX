# Project Alpha — Architecture Reframing Review

**Status:** Review · **Date:** 2026-08-01 · **Scope:** every phase after the completed engine work
**Constrained by:** [ADR-013](./ARCHITECTURE.md#adr-013) · [ENGINE_ARCHITECTURE §13](./ENGINE_ARCHITECTURE.md)
**Companions:** [PROJECT_ALPHA_ARCHITECTURE.md](./PROJECT_ALPHA_ARCHITECTURE.md) · [ROADMAP_V2.md](./ROADMAP_V2.md) · [IMPLEMENTATION_IMPACT.md](./IMPLEMENTATION_IMPACT.md)

---

## 0. The headline finding

**The engine is already a Production Operating System. The roadmap is still a
broadcast graphics product.**

Phases 2.1–2.6 were built after the vision was clarified, and every one of them
is capability-shaped. The scene graph knows about nodes and components, not
lower thirds. The reconciler knows about projection, not scoreboards. The
runtime knows about frames, not matches. `MirrorBackend` was frozen with no
method that assumes a canvas, a browser, or a broadcast pipeline — which is why
`setSize` was correctly rejected during Phase 2.6.

Phases 3–16 were authored in Phase 0, **before** the reframing, and were never
reconciled with it. They are written in the vocabulary of a broadcast tool:
"browser source", "on air", "lower-third", "scoreboard", "bracket", "match
rundown", "esports providers".

So this review is not a redesign. It is a **reconciliation** of a roadmap
written for one product with an engine that has since become something larger.

Three of the sixteen remaining phases need real architectural change. Most need
only vocabulary. One should largely dissolve.

---

## 1. A tension in the principles that has to be resolved first

The six principles are frozen and I am not arguing with them. But two of them
pull against a decision already recorded in
[ENGINE_ARCHITECTURE §13](./ENGINE_ARCHITECTURE.md), and pretending otherwise
would make this review useless.

> **Principle 3.** Core Before Extensions.
> **Principle 5.** The Engine Is The Product.

against

> **§13:** *"'The engine is the product' is architecturally sound and
> strategically dangerous… Build the engine* through *the first application, not
> before it. Generality is earned by having two real consumers, not by
> anticipating eight."*

Read literally, principles 3 and 5 say: finish the general engine, then build
applications. §13 says: that is the platform trap, and it has killed better-
funded teams than this one.

**Both are right, about different things.** The resolution is a distinction this
review applies to every phase below:

| | Cost | When |
| --- | --- | --- |
| **Generalise the abstraction** | Cheap. It is a naming and interface decision, made on paper, now. | **Now.** A wrong abstraction is expensive to change later; a wrong name is expensive immediately, because it teaches everyone the wrong model. |
| **Generalise the implementation** | Expensive. Real code, real tests, real maintenance, for consumers who do not exist. | **When a second consumer exists.** §13's rule stands. |

Applied concretely: the engine should have an **Output** abstraction now, with
exactly one implementation (a canvas). It should not have SRT, NDI, and a render
farm now. The abstraction is what makes those additive later; the
implementations are what would sink the schedule today.

Every "Required Architectural Change" in this document is an abstraction change
unless explicitly labelled otherwise.

### A second tension, unresolved and worth naming

> **Principle 2.** One Platform. One Experience.
> **Principle 4.** Complexity Belongs Inside the Platform.

against **Phase 13 (Plugin SDK)** and **Phase 14 (Marketplace)**.

Third-party plugins are, by definition, many experiences. A marketplace is, by
definition, complexity pushed outside the platform onto creators. These phases
and these principles cannot both be fully honoured.

This review does not resolve it — it is a product decision, not an engineering
one. But it does draw the consequence: **if principles 2 and 4 hold, the
extension surface must be content and data, not behaviour and UI.** Templates,
component packs, design tokens, and data-source adapters are content. Arbitrary
sandboxed code that draws its own pixels and renders its own panels is not.
[§4.13](#413-phase-13--plugin-sdk) carries this through.

---

## 2. The test applied to every phase

> Is this solving a broadcast problem, or building an engine capability?

with a second test the brief supplies:

> Could this power broadcast, esports, corporate, education, government,
> concerts, sports, and virtual production **without architectural
> modification**?

A phase passes if the answer is yes for all eight. Where it fails, the review
states exactly which vertical breaks it and why — a generic "it might not
generalise" is not a finding.

---

## 3. Summary of verdicts

| Phase | Verdict | Kind of change |
| --- | --- | --- |
| 3 — Rendering Engine | **Modified** | Architectural — Output abstraction |
| 4 — Scene Editor | **Renamed + modified** | Mostly terminology, one real assumption |
| 5 — Animation Engine | **Modified** | Architectural — unified time, generic states |
| 6 — Live Production | **Renamed** | Terminology only |
| 7 — Graphics Components | **Dissolved and split** | Architectural — the largest change |
| 8 — AI v1 | **Reframed** | Architectural — AI becomes a client, not a phase |
| 9 — Public Launch | **Unchanged** | None. Correctly an application/business phase |
| 10 — Integrations | **Renamed + modified** | Architectural — data source contract |
| 11 — Automation | **Renamed** | Terminology, plus merge into unified time |
| 12 — Realtime Collaboration | **Unchanged** | None |
| 13 — Plugin SDK | **Modified** | Architectural — extension points beyond components |
| 14 — Marketplace | **Unchanged** | None. Explicitly outside the engine |
| 15 — Cloud Platform | **Modified** | Becomes an Output implementation, not a platform |
| 16 — Enterprise | **Unchanged** | None. Explicitly outside the engine |

**Five architectural changes. Four renames. Four phases untouched. One
dissolved.**

---

## 4. Phase-by-phase review

### 4.3 Phase 3 — Rendering Engine

**Current purpose.** A scene renders to pixels at 60fps on a transparent
background in a browser source, with no editor code present.

**Underlying capability.** Deterministic frame production, delivered to a
consumer that the engine does not choose.

**Current assumptions.** Largely satisfied already by Phases 2.5 and 2.6 — the
render backend, the frame loop, and verified pixels all exist.

**Hidden broadcast assumptions.**

1. **"Browser source" is the output.** Exit criterion 1 names OBS; the
   deliverables specify a render-surface URL with an unguessable token "because
   OBS will not carry a session cookie". A browser source is *one consumer of
   one output implementation*.
2. **1920×1080 is the frame.** Already fixed in Phase 2.6 — the document
   declares `world.output` and the host reads it — but the roadmap text still
   assumes it.
3. **Transparent background is the output mode.** Correct for compositing over
   video; wrong as a universal default for a projector, an LED wall, or a
   recording.

**Which verticals break.** Concerts (projector/LED, often full-frame opaque, often
multi-surface), virtual production (output is a *texture* consumed by Unreal or
a media server, never a URL), education (output is a recording file), cloud
(output is an encoded transport stream). Four of the eight break on assumption 1
alone.

**Generalised engine capability.**

> **Outputs.** A scene is bound to one or more **outputs**. An output declares a
> resolution, a colour/alpha mode, and a frame cadence, and receives frames. What
> it does with them is the output's business.

Implementations, in demand order: `canvas` (exists), `browser-source` (a canvas
plus a token-authenticated URL — the current behaviour, now named as one case),
`texture`, `file`, `stream`.

This is not speculative. `MirrorBackend` already carries
`RenderOptions.target: RenderTargetHandle | null` and `createRenderTarget`, and
Phase 2.6 already refused `setSize` on the grounds that *"the surface being
drawn into belongs to whoever created it, and a backend owning canvas sizing
could not render into a texture or an offscreen target."* The frozen boundary
already anticipated this. The engine layer above it has not caught up.

**Required architectural change.**

- Introduce an `Output` concept at the engine-host layer: `bindOutput`,
  `unbindOutput`, one scene to many outputs.
- Move `clearColor`, viewport, and cadence from host options onto the output.
- Ship exactly **one** implementation now. Phase 15 becomes a second one rather
  than a platform.

---

### 4.4 Phase 4 — Scene Editor

**Current purpose.** "A user can build a broadcast graphic visually and it
persists."

**Underlying capability.** An authoring surface over the document model, driven
entirely by operations.

**Current assumptions.** Correct and important: reuse the Phase 3 runtime, never
a second one; undo/redo on the operation log, never snapshots. Both survive.

**Hidden broadcast assumptions.**

1. **"a fixed 1920×1080 broadcast frame guide"** — the editor hardcodes what the
   document already declares. Phase 2.6 made output document-declared; the
   editor must read `world.output`.
2. **"broadcast graphic"** as the unit of work. The unit is a *scene*.
3. **The editor is the only authoring surface.** Phase 8 (AI) and Phase 10
   (data) both author, and Phase 12 (collaboration) has several authors at once.

**Which verticals break.** None architecturally — assumption 1 is a one-line
fix, not a design flaw. This phase is overwhelmingly a terminology change.

**Generalised engine capability.** None new. The editor is an **application
surface**, not an engine capability, and should be stated as such. Its
engine-facing requirement is already satisfied: operations are the only mutation
path.

**Required architectural change.** None.

**Terminology change.** "Scene Editor" over "Broadcast Editor"; frame guide
derives from `world.output`; the phase belongs to the application layer in
[ROADMAP_V2](./ROADMAP_V2.md).

---

### 4.5 Phase 5 — Animation Engine

**Current purpose.** Graphics animate in, out, and between states.

**Underlying capability.** Time-varying property evaluation.

**Hidden broadcast assumptions.**

1. **"State model: in / idle / out."** This is the lifecycle of a *broadcast
   graphic overlay*. A concert visual has no "out"; it has cue-to-cue
   transitions. A virtual production element has no lifecycle at all — it exists
   for the duration of the shot. A lecture slide has "advance". The engine
   should know **named states and transitions between them**; `in`, `idle`, and
   `out` are a *template convention* that the broadcast component pack adopts.
2. **Animation owns time.** Phase 5 builds an animation timeline; Phase 11 builds
   a rundown with time and condition triggers. Two time systems over one clock is
   the seed of a class of bug this project has already paid for once — two
   sources of truth for the same value (invariant R9).

**Which verticals break.** Concerts and virtual production break on assumption 1.
All eight are put at risk by assumption 2, because a scene whose animation clock
and whose cue clock can disagree cannot be deterministic.

**Generalised engine capability.**

> **Time.** One clock (exists, Phase 2.3). One **timeline** model above it:
> ordered, addressable positions with typed events. Property interpolation and
> cue sequencing are two *readers* of that timeline, not two timelines.
>
> **States.** Named states with declared transitions. No state name has meaning
> to the engine.

`SCENE_FORMAT` already reserved `states` at the document level, which is the
right shape. The change is to ensure the animation engine reads that generic
model rather than hardcoding three names, and that Phase 11 sequences over the
same timeline rather than inventing one.

**Required architectural change.**

- Animation states are opaque names. `in`/`idle`/`out` move into the broadcast
  component pack as a convention.
- Declare one timeline model now, used by Phase 5 and later by Phase 11.

---

### 4.6 Phase 6 — Live Production

**Current purpose.** An operator puts a graphic on air, changes its data, takes
it off air, from a control surface.

**Underlying capability.** Remote, low-latency, reconnect-safe control of a
running engine, with health telemetry.

**Hidden broadcast assumptions.** Vocabulary only: "on air", "take", "clear",
"next", "show". Each has a direct general equivalent — *live*, *activate*,
*deactivate*, *advance*, *session*. The state machine underneath (queued →
active → inactive) is universal: a concert cue stack, a lecture segment, a
council agenda item, and a match graphic all have exactly this shape.

**Which verticals break.** None. This is the phase that generalises best, and it
is worth saying so plainly rather than manufacturing a change.

**Generalised engine capability.** Already correct. Worth *naming* explicitly as
**Control** — the fourth application-facing seam alongside Variables, Cues,
Templates, and Events in [ENGINE_ARCHITECTURE §13](./ENGINE_ARCHITECTURE.md).

**Required architectural change.** **None.**

**Terminology change.** Phase renamed to *Live Control*. The control surface
remains a distinct, dense, keyboard-driven application UI — that is a correct
product decision and Principle 1 (Reliability Above Everything) actively
requires it.

One deliverable is worth keeping exactly as written: *"a live product that
cannot tell you it is failing is not shippable."* That is an engine capability
(telemetry), and it belongs in the engine, not the application.

---

### 4.7 Phase 7 — Graphics Components

**This is the largest finding in the review.**

**Current purpose.** A library of broadcast-ready components: lower-third,
scoreboard, ticker, timer, **bracket**, roster.

**Underlying capability.** None of those are capabilities. They are *content*.

A bracket is a tree of match nodes bound to tournament data. A scoreboard is a
group of text and rects bound to score variables with a clock. A roster is a
list. A ticker is a clipped, translating text run. **The engine should not know
any of those words.** Principle 6 says capabilities, not products;
[ENGINE_ARCHITECTURE §13](./ENGINE_ARCHITECTURE.md) already says *"if the
tournament application needs to build a bracket node tree, that capability
belongs in a component pack behind the SDK, not in the application"* — and by
the same logic, not in the engine either.

**Which verticals break.** All eight, in the sense that matters: a corporate or
government application inherits a component library it will never use, and the
engine carries broadcast vocabulary in its core forever. The product name
appearing in the engine's component list — *bracket* — is the clearest single
instance of product leakage in the roadmap.

**Hidden broadcast assumptions.** The entire deliverable list, except three
items that are genuinely engine work and are currently buried inside it:

1. **Component parameterisation** — "so one component serves many shows".
2. **Templates** — "save a scene as a reusable template, instantiate from it".
3. **Brand kit** — "workspace-level colours, fonts, logo defaults".

**Generalised engine capability.** Phase 7 splits in two.

**Engine side — three capabilities, one of them new:**

> **Templates.** A scene with **typed, declared parameters**, instantiable into
> another scene. Already half-present: `SCENE_FORMAT` has variables, and Phase
> 2.6 proved binding resolution end to end. What is missing is *nesting* — see
> [§5.5](#55-scene-composition).
>
> **Design tokens.** Named, scoped values (colour, font, spacing) resolved at
> instantiation. This is the brand kit, generalised. Mechanically it is very
> close to variables at workspace scope, and the review's recommendation is to
> **implement it as exactly that rather than as a second system** — a second
> name-to-value resolver would be a second source of truth.
>
> **Collections and instancing.** **NEW, and the most valuable missing
> capability in the roadmap.** A repeated sub-scene driven by a collection:
> `for each item in items → instantiate template with item as parameters`.

Rosters, brackets, tickers, leaderboards, lineups, agendas, playlists, lower-third
queues, and every scoreboard with a variable number of competitors are all the
same shape. Today none of them is expressible without hand-building N nodes,
which means every one of them is application code writing scene graphs directly —
precisely what §13 forbids.

**Application side.** The component library becomes the **first application's
content pack**: `packs/broadcast` containing lower-third, scoreboard, ticker,
timer, and roster; `packs/tournament` containing bracket. These are templates
and component definitions, not engine code. They ship with the product; they are
not part of the engine.

**Required architectural change.**

- **Add Collections/instancing to the scene format and reconciler.** This is a
  genuine engine capability addition and the largest piece of new work the review
  identifies.
- Formalise Templates with typed parameters, including nesting.
- Implement design tokens as scoped variables, not a parallel system.
- Move all six named components out of the engine into content packs.

> **ADR-013 note.** Collections/instancing adds to `SCENE_FORMAT`. Per
> [SCENE_FORMAT §13 rule 4](./SCENE_FORMAT.md), adding an optional property with
> a defined default is **not** a breaking change and needs no version bump —
> the same reasoning that let TEXT_ENGINE add `fallback`. The freeze is not
> reopened. If implementation finds that instancing cannot be expressed
> additively, that *is* an ADR-013 event and must stop for a finding.

---

### 4.8 Phase 8 — AI v1

**Current purpose.** A user describes a graphic and gets an editable scene
composed from Phase 7 components.

**Underlying capability.** **Programmatic scene authoring against a validated
contract.**

**Hidden assumptions.** That AI is a phase. It is a *client*. The engine
capability that makes AI generation possible is identical to the one that makes
these possible:

- importing a scene from another tool
- a script generating 64 bracket graphics for a tournament
- an automation building a scene from a data feed
- a marketplace template instantiating into a workspace
- a migration rewriting scenes to a new format version

Every one of those needs: construct a document programmatically → validate →
reject cleanly on failure → land as a normal editable scene. That is one
capability with five consumers, and the roadmap currently builds it for one of
them and calls it AI.

**Which verticals break.** None — but the *capability* is under-built if it is
scoped to AI, and over-built if AI is cut for runway, which the roadmap
explicitly permits.

**Generalised engine capability.**

> **Authoring API.** A programmatic, validated path to construct and mutate
> documents, going through operations like every other writer. The Phase 2
> validator is the gate. AI is one client; so is the importer, the automation,
> and the marketplace installer.

Notably, this capability **already exists in embryo** — Phase 2.2's operations,
Phase 2.6's `SceneHost.apply`, and `validateDocument` are exactly it. The work is
to name it, stabilise it, and stop treating it as internal.

**Required architectural change.** Reframe: the engine phase is *Authoring API*.
AI becomes an application feature built on it, and its cut criterion (under 5
months' runway) applies only to the application feature, not to the capability.
This makes cutting AI cheaper, which is strictly better given the roadmap
already plans for it.

---

### 4.9 Phase 9 — Public Launch

**Verdict: no changes required.**

Billing, auth completion, onboarding, docs, support, legal, marketing, load
testing. Every item is an application and business concern, correctly outside the
engine. Exit criterion 7 — *"at least 3 external teams have run a real show
before launch day"* — is the single most valuable line in the roadmap and should
not be touched.

The only note: "run a real show" should not be narrowed to broadcast. Three
external teams from *different verticals* would additionally validate the engine
seam, which is exactly the "two real consumers" test §13 demands. Recommended,
not required.

---

### 4.10 Phase 10 — Integrations

**Current purpose.** Graphics update automatically from external data.

**Underlying capability.** External data reaching the variable system, with
defined staleness and failure behaviour.

**Hidden broadcast assumptions.** "1–2 concrete sports/esports providers", and
"deeper OBS/vMix integration". The *connectors* are domain content; the
*contract* is engine.

**Which verticals break.** None, provided the contract is the deliverable and
the sports connectors are the sample implementation rather than the design
target. If a sports provider's shape defines the framework, corporate (a CRM),
education (an LMS), and government (an agenda system) each require a framework
change — which fails the test.

**Generalised engine capability.**

> **Data Sources.** An adapter contract that writes variables. Push and pull.
> Declared staleness, declared fallback, degraded-not-blank on failure.

The failure behaviour is already correctly specified and is engine-level: *"a
provider outage degrades to last-known-good and warns the operator, never blanks
the graphic."* That belongs in the engine, matching the refuse-never-evict rule
in ENGINE_RUNTIME §4.4 — the same instinct applied to data instead of VRAM.

**Required architectural change.** The deliverable is the contract plus
staleness semantics. Concrete providers move to connector packs, alongside
component packs.

**Terminology change.** *Integrations* → *Data Sources*.

---

### 4.11 Phase 11 — Automation

**Current purpose.** Sequences of graphics run on triggers or a schedule.

**Underlying capability.** Cue sequencing: an ordered set of addressable
positions with triggers, conditions, and a dry-run mode.

**Hidden broadcast assumptions.** "Rundown" is broadcast vocabulary — but the
concept is universal and every listed vertical has it under a different name
(cue stack, lesson plan, agenda, set list, shot list, run of show).

**Which verticals break.** None. This is vocabulary, with one architectural
caveat: as noted in [§4.5](#45-phase-5--animation-engine), this must sequence
over the **same timeline model** the animation engine uses. Two independent
sequencers over one clock is fine. Two time models is a determinism bug waiting
to happen.

**Generalised engine capability.** **Sequencing**, over the unified timeline.

**Required architectural change.** None beyond the shared timeline established
in Phase 5.

**Terminology change.** *Automation* → *Sequencing*; "rundown" → "cue sequence".

Keep verbatim: *"any automated action can be manually overridden mid-show,
instantly."* That is Principle 1 expressed as an exit criterion.

---

### 4.12 Phase 12 — Realtime Collaboration

**Verdict: no changes required.**

Already engine-shaped. It builds on the operation log, which Phase 2 chose
specifically so this phase would be a feature and not a rewrite. Presence,
history, and comments are application concerns layered on it. Nothing here
assumes broadcast.

The dependency note — *"if G2 chose a single-writer format, this phase is a
rewrite of Phases 2 and 4"* — was correct and has already paid off.

---

### 4.13 Phase 13 — Plugin SDK

**Current purpose.** Third parties build custom components.

**Underlying capability.** Extension points, sandboxed.

**Hidden assumptions.** That components are the only thing worth extending. A
Production OS has at least four extension points, and
[ENGINE_ARCHITECTURE §14](./ENGINE_ARCHITECTURE.md) already lists three of them:
component packs, panels, and data sources. Outputs is the fourth, and follows
directly from [§4.3](#43-phase-3--rendering-engine).

**Which verticals break.** Virtual production and cloud break hardest: both need
a custom **output**, and neither needs a custom component. A plugin system that
only extends components serves the broadcast case and nothing else.

**Generalised engine capability.**

> **Extension points**, in demand order:
> 1. **Content packs** — templates, component definitions, tokens. *Data.*
> 2. **Data source adapters** — write variables. *Data plus a small contract.*
> 3. **Output targets** — receive frames. *Contract.*
> 4. **Panels** — application UI. *Code and UI — the one that conflicts with
>    Principles 2 and 4.*

**Required architectural change.** Broaden the extension model beyond
components. Order the four by how well each survives Principle 2: content packs
are pure data and cannot fragment the experience; panels are arbitrary UI and
inevitably do.

**Recommendation, offered not imposed:** ship 1–3 and defer 4 until there is
demand that content and data cannot satisfy. That keeps Principles 2 and 4
intact for as long as possible, and §13's "not published until proven" rule
already argues the same way.

---

### 4.14 Phase 14 — Marketplace

**Verdict: no changes required.**

Distribution, payments, moderation, payouts. Entirely a business layer. It
should be explicitly recorded as **outside the engine**, which the current
roadmap does not say.

Its dependency on templates as "the unit of trade" is strengthened, not weakened,
by [§4.7](#47-phase-7--graphics-components): templates become a first-class
engine capability with typed parameters and nesting, which makes them a better
unit of trade than a component library would have been.

---

### 4.15 Phase 15 — Cloud Platform

**Current purpose.** BracketX renders in the cloud, removing the operator's
machine from the critical path.

**Underlying capability.** Two, currently fused into one 10–14 week phase:

1. **Headless deterministic rendering** — an engine capability.
2. **Render farm orchestration, autoscaling, metering, multi-region** — an
   infrastructure product.

**Hidden assumptions.** That cloud rendering is a platform. Under the Output
abstraction from [§4.3](#43-phase-3--rendering-engine), *cloud rendering is an
output implementation* — `stream` — plus operations work. That is a materially
smaller and better-shaped phase.

**Which verticals break.** None, but the framing costs a lot: as written, the
phase cannot be started incrementally, and the roadmap itself flags it as *"the
largest infrastructure bet… the one most likely to be built on an assumption."*
Splitting it lets the engine half ship and be verified without committing to the
infrastructure half.

**Generalised engine capability.** Headless rendering is largely proven already.
Phase 2.5's `HeadlessRendererHost` exists and 94 tests run against it; what is
missing is an encoder and a transport, both of which sit behind the Output
contract.

**Required architectural change.** Split. Engine: `stream` output. Platform:
orchestration, metering, regions — demand-gated exactly as the current text
already insists.

---

### 4.16 Phase 16 — Enterprise

**Verdict: no changes required.**

SSO, SCIM, RBAC, audit, residency, SLA. Entirely platform and compliance, and
correctly demand-gated. Nothing assumes broadcast. Explicitly outside the engine.

---

## 5. Missing engine capabilities

The brief asks what capability every future application would eventually
require. Five, each justified by something already in the roadmap rather than
imagined. Ranked by evidence, not by appeal.

### 5.1 Outputs

**Evidence:** Phase 3 assumes a browser source; Phase 15 needs SRT/RTMP/WebRTC;
virtual production needs a texture; education needs a file. `MirrorBackend`
already has `RenderOptions.target` and `createRenderTarget`, and Phase 2.6
already refused `setSize` on exactly these grounds.

**Verdict: build the abstraction now, one implementation.**

### 5.2 Collections and instancing

**Evidence:** Phase 7 lists roster, bracket, and ticker; Phase 10 delivers live
collections of data. Every one is N instances of a sub-scene over a collection,
and none is expressible today.

**Verdict: build it.** This is the one genuinely new engine capability, and
without it every list in every application is application code writing scene
graphs by hand — which §13 forbids.

### 5.3 Layout and constraints

**Evidence:** `TEXT_ENGINE` §6 already specifies fit-to-box, which *is* a layout
constraint — the capability has already appeared once under another name. A
scoreboard auto-sizing to team-name length, a ticker clipping to a viewport, and
any element anchored to an output edge are the same need. Output-independence
(§5.1) makes anchoring mandatory rather than convenient: absolute coordinates
cannot survive being rendered at two resolutions.

**Verdict: build a minimal version** — anchors, fit, and clip. Not a full
constraint solver. Absolute transforms remain the default.

### 5.4 One timeline

**Evidence:** Phase 5 and Phase 11 each independently define time.

**Verdict: declare the model now**, implement in Phase 5, reuse in Phase 11.
Cheap now, expensive after both exist.

### 5.5 Scene composition

**Evidence:** Templates (Phase 7), marketplace units (Phase 14), and component
packs (§14) all require a scene to contain another scene. `SCENE_FORMAT` has a
single root and no reference mechanism. Collections (§5.2) require it too — a
repeated item *is* a nested scene.

**Verdict: required by §5.2, so it arrives with it.** Design them together or
instancing will be built twice.

### Considered and rejected

**Video as a first-class media type.** Concerts and virtual production both want
it, and the render backend's `createTexture`/`updateTexture` could technically
carry it. But no current phase requires it, no customer has asked, and it drags
in decode, sync, and colour management — a subsystem comparable in size to the
text engine. **Recorded as a known gap, not scheduled.** This is the review
declining to generalise for its own sake.

**A generic "entity/component/system" runtime.** Tempting, and wrong. The scene
graph plus components already covers the cases in evidence, and an ECS would be
abstraction with no consumer.

**A scripting layer inside the engine.** Automation (§4.11) and the Authoring
API (§4.8) cover the demonstrated need. A general script runtime inside a
deterministic engine is a determinism hazard, and Principle 1 outranks it.

---

## 6. Product leakage index

Everywhere the remaining roadmap names a domain concept where a capability
belongs. Terminology unless marked.

| Location | Leak | Replace with |
| --- | --- | --- |
| Phase 3 | "browser source", OBS-specific URL | Output (**architectural**) |
| Phase 3 | "transparent background" as the mode | Output alpha mode |
| Phase 4 | "fixed 1920×1080 broadcast frame guide" | `world.output` |
| Phase 4 | "broadcast graphic" | scene |
| Phase 5 | "in / idle / out" states | named states (**architectural**) |
| Phase 6 | "on air", "take", "clear", "next" | live, activate, deactivate, advance |
| Phase 7 | lower-third, scoreboard, ticker, timer, **bracket**, roster | content packs (**architectural**) |
| Phase 7 | "brand kit" | design tokens |
| Phase 8 | "AI generates scenes" | Authoring API (**architectural**) |
| Phase 10 | "sports/esports providers" | data source adapters |
| Phase 11 | "rundown", "match rundown" | cue sequence |
| Phase 13 | "components" as the only extension | four extension points (**architectural**) |
| Phase 15 | "Cloud Platform" | `stream` output + operations |

The engine's product name appearing as a component type — **bracket** — is the
single clearest instance, and the one most worth fixing on principle.

---

## 7. Vertical coverage after the changes

| Subsystem | Broadcast | Esports | Corporate | Education | Government | Concerts | Sports | Virtual Prod |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Runtime | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Scene Graph | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Reconciler | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Render Backend | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Text | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Outputs** (new) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Collections** (new) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Layout** (new) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Variables | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Animation (generic states) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Timeline / Sequencing | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Assets | ✓ | ✓ | ✓ | ✓ | ✓ | ~ | ✓ | ~ |
| Templates | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Authoring API | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Data Sources | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Live Control | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Collaboration | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Extensions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Media / video | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ |

`~` = works but under-served. `✗` = requires the deferred media capability
(§5, *Considered and rejected*). **Concerts and virtual production are honestly
marked as incomplete rather than claimed.**

---

## 8. Verdict on the vision

**BracketX is correctly evolving toward a Production Operating System at the
engine layer, and was not at the roadmap layer.** This review closes that gap on
paper.

The evidence that the engine half is genuinely right is not the vocabulary — it
is the refusals. Over the last three phases the architecture rejected
`setMeshScale`, rejected `setSize`, rejected a premature resource release, and
rejected weakening a frozen contract for convenience. An engine that refuses
convenient additions at its boundary is an engine whose boundary means something.
That is what makes a second application possible, and a second application is
the only real proof a platform ever gets.

The risk is unchanged and is stated in §13: generality is earned, not designed.
This review therefore generalises **abstractions now and implementations
never** — every architectural change here is an interface or a name, except
Collections, which is the one capability with enough evidence behind it to build.

**Recommendation: adopt.** Then keep building the engine through the first
application, exactly as §13 says, and let the second one prove the seam.
