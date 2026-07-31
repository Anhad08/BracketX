# BracketX — Architecture Verification

**Date:** 2026-07-30 · **Posture:** adversarial · **Standard:** 15+ years, multiple teams, live-production failure modes
**Labelling:** every claim is **[Proven]**, **[Derived]**, **[Assumed]**, or **[Unknown]**

> **Proven** = directly verified by me against a running system or a committed artifact.
> **Derived** = follows logically from Proven facts or explicitly stated premises.
> **Assumed** = taken on faith. No verification performed.
> **Unknown** = cannot be determined without work that has not been done.

---

## 0. The headline finding

**[Proven]** Eleven architecture documents exist. **Zero lines of engine code
exist.** `packages/` contains `auth`, `core`, `db`, `ui`, `eslint-config`,
`typescript-config` — 1,847 TypeScript lines total, none of it engine.

**[Proven]** No benchmark has been run. No frame has been rendered. No text has
been shaped. No GPU resource has been allocated.

**[Derived]** Therefore **essentially every performance, quality, and feasibility
claim across those eleven documents is Assumed or Unknown.** They are written in
a uniformly confident register that does not distinguish a fact I verified
against PostgreSQL from a number I estimated with no basis.

**This is the single largest risk in the project, and it is a documentation
defect rather than an architecture defect.** A future engineer reading
RENDER_ENGINE_EVALUATION cannot tell that "3–5k lines" for the render adapter
was invented, while "8 tables, 19 timestamptz columns" was read out of
`pg_catalog`. Both appear in tables, in the same voice.

## 1. Proven facts

The complete list. Everything else in this project is not proven.

| # | Fact | How verified |
|---|---|---|
| P1 | Database has 8 tables, 19 `timestamptz` columns, 0 naive timestamps | `information_schema` query, live PostgreSQL 17.10 |
| P2 | `project.created_by_id` is `ON DELETE SET NULL`; `project.organization_id` is `CASCADE` | `pg_constraint` introspection |
| P3 | `organization.slug` is globally unique; `project(organization_id, slug)` is composite-unique | `pg_constraint` introspection |
| P4 | Deleting a user preserves their projects with `created_by_id` NULL | Golden Path integration test, real database |
| P5 | Cross-tenant access returns 404, not 403 | HTTP walkthrough against a running server, two real users |
| P6 | Sign-up → workspace → project → editor shell works end to end | HTTP walkthrough, `next start`, real Postgres |
| P7 | 36 tests pass (25 unit, 11 integration) | Test run |
| P8 | better-auth 1.6.25, drizzle-orm 0.45.2, drizzle-kit 0.31.10 installed | `package.json` after resolution |
| P9 | `three` is **not installed**. No render code exists | Filesystem |
| P10 | The Postgres driver was being bundled into the browser; now blocked by `server-only` | Build failed, then passed |
| P11 | `Slot` receives `[undefined, element]` when an icon slot is empty | Build failed, then passed |
| P12 | **SCENE_FORMAT v2 contains no array/collection variable type and no repetition construct** | Exhaustive grep: the only matches for array/collection/repeat/instance are "collections may be empty" and "an array of components" |
| P13 | Babylon.js 9.0 shipped a Frame Graph; Three.js `WebGPURenderer` is production-track with TSL | Vendor documentation and release announcements — **[Assumed] that the documentation is accurate; not tested** |

## 2. Architecture defects

Ranked. Each states what would have to be true for it not to be a defect.

### D1 — The runtime purity claim has an undeclared fourth input · **Severe**

**[Proven]** ENGINE_ARCHITECTURE §4 and ENGINE_RUNTIME §1.6 state the runtime is
a pure function of `(document, variables, time)`.

**[Derived]** It is not. Text layout depends on parsed font metrics; rendering
depends on glyph residency in the atlas. Both are **resource residency**, which
is a fourth input. TEXT_ENGINE §5 specifies LRU eviction under memory pressure,
and memory pressure is a function of everything else running on the machine.

**[Derived]** Therefore, as currently specified, **eviction can change what
renders, and eviction is nondeterministic.** Determinism and dynamic eviction
are in direct conflict, and no document notices.

**Required fix:** an invariant that does not currently exist —

