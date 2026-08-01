# Implementation Impact — Project Alpha

**Date:** 2026-08-01 · **Source:** [PROJECT_ALPHA_REVIEW.md](./PROJECT_ALPHA_REVIEW.md)

Three categories, kept strictly separate:

- **A — Architectural change.** New or altered interface, format, or capability. Real work.
- **T — Terminology change.** Renaming. Zero runtime impact, real comprehension impact.
- **N — No change.** Already correct.

---

## 1. Unchanged — no work

Every completed subsystem survives the reframing intact. **No contradiction with
the six principles was found in any of them, and ADR-013 is not reopened.**

| Subsystem | Why it survives |
| --- | --- |
| Runtime (clock, commands, scheduler, events) | Knows frames, not shows |
| Scene Graph & document model | Nodes and components, no domain nouns |
| Operations & edit model | The only mutation path; Authoring API builds on it |
| Reconciler & projection | Handles-and-mirrors; domain-free |
| `MirrorBackend` | Frozen boundary; already refused canvas/GPU assumptions |
| `engine-render-three` | Isolated and enforced |
| `engine-host` | Correct composition root; gains Outputs, loses nothing |
| Text architecture | Owns the pipeline on every target; no platform assumptions |
| Verification philosophy | Proven/Derived/Assumed/Unknown/Disproven — unchanged |
| Ownership model | Single owner, single mutation path — unchanged |
| Phases 12/14 (Collaboration), 14/16 (Marketplace), 16/19 (Enterprise), 9/12 (Launch) | Already correctly layered |

---

## 2. Modified — architectural (A)

| # | Change | Where | Effort | Risk |
| --- | --- | --- | --- | --- |
| A1 | **Output abstraction** — bind/unbind, resolution + alpha + cadence on the output | `engine-host` | ~1 wk | Low. `MirrorBackend` already supports render targets; nothing below changes |
| A2 | **Collections & instancing** — repeated sub-scene over a collection | `engine-scene`, `engine-reconciler` | ~3 wk | **Medium — the only material risk.** Must be additive to `SCENE_FORMAT` (§13 rule 4). Reconciler must keep projection O(change) when a collection changes |
| A3 | **Scene composition (nesting)** — a scene may contain a scene | `engine-scene` | ~1 wk | Medium. Arrives with A2; design together or instancing is built twice |
| A4 | **Templates with typed parameters** | `engine-scene` | ~1 wk | Low |
| A5 | **Layout** — anchors, fit, clip | `engine-scene`, `engine-reconciler` | ~1.5 wk | Low. Deliberately not a constraint solver |
| A6 | **Design tokens as scoped variables** | `engine-runtime` | ~0.5 wk | Low — *only if* implemented as variables. A second resolver would be a second source of truth |
| A7 | **One timeline model**, read by animation and sequencing | `engine-runtime` | ~1 wk | Low now, high if deferred until both exist |
| A8 | **Generic named states** — no privileged names | `engine-scene` | ~0.5 wk | Low |
| A9 | **Authoring API** — name and stabilise the existing path | `engine-host` | ~0.5 wk | Low. Mostly promotion of existing code |
| A10 | **Extension points beyond components** — packs, adapters, outputs, panels | Phase 15 | design only now | Low today |
| A11 | **Data source contract** — adapter, staleness, degrade-not-blank | Phase 13 | design only now | Low today |

**Total new engine work before launch: ~10 weeks**, of which **A2+A3 (~4 weeks)
is the genuinely new capability.** The rest is interface and naming.

This is absorbed rather than added: old Phase 7 (5–7 wks) becomes new Phase 10
(4–6 wks) because content packs are data, and old Phase 3 shrinks by ~3 weeks
because 2.5/2.6 already delivered most of it.

---

## 3. Modified — terminology only (T)

Zero runtime impact. Real impact on what the team believes it is building.

| From | To | Where |
| --- | --- | --- |
| "browser source" as the output | one configuration of the `canvas` output | Phase 3 |
| "1920×1080 broadcast frame guide" | derives from `world.output` | Phase 5 editor |
| "broadcast graphic" | scene | throughout |
| "in / idle / out" | named states (convention moves to the broadcast pack) | Phase 6 |
| "on air / take / clear / next" | live / activate / deactivate / advance | Phase 7 engine |
| "brand kit" | design tokens | Phase 4 |
| "rundown" | cue sequence | Phase 9 |
| "sports/esports providers" | data source adapters | Phase 13 |

