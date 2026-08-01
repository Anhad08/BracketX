# BracketX — Roadmap

**Status:** Canonical · **Authored:** 2026-07-30 · **Owner:** @Pixelborne

> This is the canonical development roadmap for BracketX. It supersedes the
> sprint-scoped draft written earlier on 2026-07-30.
>
> **How to use it.** Phases are ordered so that nothing depends on incomplete
> work. That ordering is load-bearing — several phases sit where they do for
> non-obvious reasons recorded in [§6 Revision notes](#6-revision-notes).
> Reordering without reading that section will reintroduce a dependency break we
> already found and fixed.
>
> **Durations, not dates.** Every estimate is a range in weeks assuming the team
> in §1. No calendar dates until real velocity is known — invented dates are
> worse than none.

---

## 1. Assumptions

Stated so they can be challenged, because every estimate below depends on them.

- **Team: 2–3 engineers**, full-time, one of whom is also doing product and
  design. Durations scale close to linearly downward — a solo founder should
  read every range as roughly doubled.
- **No dedicated QA, DevOps, or designer.** Testing and infrastructure are
  absorbed into each phase, which is why phases look slower than a feature list
  suggests.
- **Phases are mostly sequential.** With 2–3 people, genuine parallelism is
  limited. Where two workstreams can safely overlap it is called out.
- **Ranges are p50–p80**, not best case. Phases 3 and 4 are the most likely to
  overrun; see [§5](#5-risk-register).

## 1-0. Architecture freeze — 2026-07-30

Architecture is frozen per [ADR-013](./ARCHITECTURE.md#adr-013). Scene graph,
scene format, operations, render adapter, Three.js adoption, 3D-first, and
engine boundaries are settled. Reopening one requires demonstrating that the
existing design **cannot satisfy a real implementation requirement** —
preference is not sufficient.

**Five design tasks stand between here and implementation**, all now complete:

| Task | Document |
|---|---|
| Runtime clock · Scheduler · Event system · Memory ownership | [ENGINE_RUNTIME.md](./ENGINE_RUNTIME.md) |
| Text engine | [TEXT_ENGINE.md](./TEXT_ENGINE.md) |

**Three findings from the review remain open and are product decisions, not
engineering ones.** None blocks the freeze; all block a credible plan:

- **C2** — no declared v1 production platform. "Browser is not the production
  platform" and "native runtime is post-launch" cannot both hold.
- **C8** — scope exceeds the stated team by roughly 2×. Extend, cut, or hire.
- **C9** — tournament management does not exercise 3D, so the 3D bet ships
  unvalidated by the first product.

## 1a. Vision realignment — 2026-07-30

BracketX was reframed as a **real-time 3D production engine** with tournament
management as one application on it
([ENGINE_ARCHITECTURE.md](./ENGINE_ARCHITECTURE.md)). This section records what
that does and does not change here.

**The phase sequence survives.** Foundation → assets → scene → render → editor →
animation → live → components → AI → launch is still correct, and the
renderer-before-editor ordering is *more* correct under 3D, not less: a 3D
renderer can invalidate a scene format far more expensively than a 2D one.

**What changed:**

| Phase | Change |
|---|---|
| — | **New gate before Phase 2:** the adopt-vs-build spike ([RFC-003 §4](./RFC-003-rendering-architecture-3d.md#4-adopt-vs-build-the-rasterizer)). Nothing in Phase 2 should start until the rendering substrate is chosen. |
| 1 Asset Manager | Roughly doubles. No longer an uploader — a 3D **ingest pipeline**: glTF/GLB validation, texture transcoding, LOD and atlas generation, VRAM budgeting. |
| 2 Scene Engine | Grows: camera nodes, component model, 3D transforms, material references. |
| 3 Rendering | Grows most. Render graph, PBR, alpha compositing, and the dual-path text system — which [RFC-003 §7](./RFC-003-rendering-architecture-3d.md#7-text--the-largest-technical-risk) names as the single largest technical risk in the whole plan. |
| 5 Animation | Grows: camera animation and 3D interpolation are now core, not extras. |
| **New** | **A first-application track.** The roadmap has no home for tournament management. Under "engine is the product" that is a gap, not an omission — see below. |
| 15 Cloud Platform | Now also carries the **native runtime** for NDI/SDI/genlock, which a browser cannot provide ([ENGINE_ARCHITECTURE §12](./ENGINE_ARCHITECTURE.md#12-live-output)). |

**The first-application gap.** "The engine is the product" is architecturally
sound and strategically dangerous: a general engine built before one application
has users is the platform trap. The roadmap must show tournament management
shipping *on* the engine, exposing gaps in it, before any SDK is published.
Concretely — Phase 7 (Graphics Components) becomes **Phase 7: first application
+ the component pack it needs**, and Phase 13's Plugin SDK stays gated on a
second real consumer.

**Estimates below are stale.** They assumed a 2D editor built by generalists.
See [§1b](#1b-estimate-impact).

## 1b. Estimate impact

Vision, scope, team size, and timeline cannot all be held constant. Something
gives, and naming it now is cheaper than discovering it in month 14.

| Scenario | MVP duration | Comment |
|---|---|---|
| Original 2D plan | 13–18 months | The estimates in §2, now stale |
| **3D + adopted renderer** | **18–26 months** | Recommended path |
| 3D + hand-written renderer | 30+ months | Not viable for this team |

**Adopting the rendering substrate is what makes the 3D vision achievable at
all** at this team size. That is the practical argument behind
[RFC-003 §4](./RFC-003-rendering-architecture-3d.md#4-adopt-vs-build-the-rasterizer),
independent of the architectural one.

The team assumption in §1 also changes: real-time 3D graphics engineers are
scarce and expensive, and "2–3 generalists" no longer describes who can build
Phases 2–5. Either hire for it or cut scope; both are legitimate, drifting is
not.

## 2. Shape of the plan

> **Stale as of 2026-07-30.** The table below reflects the pre-3D plan and is
> retained for comparison. See [§1b](#1b-estimate-impact) for current ranges.

| | Phases | Duration | Ends at |
|---|---|---|---|
| **MVP** | 0 → 9 | 55–76 weeks | Public launch, **month 13–18** |
| **Post-launch** | 10 → 16 | 52–68 weeks | Selected by demand, not sequence |

Total across all 17 phases is 25–33 months, which **exceeds the 24-month
horizon**. That is deliberate and honest: only two or three post-launch phases
will fit inside 24 months. Phases 10–16 are ordered by dependency so that
whichever ones demand selects can be built without rework — they are not a queue
to be worked through in order.

### The MVP thesis

MVP is the smallest product that gets **real graphics on a real broadcast**.
Anything short of on-air is a design tool, not BracketX. That single criterion is
what puts ten systems inside MVP and eight outside it.

| In MVP | Out of MVP (post-launch) |
|---|---|
| Authentication · Workspaces · Projects | Realtime Collaboration |
| Asset Manager · Scene Engine · Rendering Engine | Automation · Integrations |
| Scene Editor · Animation Engine | Plugin SDK · Marketplace |
| Live Production · Graphics Components | Cloud Platform · Enterprise |
| AI v1 *(cuttable — see Phase 8)* | |

### Phase index

| # | Phase | Weeks | Status |
|---|---|---|---|
| 0 | [Foundation](#phase-0--foundation) | 5–7 | in progress |
| 1 | [Asset Manager](#phase-1--asset-manager) | 3–4 | |
| 2 | [Scene Engine](#phase-2--scene-engine) | 5–7 | |
| 3 | [Rendering Engine](#phase-3--rendering-engine) | 6–9 | |
| 4 | [Scene Editor](#phase-4--scene-editor) | 9–12 | |
| 5 | [Animation Engine](#phase-5--animation-engine) | 6–8 | |
| 6 | [Live Production](#phase-6--live-production) | 7–9 | |
| 7 | [Graphics Components](#phase-7--graphics-components) | 5–7 | |
| 8 | [AI v1](#phase-8--ai-v1) | 4–6 | |
| 9 | [Public Launch](#phase-9--public-launch) | 5–7 | **MVP ships** |
| 10 | [Integrations](#phase-10--integrations) | 6–8 | post-launch |
| 11 | [Automation](#phase-11--automation) | 6–8 | post-launch |
| 12 | [Realtime Collaboration](#phase-12--realtime-collaboration) | 8–10 | post-launch |
| 13 | [Plugin SDK](#phase-13--plugin-sdk) | 8–10 | post-launch |
| 14 | [Marketplace](#phase-14--marketplace) | 6–8 | post-launch |
| 15 | [Cloud Platform](#phase-15--cloud-platform) | 10–14 | post-launch |
| 16 | [Enterprise](#phase-16--enterprise) | 8–10 | post-launch |

---

# MVP

## Phase 0 — Foundation

**5–7 weeks · in progress**

### Goal

A user can sign in, create a workspace, create a project, and enter the editor
shell.

### Deliverables

- **Repo hygiene** — ✅ complete. Duplicate app removed, `@bracketx/*` scope,
  Turborepo cache-env correctness, Node floor corrected, CI green, docs authored.
- **`packages/db`** — ✅ Drizzle client (lazily connected), generated Better
  Auth schema, `project` table, migration `0000`, local Postgres via
  `docker-compose.yml`, `db:generate` / `db:migrate` / `db:studio`.
  **Migration not yet applied** — needs a running Postgres.
- **`packages/auth`** — ✅ Better Auth 1.6.25 + organization plugin, code-defined
  roles, framework-agnostic `getSession`. Sign-in/sign-up **UI** still to build.
- **`packages/core`** — ✅ the authorisation seam
  ([ARCHITECTURE.md §4](./ARCHITECTURE.md#4-why-packagescore-exists)).
  Workspace and project operations, `assertMemberOfOrganization` as the single
  enforcement point, typed domain errors, Zod schemas per input.
- **Test harness** — ✅ Vitest, 25 tests covering the authorisation rules
  (resolves [D3](./ARCHITECTURE.md#8-open-decisions)). Wired into CI.
- **UI foundation** — ✅ Tailwind v4 + Radix on a token layer in
  `@bracketx/ui` (dark-only, deliberately), shared `AppShell` and `EditorShell`,
  and the first milestone end-to-end: landing → sign-up/sign-in → workspace →
  projects → empty editor shell. Verified against a live server, including
  cross-tenant 404s.

**Deferred out of this phase:** OAuth providers, email verification, password
reset, team invitations. Each carries real setup cost (mail transport, provider
registration) and none is needed to prove the goal. They land in Phase 9 where
launch readiness forces them.

### Dependencies

None. This is the root of the graph.

### Exit criteria

1. A new user signs up, creates a workspace, creates a project, opens it, and
   sees the editor shell.
2. Session survives a refresh and a server restart.
3. A second user in a different workspace receives 404 (not 403) on the first
   user's project URL — non-membership must not leak existence.
4. `assertMemberOfOrganization` has unit tests covering member, non-member, and
   cross-workspace cases.
5. CI green on `main`: lint, typecheck, build, test.
6. The membership model does not preclude per-seat *or* usage-based billing
   ([P5](./PRODUCT.md#7-open-product-questions) is unanswered; Phase 9 needs
   one of them to be cheap).

---

## Phase 1 — Asset Manager

**3–4 weeks**

### Goal

A user can upload, browse, and delete media in a workspace, and every asset has
a stable ID that a scene can reference.

### Why this is first

Not because it is urgent — because it is *unblocked*. Phase 2 is gated on two
decisions that are not yet made ([§6](#3-gating-decisions)). Asset Manager is
gated on one that can be made this week. Putting it first buys time to resolve
Phase 2's gates properly instead of guessing under pressure.

### Deliverables

- Storage integration ([D1](./ARCHITECTURE.md#8-open-decisions) — S3-compatible;
  recommend Cloudflare R2 for zero egress fees, which matters when render
  surfaces pull assets repeatedly).
- Direct-to-storage presigned uploads — never proxy large files through the app
  server.
- `asset` table: workspace-scoped, with content hash, MIME type, dimensions, size.
- Deduplication by content hash. Broadcast teams re-upload the same logo
  constantly.
- Image processing: thumbnails, dimension extraction.
- Asset browser UI: grid, search by name, delete.
- Authorisation: assets are workspace-scoped and enforced through `core`.

**Explicitly deferred:** font management (moved to Phase 3 — it is a render
determinism problem, not a storage problem, see [§6](#6-revision-notes)),
folders/tagging, video assets, usage tracking ("which scenes use this asset").

### Dependencies

- Phase 0 (workspaces, `core`, auth)
- [D1](./ARCHITECTURE.md#8-open-decisions) — storage provider decided

### Exit criteria

1. A 20 MB image uploads without passing through the Next.js server.
2. Re-uploading a byte-identical file creates no second stored object.
3. Assets are addressable by a stable URL that a render surface can fetch
   without an authenticated session.
4. A user in workspace A cannot fetch or enumerate workspace B's assets.
5. Deleting an asset is safe when nothing references it, and this is tested.

---

## Phase 2 — Scene Engine

**5–7 weeks**

### Goal

A versioned, validated document format that describes a broadcast graphic, and
the persistence layer for it.

### Why this is the most important phase in the roadmap

Every phase from 3 to 16 reads or writes this format. It is the schema we
understand least today and the one most expensive to change later. **Design
before code.** Budget the first 1–2 weeks of this phase as design with no
implementation, producing a written format spec that Phases 3–5 are reviewed
against.

### Deliverables

- **`packages/schema`** — the scene document format. Node tree, node types,
  properties, coordinate space, z-order, groups.
- **Reserved space for animation.** The format must express states and
  transitions *now*, even though the Animation Engine ships in Phase 5.
  Retrofitting animation into a static format is a migration of every scene ever
  created.
- **Reserved space for data binding.** A property must be able to say "my value
  comes from a named input" even though Integrations is Phase 10. Same reasoning.
- **Reserved space for the collaboration model.** See dependencies — this is a
  hard gate.
- **Format versioning from v1**, with a forward-migration path and a test that
  every historical version still loads.
- Validation: a malformed scene fails loudly at the boundary, never half-renders.
- Persistence: `scene` table, project-scoped, save/load through `core`.

### Dependencies

- Phase 0 (`core`, projects)
- Phase 1 (asset reference model — a scene node must be able to point at an asset)
- **[G1](#3-gating-decisions) — rendering technology.** The format is shaped by
  what draws it; DOM/CSS, Canvas2D, and WebGL do not want the same document.
  **Must be decided before design starts.**
- **[G2](#3-gating-decisions) / [P3](./PRODUCT.md#7-open-product-questions) —
  single- or multi-writer.** A single-writer JSON document and a
  CRDT/operation-based document are *different formats*. Retrofitting
  collaborative editing into a document designed as one blob is a rewrite of this
  phase, Phase 4, and Phase 12. **Must be decided before design starts.**

### Exit criteria

1. A written format specification exists, is reviewed, and is committed
   alongside the code.
2. A hand-authored JSON scene loads, validates, and round-trips through
   save/load byte-identically.
3. The format expresses a lower-third with an in-animation and an out-animation
   *on paper*, with no Animation Engine built — proving the reserved space is
   real and not aspirational.
4. A v1 scene still loads after a deliberate v2 migration is added, verified by
   test.
5. An invalid scene produces a specific, actionable error, not a partial render.
6. [ADR-006](./ARCHITECTURE.md#adr-006) is superseded by a new ADR recording the
   format decision and the G1/G2 answers.

### Tracked robustness task — R-001: traversal depth ceiling

**Status:** Open. **Scheduled:** before any release-quality milestone.
**Blocks:** nothing in Phase 2.6. **Must not slip past:** Phase 6 (live).

Every traversal in `engine-scene` recurses once per hierarchy level and throws
`RangeError` past a hard depth, measured by binary search in
`limits.perf.ts` during [P-001](./ENGINE_SCENE_PERFORMANCE_REPORT.md):

| Function | Max depth | | Function | Max depth |
| --- | --- | --- | --- | --- |
| `validateDocument` | ~1,344 | | `countNodes` | ~3,520 |
| `serialize` | ~1,520 | | `walk` | ~4,416 |
| `canonicalize` | ~1,728 | | `pathToNode` | ~6,080 |
| `replaceNode` | ~7,168 | | `findNode` | ~8,832 |

The binding limit is ~1,344. **A scene too deep to validate is also too deep to
save**, and it fails as a crash rather than as degradation.

This is a correctness and robustness defect, not a performance one, which is
why P-001 deliberately did not fix it — converting eight traversals to explicit
stacks is a mechanical change deserving its own commit and its own tests rather
than riding along inside a performance initiative.

No hand-authored scene is likely to reach 1,344 levels. A programmatically
generated one — an importer, a procedural template, a badly-formed third-party
document — is not, and an engine should refuse such a document with a specific
error rather than crash on save.

**Definition of done:** every `engine-scene` traversal uses an explicit stack;
a depth-100,000 document validates, serializes, and round-trips; a depth limit,
if one is kept, is a documented validation error rather than a `RangeError`.

---

## Phase 3 — Rendering Engine

**6–9 weeks**

### Goal

A scene document renders to pixels, deterministically, at 60fps, on a
transparent background, in a browser source — with no editor code present.

### Why the renderer comes before the editor

The document format's real test is not "can a human author it" but "can it be
drawn at frame rate, forever, without drifting." That is the constraint that can
invalidate Phase 2's design, and the render surface is what enforces it. Finding
a format problem here costs a Phase 2 revision. Finding it after Phase 4 costs
the editor too — the single largest UI in the product.

Secondary benefit: this phase is demoable on air with hand-written JSON. A real
graphic in real OBS is a stronger artifact than an editor with nothing behind it,
and it arrives months earlier.

### Deliverables

- **`apps/render`** — its own app, so bundle isolation is enforced by the package
  manager rather than by discipline
  ([ARCHITECTURE.md §6.2](./ARCHITECTURE.md#62-render-surface)).
- Scene runtime: interprets a document, builds the render tree, draws it.
- Primitive node types only: **text, rectangle, image, group.** Broadcast
  components are Phase 7.
- Transparent background output, correct alpha compositing.
- **Font pipeline** — upload, subsetting, and *guaranteed load before first
  paint*. A font swapping mid-broadcast is a visible on-air failure; this is a
  render determinism problem, which is why it lives here and not in Phase 1.
- Deterministic timing driven by the display refresh loop, not by React state.
- A frame-rate test harness measuring dropped frames under sustained load.
- Render surface URL: unguessable per-project token, no session cookie required
  (OBS will not carry one).

### Dependencies

- Phase 2 (the format)
- Phase 1 (assets to render)
- [G1](#3-gating-decisions) resolved in Phase 2

### Exit criteria

1. A hand-authored scene renders correctly as an OBS browser source with a
   transparent background over live video.
2. **Zero dropped frames over a 60-minute continuous run** at 1920×1080/60fps on
   a mid-range laptop while OBS is encoding.
3. Custom fonts are fully loaded before the first painted frame — verified, not
   assumed.
4. The `apps/render` bundle contains no editor, no `packages/core`, and no
   database client. Enforced by a build-time check, not review.
5. A malformed or unreachable scene renders nothing rather than an error overlay.
   Never put a stack trace on air.
6. Memory is flat over a 60-minute run — no leak that would kill a long event.

---

## Phase 4 — Scene Editor

**9–12 weeks · largest phase in the roadmap**

### Goal

A user can build a broadcast graphic visually and it persists.

### Deliverables

Split into two sub-phases so that something ships mid-phase.

**4a — Core editing loop (6–7 weeks)**

- Canvas with pan, zoom, and a fixed 1920×1080 broadcast frame guide
- Place, select, move, and resize primitive nodes
- Layer tree with reorder, rename, group, show/hide, lock
- Property inspector: position, size, colour, typography, opacity
- Asset picker wired to Phase 1
- Save / load / autosave
- **Undo/redo** — not deferrable. An editor without it is unusable, and its
  design constrains everything after it. If G2 chose an operation-based document,
  undo/redo must be built on that operation log, not on snapshots.
- Live preview using the Phase 3 runtime — **the same runtime**, not a
  reimplementation. Two renderers means the editor lies about what goes on air.

**4b — Production editing (3–5 weeks)**

- Multi-select, align, distribute, snap guides
- Keyboard shortcuts and a shortcut map
- Copy/paste/duplicate, including across projects
- Editor performance work: scenes of 100+ nodes must stay responsive

### Dependencies

- Phase 3 (the runtime — reused for preview, not rebuilt)
- Phase 2 (format), Phase 1 (assets)
- [G2](#3-gating-decisions) — undo/redo architecture follows from it

### Exit criteria

1. A user with no BracketX experience builds a recognisable lower-third in under
   10 minutes, unaided, observed.
2. That graphic renders **identically** in the editor preview and in the OBS
   browser source. Any divergence is a bug in the shared-runtime rule.
3. Undo/redo is correct across 50 mixed operations including group and delete.
4. Autosave loses no work when the tab is killed mid-edit.
5. A 100-node scene edits without perceptible input lag.

---

## Phase 5 — Animation Engine

**6–8 weeks**

### Goal

Graphics animate in, out, and between states, authored in the editor and executed
identically on the render surface.

### Why animation is in MVP

A lower-third that pops in without animation reads as amateur to any broadcast
audience. This is not polish; it is the baseline expectation of the medium. A
product that cannot animate cannot go on air professionally.

### Deliverables

- Animation runtime **living with the renderer, framework-agnostic.** Driven by
  the frame loop, not by React state. If the editor drives animation through
  component re-renders, the render surface cannot reuse it and we end up with two
  animation implementations that disagree — see [§6](#6-revision-notes).
- State model: in / idle / out, plus named states for data changes
- Property interpolation with a standard easing set
- Timing: duration, delay, stagger across children
- Timeline UI in the editor: scrub, preview, per-property timing
- Deterministic playback — the same animation from the same start point produces
  the same frames every time

**Deferred:** motion paths, physics, per-node custom easing curves, video
transitions.

### Dependencies

- Phase 2 reserved the animation space in the format (hard prerequisite)
- Phase 3 (frame loop)
- Phase 4a (a UI to author it in)

### Exit criteria

1. A lower-third animates in, holds, and animates out, authored entirely in the
   editor.
2. The animation is frame-identical between editor preview and render surface.
3. Animation holds 60fps with 10 simultaneously animating nodes.
4. Replaying the same animation twice produces identical frame timings.
5. A scene that enters mid-animation (render surface loaded late) settles to a
   correct state rather than freezing part-way.

---

## Phase 6 — Live Production

**7–9 weeks**

### Goal

An operator can put a graphic on air, change its data, and take it off air,
live, from a control surface.

### Why this comes before Graphics Components

This was **swapped** during the critique pass. Live Production is the riskiest
remaining technical unknown — persistent transport, sub-second latency,
on-air reliability. Graphics Components is well-understood breadth work. Doing
the risky phase first means discovering transport problems while there is still
schedule to absorb them, and it means the component library is designed with
real on-air usage informing it rather than guesses.

Going on air needs *a* graphic, not *many*. Primitives plus animation suffice.

### Deliverables

- **Realtime transport.** Evaluate managed providers (Liveblocks, PartyKit, or
  similar) before building a service, per
  [ADR-003](./ARCHITECTURE.md#adr-003). Any candidate must verify Better Auth
  JWTs — confirm before selecting
  ([ADR-002](./ARCHITECTURE.md#adr-002) cost #2). Resolves
  [D2](./ARCHITECTURE.md#8-open-decisions) (hosting).
  **The choice must also be viable for Phase 12's collaborative editing** — two
  separate realtime systems is a failure mode we can avoid for free by checking
  now.
- **Control surface** — a distinct UI from the editor. Dense, keyboard-driven,
  large targets, no destructive actions, unambiguous about what is currently on
  air. Built for someone under live pressure.
- Show state model: on air, queued, off air. Single source of truth.
- Take / clear / next, with keyboard bindings
- **Manual data entry** — the operator types the score. Automatic data-source
  binding is Phase 10; typing it is a perfectly viable MVP and the format already
  reserves the binding.
- Reconnection: a render surface that drops rejoins and resyncs to current state
  without an operator touching it
- **On-air telemetry** — render surface health, connection state, frame drops,
  visible to the operator. Moved into this phase during critique: a live product
  that cannot tell you it is failing is not shippable.

### Dependencies

- Phase 5 (animated graphics to put on air)
- Phase 3 (render surface)
- [P3](./PRODUCT.md#7-open-product-questions) answered in Phase 2

### Exit criteria

1. An operator takes a graphic on air, updates its text, and clears it — from
   control-surface action to on-air change in **under 300ms**.
2. Killing the render surface mid-show and reloading it resyncs to correct
   current state with no operator intervention.
3. Killing the *network* for 10 seconds recovers automatically on restore.
4. A 3-hour continuous show runs with zero dropped connections and zero frame
   drops.
5. The operator can tell, at a glance and without ambiguity, what is on air.
6. No control-surface action can crash or blank the render surface. This is
   tested adversarially.

---

## Phase 7 — Graphics Components

**5–7 weeks**

### Goal

A library of broadcast-ready components covering the common cases, so users
compose rather than build from rectangles.

### Deliverables

- **Lower-third** — name/title, configurable, animated
- **Scoreboard / score bug** — team names, scores, period, clock
- **Ticker** — scrolling text
- **Timer / clock** — count up, count down, stoppable
- **Bracket** — the esports primitive; the product is named for it
- **Roster / lineup** — team and player lists
- Component parameterisation, so one component serves many shows
- **Templates**: save a scene as a reusable template, instantiate from it,
  workspace-scoped. Required now because Phase 14's marketplace needs something
  to distribute — templates are the unit of trade.
- Brand kit: workspace-level colours, fonts, logo defaults applied to components

### Dependencies

- Phase 5 (components animate)
- Phase 6 (real on-air usage informs the library — the reason for the swap)
- Phase 1 (brand assets)

### Exit criteria

1. All six component families are usable, parameterised, and animated.
2. A complete graphics package for one esports match is built from components
   alone, no primitives, in under 30 minutes.
3. Component styling respects the workspace brand kit by default.
4. A template instantiated into a second project renders identically.
5. Each component holds 60fps on the render surface under live conditions.

---

## Phase 8 — AI v1

**4–6 weeks · cuttable**

### Goal

A user describes a graphic in words and gets an editable scene composed from
existing components.

### Scope, deliberately narrow

**In:** prompt → scene, composed from Phase 7 components, respecting the
workspace brand kit, landing in the editor as a normal editable scene.

**Out:** image generation, free-form node generation, animation generation,
conversational editing, AI-driven live operation. Each is a separate bet and none
is needed to validate the thesis.

### Why here, and why cuttable

BracketX is positioned as AI-first
([PRODUCT.md §2](./PRODUCT.md#2-what-that-means-precisely)). Launching with no AI
makes the positioning a claim we cannot support. So it belongs pre-launch.

But it depends on a *stable* Scene Engine and an *existing* component library,
which is why it cannot come earlier — generating into a format that is still
churning means rewriting the generation layer every phase.

**It is the one MVP phase that can be cut** if runway is short. Cut criterion: if
at the start of Phase 8 the team has under 5 months of runway, ship without it
and reposition the launch messaging honestly. Do not ship a bad AI feature to
defend a tagline.

### Deliverables

- Provider integration (resolves [D4](./ARCHITECTURE.md#8-open-decisions))
- Prompt → component-composition pipeline, emitting valid scene documents
  validated by Phase 2's validator before reaching the user
- Brand kit awareness
- Graceful failure: a bad generation produces a clear message, never a broken
  scene
- Cost controls: per-workspace rate limits and usage metering from day one

### Dependencies

- Phase 7 (a component library to compose from) — hard
- Phase 2 (stable, frozen format) — hard
- **[P1](./PRODUCT.md#7-open-product-questions)** — the top-3 AI capabilities.
  Still unanswered. This is a product question engineering cannot resolve.
- [D4](./ARCHITECTURE.md#8-open-decisions) — provider

### Exit criteria

1. Ten realistic prompts produce usable, editable scenes at least 7 times.
2. Every generated scene passes the Phase 2 validator. A generation that would
   produce an invalid scene fails visibly instead.
3. Generated scenes use brand-kit colours and fonts without being asked.
4. Per-workspace cost is metered and capped.
5. A generation failure leaves the user's existing work untouched.

---

## Phase 9 — Public Launch

**5–7 weeks · MVP ships**

### Goal

BracketX is publicly available, paid, supported, and reliable enough to trust
on air.

### Deliverables

- **Billing** — subscription, plan limits, upgrade/downgrade, dunning. Requires
  [P5](./PRODUCT.md#7-open-product-questions) (pricing model) answered; Phase 0's
  exit criteria kept both shapes cheap.
- **Auth completion** — OAuth providers, email verification, password reset, team
  invitations. Deferred from Phase 0; launch is where they become mandatory.
- **Onboarding** — the path from sign-up to first graphic on air. This is the
  metric that matters most
  ([PRODUCT.md §8](./PRODUCT.md#8-how-we-will-know-it-works)): target under
  15 minutes.
- **Reliability** — error tracking, uptime monitoring, alerting, incident
  runbook. A live product needs a defined answer to "it broke during a show."
- **Documentation** — getting started, OBS setup, component reference
- **Support** — a channel, and a defined response expectation
- **Legal** — terms, privacy policy, DPA, cookie handling
- **Marketing site** — replaces the app's landing page
- **Load testing** — concurrent shows, not concurrent page views

### Dependencies

All of Phases 0–8 (Phase 8 optionally cut).
[P5](./PRODUCT.md#7-open-product-questions) answered.

### Exit criteria

1. A stranger signs up, pays, and gets a graphic on air in under 15 minutes
   without contacting support.
2. Ten concurrent live shows run without degradation.
3. Error tracking and alerting are live and have been verified by a deliberately
   induced failure.
4. An on-air incident has a written runbook and a named responder.
5. Billing correctly handles upgrade, downgrade, cancellation, and failed payment.
6. Legal review complete.
7. **At least 3 external teams have run a real show on BracketX before launch
   day.** Launching without this is launching blind.

---

# Post-launch

> Ordered by dependency, **selected by demand**. Only two or three of these fit
> inside the 24-month horizon. Do not work through them in order — let real
> customers choose, then check this section for what that choice requires first.

## Phase 10 — Integrations

**6–8 weeks**

**Goal:** graphics update automatically from external data instead of manual entry.

**Deliverables:** data source connector framework · 1–2 concrete sports/esports
providers · binding UI mapping fields to scene properties · polling and webhook
ingestion · stale-data handling and fallback values · deeper OBS/vMix integration.

**Dependencies:** Phase 6 (live infrastructure) · Phase 2's reserved binding
model · **[P2](./PRODUCT.md#7-open-product-questions)** — which sources first,
still unanswered.

**Exit criteria:** a live score updates on air from a real provider feed with no
operator action · a provider outage degrades to last-known-good and warns the
operator, never blanks the graphic · adding a second provider requires no
framework change.

---

## Phase 11 — Automation

**6–8 weeks**

**Goal:** sequences of graphics run on triggers or a schedule rather than on
clicks.

**Deliverables:** rundown model (ordered show items) · triggers from time, data
conditions, or manual cue · scheduled graphics · conditional logic within a
rundown · dry-run before air.

**Dependencies:** Phase 10 — automation without data is a macro recorder, and the
value is in data-driven triggers.

**Exit criteria:** a complete match rundown executes with a single operator cue ·
a dry-run reports what would happen without touching air · any automated action
can be manually overridden mid-show, instantly.

---

## Phase 12 — Realtime Collaboration

**8–10 weeks**

**Goal:** multiple users edit the same scene simultaneously.

**Deliverables:** conflict resolution over Phase 2's document model ·
presence and cursors · edit locking where conflict resolution is impractical ·
version history and restore · comments.

**Dependencies:** Phase 2's [G2](#3-gating-decisions) decision — **if G2 chose a
single-writer format, this phase is a rewrite of Phases 2 and 4, not a feature.**
That is precisely why G2 gates Phase 2 rather than living here. Phase 6's
transport choice should already support this.

**Exit criteria:** two users edit one scene concurrently without losing work ·
a network partition resolves without corruption · history restores any state from
the last 30 days.

---

## Phase 13 — Plugin SDK

**8–10 weeks**

**Goal:** third parties build custom components.

**Deliverables:** stable public component API · sandboxed execution (untrusted
code must not reach the render surface's frame budget or the user's session) ·
local development harness · versioning and compatibility policy · documentation.

**Dependencies:** Phase 7 **plus meaningful post-launch usage.** The component
API cannot be declared stable until real graphics have stressed it — publishing
an API is a promise, and breaking it later costs more than delaying it.

**Exit criteria:** an external developer ships a working component using only
public docs · a malicious plugin cannot drop frames, crash a show, or access
another workspace · a plugin built against v1 still runs after a platform release.

---

## Phase 14 — Marketplace

**6–8 weeks**

**Goal:** users discover, install, and sell templates and plugins.

**Deliverables:** listings, search, install flow · versioning and updates ·
paid listings with revenue share · review and moderation · creator payouts.

**Dependencies:** Phase 7 (templates as the unit of trade) · Phase 13 (plugins) ·
Phase 9 (billing) · **[P4](./PRODUCT.md#7-open-product-questions)**.

**Exit criteria:** a creator publishes a paid template and receives a payout ·
installing a template into a workspace renders identically to the author's ·
moderation can remove a listing and handle already-installed copies.

---

## Phase 15 — Cloud Platform

**10–14 weeks · largest post-launch phase**

**Goal:** BracketX renders in the cloud, removing the operator's machine from the
critical path.

**Deliverables:** server-side rendering of scenes · cloud video egress
(SRT/RTMP/WebRTC) · render farm orchestration and autoscaling · per-render
metering and billing · multi-region.

**Dependencies:** Phase 6 · Phase 9 (billing to meter against) · **proven
demand.** This is the largest infrastructure bet in the roadmap and the one most
likely to be built on an assumption. It changes BracketX's cost structure from
near-zero marginal to per-minute-of-render. Do not start it without customers
asking.

**Exit criteria:** a show renders entirely cloud-side and reaches a streaming
platform with no local render surface · cloud output matches browser-source
output frame-for-frame · cost per render-hour is known and priced above cost.

---

## Phase 16 — Enterprise

**8–10 weeks**

**Goal:** BracketX passes procurement at a broadcaster or large organisation.

**Deliverables:** SAML/OIDC SSO · SCIM provisioning · granular RBAC beyond
owner/admin/member · audit logging · data residency options · SLA and status page
· security questionnaire and penetration test · invoiced billing.

**Dependencies:** Phase 9 · **inbound enterprise demand.** Enterprise features
built speculatively are the classic small-team trap: months of work that no
current customer needs and no prospect has asked for.

**Exit criteria:** an enterprise prospect completes security review without a
custom engineering commitment · SSO works against a real corporate IdP ·
audit log answers "who changed what, when" for any object.

---

## 3. Gating decisions

Decisions that block a phase from *starting*. Not deliverables — prerequisites.

| ID | Decision | Gates | Why it cannot wait |
|---|---|---|---|
| ~~**G1**~~ | ~~Rendering technology~~ — **RESOLVED 2026-07-30** | Phase 2 | Retained-mode scene graph, deterministic pipeline, Canvas2D backend first; WebGL2 planned, WebGPU deferred pending OBS/CEF verification. See [RFC-001](./RFC-001-rendering-architecture.md). |
| ~~**G2**~~ | ~~Single- or multi-writer documents~~ — **RESOLVED 2026-07-30** | Phase 2 | Snapshot at rest, operations in motion. Stable ids, fractional sibling ordering, and operations-only mutation adopted; no CRDT built. See [RFC-002](./RFC-002-scene-document-model.md). Note this resolves the *architectural* half only — [P3](./PRODUCT.md#7-open-product-questions) is still open as a product question. |
| [D1](./ARCHITECTURE.md#8-open-decisions) | Asset storage provider | Phase 1 | Nothing blocks it. Just decide. |
| [D2](./ARCHITECTURE.md#8-open-decisions) | Hosting for realtime | Phase 6 | Follows from the transport choice. |
| [P5](./PRODUCT.md#7-open-product-questions) | Pricing model | Phase 9 | Phase 0 kept both shapes cheap; billing needs one chosen. |
| [P1](./PRODUCT.md#7-open-product-questions) + [D4](./ARCHITECTURE.md#8-open-decisions) | AI scope and provider | Phase 8 | Product question. Engineering cannot resolve it. |
| [P2](./PRODUCT.md#7-open-product-questions) | First data sources | Phase 10 | Post-launch; real customers will answer it. |
| [P4](./PRODUCT.md#7-open-product-questions) | Marketplace timing | Phase 14 | Post-launch. |

**G1 and G2 are resolved** as of 2026-07-30, ahead of Phase 2, by
[RFC-001](./RFC-001-rendering-architecture.md) and
[RFC-002](./RFC-002-scene-document-model.md). The canonical schema they imply is
[SCENE_FORMAT.md](./SCENE_FORMAT.md). Phase 2 is unblocked.

The remaining urgent item is [P3](./PRODUCT.md#7-open-product-questions) — a
product question, not an engineering one. RFC-002 removes the schedule pressure
by making the document collaboration-ready either way, but the answer still
decides whether Phase 12 gets built at all and whether the fractional-ordering
cost was worth paying.

## 4. Dependency graph

Arrows are hard blocks.

```
Phase 0  Foundation
   │
   ├──> Phase 1  Asset Manager ──────┐         [needs D1]
   │                                 │
   └─────────────────────────────────┴──> Phase 2  Scene Engine
                                              │    [needs G1 + G2]
                                              ▼
                                          Phase 3  Rendering Engine
                                              │
                                              ▼
                                          Phase 4  Scene Editor  (4a → 4b)
                                              │
                                              ▼
                                          Phase 5  Animation Engine
                                              │
                                              ▼
                                          Phase 6  Live Production
                                              │    [needs D2]
                                              ▼
                                          Phase 7  Graphics Components
                                              │
                                              ▼
                                          Phase 8  AI v1  [needs P1 + D4]
                                              │            (cuttable)
                                              ▼
                                          Phase 9  PUBLIC LAUNCH  [needs P5]
                                              │
        ┌──────────────┬──────────────┬───────┴───────┬──────────────┐
        ▼              ▼              ▼               ▼              ▼
   Phase 10       Phase 12       Phase 13        Phase 15       Phase 16
   Integrations   Realtime       Plugin SDK      Cloud          Enterprise
   [needs P2]     Collab         [needs usage]   Platform       [needs demand]
        │         [needs G2]          │          [needs demand]
        ▼                             ▼
   Phase 11                      Phase 14
   Automation                    Marketplace  [needs P4]
```

The MVP path is almost entirely serial. That is a real constraint of a 2–3 person
team, not a planning failure — and it is why the critical path is 13–18 months.

## 5. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| **G1/G2 decided late or wrongly** | Rewrites Phase 2, and possibly 4 and 12 | Decide both before Phase 2 design. Default to operation-based documents even if collaboration ships late — the cost is small, the reverse is a rewrite. |
| **Phase 3 cannot hit 60fps** | Invalidates G1; re-do the renderer | Build the frame-rate harness in week 1 of Phase 3, not at the end. Test on mid-range hardware, not the dev machine. |
| **Phase 4 overruns** | Largest phase; pushes launch out | Split at 4a/4b. 4b can slip past Phase 6 without blocking on-air. |
| **Two animation implementations** | Editor preview disagrees with air | Phase 5's runtime is framework-agnostic and shared. Exit criterion 2 tests it. |
| **Two realtime systems** | Phase 12 rebuilds Phase 6's transport | Evaluate Phase 6 transport against Phase 12's needs at selection time. |
| **Product questions unanswered** | P1, P2, P3 all block phases; engineering cannot unblock them | P3/G2 is due in ~8 weeks and is the most urgent. |
| **13–18 months to revenue** | Runway risk | Phase 3 is demoable on air months before launch. Use it for design partners and pre-sales. |
| **Cloud Platform built speculatively** | 10–14 weeks on an assumption; changes cost structure | Gated on demand, explicitly. |

## 6. Revision notes

What the self-critique pass changed, recorded so the ordering is not
"improved" back into its broken form.

1. **Swapped Live Production ahead of Graphics Components.** Originally
   components came first. Wrong: going on air needs *a* graphic, not many.
   Live Production is the riskiest remaining unknown and belongs earlier where
   schedule can absorb overrun; component breadth is understood grind work and
   benefits from real on-air usage informing it.

2. **Promoted the collaboration decision (G2/P3) from Phase 12 to a gate on
   Phase 2.** The original draft treated collaborative editing as a post-launch
   feature. It is not — it is a *format* decision. Discovering in Phase 12 that
   the document is a single-writer blob makes collaboration a rewrite of the
   Scene Engine and the Editor. This was the most serious dependency break found.

3. **Added G1 (rendering technology) as a gate on Phase 2.** The original draft
   had rendering technology implicitly decided in Phase 3. But the format is
   shaped by what renders it, so the decision must precede the format.

4. **Moved font handling from Phase 1 to Phase 3.** Fonts look like a storage
   problem and are actually a render-determinism problem — a font swapping
   mid-broadcast is a visible on-air failure. It belongs with the frame loop.

5. **Moved on-air telemetry from Phase 9 to Phase 6.** A live product that cannot
   tell you it is failing is not shippable, and Phase 6 is where "live" begins.

6. **Split Phase 4 into 4a/4b.** At 9–12 weeks it was the largest phase with no
   intermediate delivery. 4b (editor productivity) can slip past Phase 6 without
   blocking on-air.

7. **Added the shared-runtime constraint explicitly** to Phases 4 and 5. Nothing
   in the original draft prevented the editor from reimplementing rendering and
   animation, which would make the preview lie about what goes on air.

8. **Kept AI pre-launch but made it explicitly cuttable, with a stated
   criterion.** Launching an "AI-first" platform with no AI is a positioning
   failure; shipping bad AI to defend a tagline is worse. Both risks are now
   named, with a runway threshold to decide between them.

9. **Added billing-shape awareness to Phase 0's exit criteria.** Pricing
   ([P5](./PRODUCT.md#7-open-product-questions)) is unanswered but affects the
   membership model being built now. Keeping both shapes cheap costs nothing
   today.

10. **Added templates to Phase 7.** Phase 14's marketplace needs a unit of
    trade. Not an invented feature — a prerequisite that was missing.

11. **Reframed post-launch from a queue to a demand-selected set.** The original
    ordering implied all of Phases 10–16 would be built in sequence. At 52–68
    weeks they do not fit in the 24-month horizon, and pretending otherwise
    would make the document dishonest.