> Eviction may affect *timing*. It must never affect *output*. Evicting a glyph
> and re-rasterizing it must produce byte-identical results.

**[Derived]** This is achievable, because MSDF generation from outlines is
deterministic. But it must be stated and tested, because the natural
implementation (cache a rasterization at whatever size was first requested)
violates it silently.

### D2 — There is no reconciler, and "disposable cache" conceals that · **Severe** · missing subsystem

**[Proven]** ADR-012 and the render-adapter design state the Three.js object
graph is "a rebuildable cache", with test T5 rebuilding it mid-run.

**[Derived]** A full rebuild of a non-trivial scene cannot complete inside a
16.6ms frame. So in production the cache is **never** rebuilt — it is
incrementally synchronised. T5 therefore tests a path that production never
takes.

**[Derived]** The actual problem is **incremental reconciliation**: diffing the
document against the mirrored graph and applying minimal mutations — keying,
reordering, property diffing, resource reuse, disposal of orphans. This is the
same class of problem as React reconciliation and is of comparable difficulty.

**[Proven]** No document addresses it. It appears in no phase, no estimate, and
no risk register.

**Required fix:** design the reconciler, and re-estimate Phase 3. **[Assumed]**
4–8 engineer-weeks; **[Unknown]** without a prototype.

### D3 — The boundary between document state and runtime state is undefined · **Severe**

**[Proven]** RFC-002 §4.3 states operations are the *only* mutation path.
RFC-002 §5 lists `variable.setDefault` as an operation.

**[Unknown]** Whether a live variable *value* change during a show is an
operation. Nothing states it either way.

**[Derived]** Both readings produce serious bugs:
- If yes: a data feed at 60Hz generates 60 operations/second, each with an undo
  entry. An 8-hour show produces ~1.7M undo entries. Unbounded memory growth,
  and Ctrl-Z during a live show rewinds the score.
- If no: then a mutation exists outside the operation log, which contradicts the
  stated invariant, and every guarantee built on "operations are the only
  mutation path" — audit, collaboration, history — is silently weaker than
  claimed.

**Required fix:** state explicitly that **document state** (defaults, structure,
bindings) is operational and undoable, while **runtime state** (current variable
values, active states, playhead) is not in the document, not operational, and not
undoable. Then correct RFC-002 §4.3, which currently overclaims.

### D4 — The event isolation guarantee is overstated · **High**

**[Proven]** ENGINE_RUNTIME §3.1 claims a handler "can never stall a frame",
achieved by dispatching asynchronously in a bounded time slice.

**[Derived]** False as stated. JavaScript has no preemption. A bounded slice
limits how many handlers are *started*, not how long any one *runs*. A handler
taking 500ms cannot be interrupted; it will delay every subsequent frame.

**Honest guarantee:** *a handler cannot extend the frame during which its event
was raised.* It can absolutely stall the next one.

**[Derived]** Genuine isolation requires handlers in Workers, which prevents
them touching the DOM — acceptable for data sources, not for editor panels.

**Required fix:** correct the claim, and split plugin handler capabilities by
whether they run in a Worker.

### D5 — Multi-output synchronisation works only within one process · **High**

**[Proven]** ENGINE_RUNTIME §1.7 specifies outputs sharing "one show clock with
a declared epoch".

**[Derived]** Two OBS browser sources are two independent CEF renderer
processes, each with its own `requestAnimationFrame`. A shared clock across
them requires clock synchronisation over a transport — a distributed-systems
problem of NTP/PTP class.

**[Derived]** The design is correct for multiple viewports in **one** page. It
does not deliver the multi-output capability ENGINE_ARCHITECTURE §5 claims for
programme/preview on separate sources.

**[Unknown]** Achievable drift over a 3-hour show. **Requires benchmark.**

### D6 — The determinism boundary against Three.js is undefined · **High**

**[Derived]** We compute world matrices; Three.js performs frustum culling and
**transparency sorting**. Sort order affects output for overlapping transparent
geometry, which broadcast graphics are full of.

**[Unknown]** Whether Three.js's sort is stable and identical across versions,
platforms, and backends.

**[Derived]** If it is not, "deterministic state" is false at the boundary —
and this is exactly the boundary ADR-012 introduced.