The control surface may keep saying "on air" **to operators**. Operators say "on
air". The engine may not.

---

## 4. Removed from the engine

Nothing is deleted. Six items **move** from engine to content.

| Item | From | To |
| --- | --- | --- |
| Lower-third, scoreboard, ticker, timer, roster | engine component library | `packs/broadcast` (templates) |
| **Bracket** | engine component library | `packs/tournament` (templates) |

Consequence: **the engine's component list stops containing the product's own
name.** If a pack cannot be built from Phase 4 primitives, that is a reportable
gap in Phase 4, not a licence to add engine code.

---

## 5. Renamed phases

| Old | New | Layer |
| --- | --- | --- |
| 3 Rendering Engine | 3 Rendering & Outputs | ENGINE |
| 4 Scene Editor | 5 Authoring Surface | APPLICATION |
| 5 Animation Engine | 6 Time & Animation | ENGINE |
| 6 Live Production | 7 Live Control | ENGINE + APP |
| 7 Graphics Components | **dissolved** → 4 Composition (ENGINE) + 10 Content Packs (APP) | — |
| 8 AI v1 | 8 Authoring API (ENGINE) + 11 AI Authoring (APP, cuttable) | — |
| 10 Integrations | 13 Data Sources | ENGINE + packs |
| 11 Automation | 9 Sequencing — **moved before launch** | ENGINE |
| 13 Plugin SDK | 15 Extensions | ENGINE |
| 15 Cloud Platform | 17 Stream Output (ENGINE) + 18 Cloud Operations (PLATFORM) | — |

---

## 6. New capabilities

| Capability | Justified by | Verdict |
| --- | --- | --- |
| **Outputs** | Phase 3 assumes OBS; 17 needs streams; virtual production needs a texture; education needs a file | Build abstraction, one implementation |
| **Collections & instancing** | Roster, bracket, ticker, leaderboard, live data — none expressible today | **Build** |
| **Scene composition** | Required by instancing, templates, marketplace units | Build with instancing |
| **Layout** | `TEXT_ENGINE` §6 fit-to-box already is one; output-independence makes anchoring mandatory | Build minimal |
| **One timeline** | Phases 6 and 9 each define time independently | Declare now, implement in 6 |
| **Authoring API** | AI, importers, automation, marketplace, migrations — five clients | Promote existing code |

### Rejected

**Media/video** — no current phase needs it, size comparable to the text engine.
Recorded; concerts and virtual production honestly marked incomplete.
**ECS runtime** — no consumer. **In-engine scripting** — determinism hazard;
Principle 1 outranks it.

---

## 7. Sequencing of the work

1. **Now, on paper (days):** A1, A7, A10, A11 — interface and naming decisions.
   Cheap now, expensive after implementations exist.
2. **Phase 4 (~4 wks):** A2 + A3 together. The only material new capability.
3. **Alongside Phase 4 (~3 wks):** A4, A5, A6, A8.
4. **Phase 8 (~0.5 wk):** A9.
5. **Deferred to demand:** every implementation beyond the first output.

---

## 8. Risk

| Risk | P | Impact | Mitigation |
| --- | --- | --- | --- |
| Collections cannot be expressed additively in `SCENE_FORMAT` | Low | **High** — ADR-013 event | Design against §13 rule 4 first; stop and file a finding rather than bump the version |
| Collections break the reconciler's O(change) guarantee | Medium | High | Regression benchmarks already exist from P-001 and Phase 2.4; extend them before building |
| Design tokens implemented as a second resolver | Medium | Medium | Explicitly specified as scoped variables (A6) |
| Generalising implementations, not just abstractions | **Medium** | **High** — the §13 platform trap | Every A-item except A2/A3 is interface-only by construction |
| Content packs need engine escapes | Medium | Medium | Treat as a reportable Phase 4 gap, never patch with engine code |

---

## 9. Bottom line

- **Architectural change: 11 items, ~10 weeks, of which ~4 is genuinely new.**
- **Terminology change: 8 items, zero runtime cost.**
- **No change: every completed subsystem, and 4 of 16 remaining phases.**
- **Schedule to launch: ~45 weeks against ~44. Effectively unchanged.**

The reframing is affordable because the engine was already built correctly. What
changes is mostly what things are *called* and which *layer* they live in — plus
one real capability, Collections, that four separate roadmap features already
required and none could have been built without.