**Required fix:** enumerate which computations are ours and which are Three's,
and either own sorting or downgrade the determinism claim to exclude
transparent-geometry ordering.

### D7 — Snapshot-at-rest has no scaling story · **Medium**

**[Derived]** RFC-002 chose snapshots for load simplicity. Autosave writes the
whole document. For a virtual set with thousands of nodes and embedded material
definitions, autosave is O(document) on every change.

**[Unknown]** The document size at which this becomes unacceptable. **Requires
benchmark.**

**[Derived]** The mitigation already exists and was not chosen: operations
enable incremental persistence. This is a reversible decision, but the trigger
should be defined now rather than discovered by a customer.

### D8 — The frozen scene format cannot express the first application · **Severe** · meets the freeze-reopening bar

**[Proven, P12]** SCENE_FORMAT v2 variable types are `string`, `number`,
`boolean`, `color`, `asset`, `vector3`, `transform`. **All scalar.** There is no
array or collection type, and no repetition, instancing, or data-driven node
generation construct anywhere in the format.

**[Derived]** A tournament bracket has variable structure: an 8-team bracket has
7 matches, a 64-team bracket has 63. The node count is a function of data.

**[Derived]** The format cannot express this. The application therefore must
either:
1. Generate the node tree programmatically — which **violates**
   ENGINE_ARCHITECTURE §13's rule that applications may not touch the scene
   graph; or
2. Author a maximum-size template and hide unused nodes — wasteful, capped, and
   an admission the model is wrong.

**[Derived]** This is the first application — the one chosen specifically to
validate the engine — and **the frozen format cannot represent its primary
content.**

**[Derived]** Per ADR-013, the bar for reopening a frozen item is a
demonstration that the design cannot satisfy a real implementation requirement.
**This meets that bar.** Requirement: render a bracket whose match count is
data-driven. Current design: no mechanism. Cost of fixing now: an additive
format capability. Cost of not fixing: the application boundary is breached by
the first application, and once breached it will not be restored.

**Recommended fix (additive, no version bump under §13 rule 4):**
- An `array` variable type
- A `repeater` component: binds to an array variable, instantiates a child
  subtree per element, exposing element fields as scoped variables

**[Derived]** This preserves the boundary — applications still only write
variables — and generalises well beyond brackets: rosters, standings, schedules,
lower-third queues, sponsor loops. **[Assumed]** it is sufficient for those; not
verified.

### D9 — The layer model is documentation, not architecture · **Medium**

**[Proven]** ENGINE_ARCHITECTURE §2 defines six layers with a strict
one-directional rule. **[Proven]** No corresponding packages exist. There is no
`packages/engine`, `packages/render`, or `packages/scene`.

**[Derived]** The layering is currently unenforceable and therefore
aspirational. The two boundaries that *are* enforced — `server-only` and the
proposed `three`-import lint — are enforced because they are mechanical.

**Required fix:** create the package boundaries when the engine starts, so the
layer rule is checkable by the module graph rather than by review.

### D10 — Cross-target determinism is untestable for years · **Medium**

**[Derived]** The determinism guarantee spans browser, OBS CEF, cloud, and
native. **[Proven]** Two of those four do not exist and are post-launch.

**[Derived]** Therefore the guarantee can only be tested between a browser and a
headless browser until the native runtime ships — and the divergence most likely
to matter is precisely at the targets that cannot be tested.

**Required fix:** state the guarantee's tested scope honestly, and treat
cross-target determinism as **[Unknown]** rather than designed-in.

## 3. Assumptions currently presented as conclusions

**[Proven]** these appear in committed documents without qualification. Each is
**[Assumed]** or **[Unknown]**.

| Claim | Reality |
|---|---|
| Render adapter is "3–5k lines"; swap is "4–8 weeks" | **[Assumed]** — I invented both numbers. No basis. They should not be quoted as analysis |
| Text engine is "6–10 engineer-weeks" | **[Assumed]** — before D2's reconciler and before the Unicode annex work was scoped |
| MVP is "18–26 months"; total "4–6 engineer-years" | **[Assumed]** — no estimation method, no historical data |
| Three.js can meet the frame budget | **[Unknown]** — **requires benchmark** |
| MSDF is adequate at broadcast sizes | **[Unknown]** — **requires benchmark** |
| WebGPU availability in OBS CEF | **[Unknown]** — **requires implementation validation** |
| "40% GPU memory savings" (Babylon Frame Graph) | **[Assumed]** — vendor marketing, repeated by me without qualification |
| Zero dropped frames over 60 minutes is achievable | **[Unknown]** — **requires benchmark** |
| Three.js is better than Babylon for this product | **[Derived]** from vendor documentation, **[Unknown]** empirically |

## 4. Removal and rewrite tests

Applied to every subsystem. Reported only where the answer is interesting.

| Subsystem | Remove? | Rebuild identically? |
|---|---|---|
| Scene graph | No — it is the product | Yes |
| Operations | Yes, technically — snapshots alone would work | **Yes**, for undo correctness alone |
| Fractional ordering | **Yes** | **No.** Its original justification (z-order) was removed by FINAL_REVIEW R2. It now rests solely on concurrent-edit merge, and P3 is unanswered. For a single-writer v1 I would not rebuild it |
| `screenSpace` component | No | Yes |
| Render adapter seam | No — required for the native runtime | Yes |
| Six-layer model | Not as *documentation* — it should be packages | **No** — I would build it as enforced module boundaries from day one (D9) |
| `runtime.culling` per node | **Yes — remove.** Premature; the engine should decide culling | No |
| `runtime.renderOrder` | **Probably.** Added for transparency sorting we have not yet proven we need | No |
| Event system | No — D3/D4 notwithstanding, every subsystem needs it | Yes, with the honest guarantee |

**[Derived]** Two subsystems fail the rewrite test (fractional ordering, layer
model) and two format fields should be removed as premature. That is a
low-but-nonzero failure rate, consistent with an architecture that is
directionally sound and locally over-specified in places.

## 5. Categories required by the brief

**Hidden coupling · [Derived]** Determinism ↔ eviction (D1). Determinism ↔
Three.js sorting (D6). Application boundary ↔ format expressiveness (D8).

**Temporal coupling · [Derived]** Fonts must parse before first paint; atlas
pre-warm must complete before air. Both are stated; neither is enforced by a
type or a state machine. **Missing:** an explicit scene-readiness state machine.

**Circular dependencies · [Proven]** None in the current package graph.
**[Derived]** One latent: the render adapter needs the text engine's atlas, and
the text engine needs the adapter's texture upload. Must be broken by an
interface, and no document says which side owns it.

**Ownership ambiguity · [Proven]** D3 (document vs runtime state). **[Derived]**
Also: who owns the render target pool — the render graph or memory ownership?
Both documents claim it.

**API leakage · [Derived]** Low risk. The `three`-import lint is the right
mechanism. **[Unknown]** whether TSL types leak into shared material
definitions — they will if materials are typed against TSL.

**Undefined lifecycle · [Derived]** Scene load/unload/ready has no state
machine. Asset loading has no defined failure state. What happens when a scene
fails to load *while on air* is undefined across all eleven documents.

**Threading · [Derived]** Workers are specified for shaping, SDF generation, and
data sources. **[Unknown]** whether transferring layout results costs more than
computing them inline for short strings. **Requires benchmark.**

**Determinism risks** D1, D6, D10.

**Serialization risks · [Derived]** Float rounding to 5 decimals is specified;
**[Unknown]** whether that is sufficient precision for metre-scale positions at
sub-millimetre accuracy — 5 decimals is 10µm, which is **[Derived]** adequate.

**Versioning risks · [Derived]** Format versioning is the strongest part of the
architecture. Event catalogue versioning is undefined and becomes a public API
the moment plugins ship.

**Performance cliffs · [Unknown]** Atlas thrash under CJK load; reconciler cost
on large scenes; autosave on large documents (D7). All **require benchmark**.

**GPU bottlenecks · [Unknown]** Entirely. No GPU work has been done.

**Browser limitations · [Proven]** No preemption (D4). **[Unknown]** OBS CEF
capability surface.

**Native runtime · [Derived]** Three.js does not run natively, so the native
target requires a second render adapter. This is the seam's largest payoff and
was justified on weaker grounds.

**Cloud rendering · [Derived]** Unblocked by the C1 text reversal. Still
**[Unknown]** whether headless WebGPU is available on target infrastructure.

**Security · [Derived]** Plugin sandboxing is unsolved for anything imperative
(FINAL_REVIEW C7). Asset ingest is an untrusted-binary parsing surface — font
and glTF parsers are historically a rich source of memory-safety bugs, and this
is **not mentioned in any document**. **Missing.**

**Testing difficulty · [Derived]** High and underestimated. Golden-frame testing
needs a reference; cross-target determinism is untestable (D10); live failure
modes cannot be tested without a broadcast rig.

**Maintenance · [Derived]** We own text, picking, gizmos, render graph,
scheduler, events, memory, and now a reconciler. **[Assumed]** roughly 2× the
surface of a Three.js wrapper.

## 6. Missing subsystems

| Subsystem | Severity | Note |
|---|---|---|
| **Reconciler** (D2) | Severe | Real, sizeable, unplanned |
| **Scene readiness state machine** | High | Load → parse → prewarm → ready → on-air, with defined failure at each step |
| **Live failure model** | High | What happens when a scene fails *on air* is undefined everywhere |
| **Asset ingest security** | High | Untrusted font and glTF parsing; unmentioned |
| **Data-driven repetition** (D8) | Severe | Blocks the first application |
| Event catalogue versioning | Medium | Becomes public API with plugins |

## 7. Reversal conditions

| Decision | Reverse when |
|---|---|
| Three.js adoption | Frame budget unmet for architectural reasons after profiling; or transparency sorting proves nondeterministic and unpatchable (D6) |
| Snapshot-at-rest | Autosave latency exceeds ~200ms at realistic scene sizes (D7) |
| Fractional ordering | P3 resolves to single-operator permanently — then remove |
| Operations-only mutation | Never. But it must first be *stated correctly* (D3) |
| 3D-first | Never. The asymmetry argument is **[Derived]** and sound |
| MSDF | Quality trial fails at broadcast sizes — then raster-to-texture with owned rasterization, still no platform text engine |

## 8. Final verdict

# VERIFIED WITH CHANGES

**With an explicit and important qualification: this is the highest verdict the
available evidence can support, and it is not a statement that the architecture
works.**

**[Derived]** A verdict of VERIFIED is impossible in principle today, because
verification requires evidence and **[Proven]** no engine code and no benchmarks
exist. What has been verified is that the architecture is **internally
consistent and directionally defensible where it can be checked by reasoning
alone**.

**[Derived]** NOT VERIFIED would be wrong, because it implies fundamental
rework. The load-bearing decisions survive adversarial review: 3D-first (the
asymmetry argument holds), adopt-the-rasterizer (precedent-backed), the pure
runtime (modulo D1's fourth input, which is fixable), operations-in-motion, and
the enforced render seam.

### Blocking changes

| # | Change | Blocks |
|---|---|---|
| 1 | **D8** — add array variables and a repeater component. **Requires reopening the frozen scene format**, and meets ADR-013's bar | Phase 2 |
| 2 | **D3** — define document vs runtime state; correct RFC-002 §4.3 | Phase 2 |
| 3 | **D2** — design the reconciler; re-estimate Phase 3 | Phase 3 |
| 4 | **D1** — add the eviction-invisibility invariant | Phase 3 |
| 5 | **D4** — correct the event isolation claim | Phase 2 |
| 6 | Re-label all eleven documents with evidence classes, or at minimum mark every invented number as an estimate | Immediately |

### Non-blocking but required before scale

D5 (cross-process sync), D6 (determinism boundary), D7 (snapshot scaling), D9
(package-enforced layers), D10 (testability scope), asset ingest security, live
failure model.

### What I would say to a board

**[Derived]** The architecture is a credible foundation for a 15-year system,
designed by someone who understood the domain constraints. It also contains one
proven defect that blocks the first application, one missing subsystem of real
size, and a systematic failure to distinguish measured facts from estimates.

**[Derived]** None of that is unusual at this stage. What would be unusual — and
dangerous — is proceeding while believing the architecture is more validated
than it is. **[Proven]** Nothing has been built. Everything remains a hypothesis
with a well-written argument attached.

The next artifact should not be a document. It should be a running prototype of
the text pipeline and the reconciler, because those are the two largest
**[Unknown]**s and no further reasoning will reduce them.
