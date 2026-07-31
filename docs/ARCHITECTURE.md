# BracketX — Architecture

**Status:** Authored 2026-07-30 during Sprint 1 · **Owner:** @Pixelborne

> **Scope note (2026-07-30).** BracketX was reframed as a real-time 3D
> production engine. [ENGINE_ARCHITECTURE.md](./ENGINE_ARCHITECTURE.md) is now
> the highest-level technical document. This file remains authoritative for the
> **platform** — auth, tenancy, persistence, packages, deployment — all of which
> the reframing leaves intact. [ADR-009](#adr-009) is superseded by
> [ADR-011](#adr-011).

> **Read this first.** This document was *authored*, not transcribed. Prior to
> Sprint 1 the repository was an unmodified `create-turbo` scaffold and no
> architecture existed in any form. Every decision below was made on 2026-07-30
> and is recorded in §9 with its rationale and its cost.
>
> From here on, this document is the source of truth. Changing anything in §2–§7
> means adding an ADR to §9 — not editing the prose and moving on.

---

## 1. Principles

Five rules. When a decision is unclear, these break the tie.

1. **Build for the current sprint; design for the known boundary.** We do not
   build the realtime service or the render surface in Phase 0. We do refuse to
   write code that makes them expensive to add. Naming a seam is free; crossing
   it later is not.
2. **The render surface is sacred.** Anything that could drop a frame on air
   loses to anything that could not. This principle outranks developer
   convenience, bundle elegance, and code reuse.
3. **Business logic lives in `packages/`, not in `apps/`.** Apps are thin
   delivery shells — routing, rendering, transport. Any rule that both the web
   app and a future realtime service would need must not be written inside a
   Next.js route handler.
4. **Own the data layer.** Schema, migrations, and queries live in this
   repository as code we control. Vendors may host our Postgres; they may not
   define our schema.
5. **Boring where it does not differentiate.** Postgres, not a graph database.
   Server-rendered forms, not a client-state framework. Spend novelty budget on
   live graphics and AI authoring, which is what BracketX is actually for.

## 2. Stack

| Layer | Choice | ADR |
|---|---|---|
| Monorepo | Turborepo + pnpm workspaces | inherited |
| App framework | Next.js 16 (App Router), React 19 | inherited |
| Language | TypeScript, `strict`, `noUncheckedIndexedAccess` | inherited |
| Database | Postgres | [ADR-002](#adr-002) |
| ORM / migrations | Drizzle ORM + drizzle-kit | [ADR-002](#adr-002) |
| Auth | Better Auth (+ organization plugin) | [ADR-002](#adr-002) |
| Styling | Tailwind CSS v4 | [ADR-004](#adr-004) |
| UI primitives | Radix UI | [ADR-004](#adr-004) |
| Validation | Zod (shared between client and server) | [ADR-005](#adr-005) |
| Realtime | *Undecided — reserved seam* | [ADR-003](#adr-003) |
| Asset storage | *Undecided — see §8/D1* | — |
| Hosting | *Undecided — see §8/D2* | — |

## 3. Repository layout

### As of end of Phase 0

```
bracketx/
├── apps/
│   └── web/                    Next.js — marketing, auth, dashboard, editor
├── packages/
│   ├── db/                     Drizzle schema, migrations, client   [new]
│   ├── auth/                   Better Auth config, session helpers  [new]
│   ├── core/                   Domain logic: workspaces, projects    [new]
│   ├── ui/                     Shared React primitives (Tailwind + Radix)
│   ├── eslint-config/
│   └── typescript-config/
├── docs/                       PRODUCT · ARCHITECTURE · ROADMAP
└── .github/workflows/ci.yml
```

### Reserved — do not create until its sprint

```
packages/schema/                Graphics document format           (Phase 2)
apps/render/                    Broadcast render surface           (Phase 3)
apps/realtime/                  Long-lived connection service      (Phase 6)
```

These are named here so that when they arrive they land in a shape we already
agreed on. Creating them empty now would be over-engineering; they would drift
and rot before first use.

### Dependency direction

Strictly one-way. A cycle here is a bug, not a style preference.

```
apps/web ──┐
           ├──> packages/core ──> packages/db
apps/*  ───┘         │
                     └────────> packages/auth ──> packages/db

packages/ui         (leaf — React only, no domain imports, ever)
```

`packages/ui` importing from `packages/core` or `packages/db` is forbidden. The
moment a UI primitive knows what a Workspace is, the render surface can no longer
use it without dragging the database client along.

## 4. Why `packages/core` exists

This is the least obvious decision here, so it gets its own section.

The tempting Sprint 1 shape is: Next.js server actions call Drizzle directly.
Fewer files, less indirection, ships faster. It is genuinely the right call for
many products.

It is the wrong call for BracketX, for one reason: **we already know a second
consumer is coming.** Per [ADR-003](#adr-003), a long-lived realtime service
will need to answer "may this connection join this project's show?" — which
means resolving a session to a user, a user to a workspace membership, and a
membership to a permission. If that logic lives inside a Next.js server action,
the realtime service cannot call it. We would either duplicate it (two
divergent authorisation implementations — a security bug waiting to happen) or
refactor under deadline pressure in
[Phase 6](./ROADMAP.md#phase-6--live-production).

So: **authorisation and domain rules go in `packages/core` from the first line
of code.** Route handlers and server actions are allowed to do exactly three
things — parse input with Zod, call `core`, and shape the response.

The cost, stated honestly: one extra module hop and a little more ceremony per
feature in Phases 0–5, before the second consumer exists to justify it. I
consider that a fair price for not having two authorisation code paths. If
[ADR-003](#adr-003) is ever reversed — if BracketX turns out not to need a
realtime service — then `packages/core` becomes unnecessary indirection and
should be collapsed back into the app.

## 5. Data model — Phase 0

> Verified against a live PostgreSQL 17.10 server on 2026-07-30. Tables,
> indexes, foreign keys, delete actions, and the differences between Better
> Auth's documentation and what it actually generates are recorded in
> [DATABASE.md](./DATABASE.md).

Better Auth's organization plugin owns `user`, `session`, `account`,
`verification`, `organization`, `member`, and `invitation`. We do not hand-write
those; we generate them and commit the migration.

**`organization` *is* our workspace.** We are not adding a parallel `workspace`
table that shadows it. One concept, one table.

The only table we author ourselves in Phase 0:

```
project
  id            uuid, pk
  organizationId text, fk -> organization.id, cascade delete
  name          text, not null
  slug          text, not null          -- unique per organization
  createdById   text, fk -> user.id
  createdAt     timestamptz, not null
  updatedAt     timestamptz, not null

  unique (organizationId, slug)
  index  (organizationId)
```

Notes on shape:

- **`slug` is unique per organization, not globally.** Two workspaces may both
  have a project called `season-opener`. Global uniqueness would leak one
  customer's naming into another's namespace and force ugly disambiguation in
  URLs.
- **No `documents`, `scenes`, `layers`, or `assets` yet.** The graphics document
  format is Phase 2 work ([ADR-006](#adr-006)) and guessing at it now would
  produce a schema we migrate away from before anyone uses it.
- **Cascade delete from organization.** Deleting a workspace must not leave
  orphaned projects. Revisit when soft-delete/retention becomes a requirement.

### Authorisation model

Better Auth's organization plugin provides `owner` / `admin` / `member`. Phase 0
uses these as-is and enforces exactly one rule: **you can only see and act on a
project if you are a member of its organization.** That check lives in
`packages/core` and every entry point calls it.

Per-project roles, guest access, and broadcast-operator-only roles are deferred
until [PRODUCT.md/P3](./PRODUCT.md#7-open-product-questions) resolves whether we
are single- or multi-operator.

## 6. The two reserved boundaries

### 6.1 Realtime

**The constraint:** live graphics need sub-second, bidirectional, persistent
connections between an operator's control surface and one or more render
surfaces.

**The trap:** Next.js has no long-lived WebSocket server, and on serverless
hosts it cannot have one. A codebase that treats "Next.js route handlers are the
backend" as an axiom hits a wall the first time it needs a persistent socket, and
pays for it in a rushed retrofit through auth, data access, and deploy.

**The rule for Phases 0–5:** no domain logic in route handlers (§4). This is
the entire mitigation. It costs nothing now.

**Phase 6:** evaluate a managed provider (Liveblocks, PartyKit, or similar)
before building anything ourselves. Note a consequence of
[ADR-002](#adr-002): because auth is Better Auth rather than a bundled
platform, any provider must verify our tokens — confirm the provider supports
custom JWT/JWKS auth *before* selecting it.

### 6.2 Render surface

**The constraint:** the render surface is consumed as a browser source and must
hold frame rate under sustained load, on the operator's machine, alongside an
encoder.

**The rule:** the render surface never imports editor code. Its bundle contains
the graphics runtime and nothing else. It ships no editor state management, no
inspector, no AI panel, no `packages/core`.

**Phase 3:** promote it to `apps/render` — a separate app with its own
dependency list, so the boundary is enforced by the package manager rather than
by discipline. Until then it does not exist, and no route in `apps/web` should
pretend to be it.

## 7. Conventions

**Server-first.** Server Components by default. `"use client"` is a deliberate
choice for interactivity, not a habit. The editor will be heavily client-side;
the dashboard and auth flows should be almost entirely server-rendered.

**Mutations.** Server Actions for form-driven mutations. Every action: validate
with Zod → call `core` → return a typed result. Never trust a client-supplied
`organizationId`; always re-derive membership server-side from the session.

**Errors.** `core` throws typed domain errors. Apps translate them to HTTP status
or UI state. A raw Drizzle or Postgres error must never reach a user.

**Environment variables.** Every build-time variable is declared in
[turbo.json](../turbo.json) under `tasks.build.env` *and* documented in
[.env.example](../.env.example). Undeclared variables are excluded from
Turborepo's cache hash, which lets a build made against staging values be served
as a production cache hit. This has bitten every monorepo that skipped it.

**Migrations.** Generated by drizzle-kit, committed, reviewed like code, applied
forward-only. No editing an applied migration.

## 8. Open decisions

| # | Decision | Blocked on | Needed by |
|---|---|---|---|
| D1 | Asset storage for media (S3, Cloudflare R2, …) | Nothing — just needs deciding. Broadcast graphics are asset-heavy; this cannot slip far. | [Phase 1](./ROADMAP.md#phase-1--asset-manager) |
| D2 | Hosting for `apps/web`, and separately for `apps/realtime` | Whether the realtime service is managed ([ADR-003](#adr-003)). Vercel suits `web`; it cannot host a persistent socket server. | [Phase 6](./ROADMAP.md#phase-6--live-production) |
| D3 | Test strategy and runner | Nothing. Recommendation: Vitest, landing with `packages/core` now so authorisation logic is tested from day one. | [Phase 0](./ROADMAP.md#phase-0--foundation) |
| D4 | AI provider and where inference runs | [PRODUCT.md/P1](./PRODUCT.md#7-open-product-questions) | [Phase 8](./ROADMAP.md#phase-8--ai-v1) |
| ~~D5~~ | ~~Graphics document format and versioning~~ | **Resolved 2026-07-30** — [SCENE_FORMAT.md](./SCENE_FORMAT.md), per [ADR-010](#adr-010) | — |
| ~~D6~~ | ~~Rendering technology~~ | **Resolved 2026-07-30** — [RFC-001](./RFC-001-rendering-architecture.md), per [ADR-009](#adr-009) | — |

## 9. Decision log

Append-only. Superseding an ADR means adding a new one that says so.

---

### ADR-001
**Delete the duplicate `apps/docs` application** · 2026-07-30 · Accepted

`create-turbo` scaffolds two byte-identical Next.js apps differing only in port.
The second had no content and no purpose, but would have doubled install time,
dependency-bump surface, lint runs, and CI build time for the life of the repo.

Documentation now lives in `docs/` as markdown — reviewable in pull requests, no
build step. A public marketing or documentation site can be scaffolded in minutes
when one is actually wanted.

*Cost:* if a docs site is needed soon, we re-scaffold. Cheap, and recoverable
from git history regardless.

---

### ADR-002
**Better Auth + Postgres + Drizzle** · 2026-07-30 · Accepted

Chosen by the project owner over a Supabase-bundled alternative.

*Rationale:* no auth vendor lock-in and no per-MAU cost; authentication,
sessions, and membership data all live in our own Postgres. Better Auth's
organization plugin models workspaces, members, invitations, and roles directly,
which covers most of the Sprint 1 goal. Drizzle keeps schema and queries in the
repository as reviewable TypeScript, so the Postgres host is a swappable
implementation detail.

*Costs, accepted knowingly:*
1. More Sprint 1 work than a bundled platform — OAuth providers, email
   verification, and password reset are ours to wire and maintain.
2. No bundled realtime. Any provider selected under [ADR-003](#adr-003) must
   support custom JWT/JWKS verification against Better Auth.
3. No bundled object storage. Asset storage becomes open decision D1.

*Rejected:* Clerk (organizations are excellent, but membership would live in a
vendor and storage/realtime were still needed elsewhere); Supabase (best
one-vendor coverage, rejected in favour of ownership); Prisma + Auth.js (heavier
serverless bundles, awkward App Router session handling).

---

### ADR-003
**Reserve a realtime boundary; do not build it in Sprint 1** · 2026-07-30 · Accepted

BracketX is a live product and will need persistent connections. Next.js cannot
provide them on a serverless host.

*Decision:* name `apps/realtime` as a reserved path and enforce "no domain logic
in route handlers" (§4) from the first commit. Build nothing. In
[Phase 6](./ROADMAP.md#phase-6--live-production), evaluate managed providers
before writing a service.

*Rationale:* this is the cheapest possible insurance against the most likely
source of structural rework. Building the service in Sprint 1 would add a deploy
target, a second auth path, and infrastructure work to a sprint whose goal
("sign in → workspace → project → editor") needs none of it.

*Cost:* the indirection in §4 is unpaid-for until Phase 6. If BracketX turns out
not to need realtime at all, `packages/core` is wasted structure. I judge that
unlikely enough to accept.

---

### ADR-004
**Tailwind CSS v4 + Radix UI** · 2026-07-30 · Accepted

Replaces the scaffold's CSS Modules.

*Rationale:* a live production editor is dense UI — panels, inspectors,
timelines, popovers, drag targets. CSS Modules would mean dozens of
`.module.css` files and hand-rolled interactive primitives. Radix supplies
unstyled, accessible dialogs, dropdowns, tooltips, and sliders, so we are not
maintaining our own focus traps and keyboard navigation — which we would
otherwise get subtly wrong and own forever.

*Cost:* Tailwind's utility classes are verbose in markup, and Radix is a
dependency in the critical path of the editor UI. Both are mainstream and
replaceable at the component level.

*Constraint:* `packages/ui` remains a leaf (§3). Render-surface styling will be
evaluated separately in Phase 3 — Tailwind is a build-time tool and should be
fine, but "sacred" (§1.2) means we verify rather than assume.

---

### ADR-005
**Zod as the single validation boundary** · 2026-07-30 · Accepted

One schema per input shape, defined in `packages/core`, used by both the server
action that validates it and the client form that mirrors it. Avoids the classic
drift where client and server disagree about what is valid.

*Cost:* a runtime dependency and some duplication against TypeScript types,
mitigated by inferring types from schemas rather than declaring both.

---

### ADR-006
**Do not model the graphics document in Sprint 1** · 2026-07-30 · Accepted

`project` holds only identity and ownership. Scenes, layers, bindings, and assets
are deferred to [Phase 2](./ROADMAP.md#phase-2--scene-engine)'s
`packages/schema`.

*Rationale:* the graphics document format is the most consequential schema in the
product and the one we understand least on 2026-07-30. A guess made now would be
migrated away from before a user touched it, and every migration on a
production-shaped table costs more than the one before it.

*Cost:* Phase 0's editor route is a shell with nothing to edit. That is the
correct state for a foundation phase.

---

### ADR-007
**Namespace workspace URLs under `/w/`** · 2026-07-30 · Accepted

Workspace routes are `/w/[workspace]` and `/w/[workspace]/[project]`, not bare
`/[workspace]/[project]` as sketched in §3 earlier.

*Rationale:* two concrete problems with the bare form.

1. **Slug squatting breaks routing.** `organization.slug` is globally unique and
   user-chosen ([DATABASE.md §2](./DATABASE.md)). With bare routes, whoever
   registers the workspace `sign-in`, `api`, or `workspaces` shadows a real
   route. Reserved-word blocklists are a maintenance burden that grows with
   every new top-level page.
2. **Middleware cannot cheaply tell protected from public.** A bare
   `/[workspace]` forces the matcher to be `/:path*` minus an exclusion list of
   every public path — fragile, and failing open is a security bug rather than a
   cosmetic one. A `/w/` prefix makes protection a clean prefix match.

*Cost:* two extra characters in every workspace URL, and a redirect to write if
the bare form is ever wanted for marketing reasons.

---

### ADR-008
**Client-safe action state is a separate module from server error mapping**
· 2026-07-30 · Accepted

`app/actions/state.ts` holds the `ActionState` type and `idle` and imports
nothing. `app/actions/errors.ts` holds the error mapper, imports
`@bracketx/core`, and is marked `server-only`.

*Rationale:* found by a failing build, not by review. Client components need
`idle` as their initial `useActionState` value, so anything that module imports
enters the browser bundle. With both in one file, the chain
`@bracketx/core → @bracketx/auth → @bracketx/db → pg` pulled the **Postgres
driver into the client build**.

The `server-only` marker makes a recurrence a build error rather than something
that has to be noticed in a bundle report.

*Cost:* one extra module, and a rule to remember: anything a client component
imports must import nothing from `packages/`.

---

### ADR-009
**Rendering: retained-mode scene graph, Canvas2D backend first** · 2026-07-30 · Accepted

Resolves D6 / roadmap gate G1. Full argument in
[RFC-001](./RFC-001-rendering-architecture.md).

A deterministic, time-addressable pipeline (resolve → layout → animate →
compose → rasterize) whose first four phases are backend-independent. Canvas2D
rasterizes v1; WebGL2 is the planned second backend; WebGPU is deferred until
its availability inside OBS's embedded CEF is verified.

*Rationale:* the render surface's real runtime is OBS's CEF, not Chrome, and
transparent output forces grayscale antialiasing on every option — which erases
DOM/CSS's usual text advantage while leaving its lack of time-addressability
disqualifying for editor scrubbing and Phase 15 cloud rendering.

*Cost:* Canvas2D provides no text layout, so line breaking, alignment, and
fit-to-box are ours to build. Bounded for broadcast graphics, but real work.

---

### ADR-010
**Documents: snapshot at rest, operations in motion** · 2026-07-30 · Accepted

Resolves D5 and roadmap gate G2. Full argument in
[RFC-002](./RFC-002-scene-document-model.md); the schema is
[SCENE_FORMAT.md](./SCENE_FORMAT.md). Supersedes
[ADR-006](#adr-006)'s deferral.

Stored documents are JSON snapshots. In-memory edits go exclusively through
typed, invertible operations grouped into transactions. Three
collaboration-readiness properties are adopted — stable node ids, fractional
sibling ordering, operations-only mutation — while no CRDT, merge algorithm, or
multi-writer code is built.

*Rationale:* undo becomes correct by construction rather than inferred from
diffs, and answering [P3](./PRODUCT.md#7-open-product-questions) "yes" later
becomes additive instead of a rewrite of Phases 2 and 4.

*Cost:* every editor mutation needs an operation with a correct inverse, and
fractional indices make documents marginally less readable. If P3 resolves to
single-operator permanently, fractional ordering can be dropped and the rest
still pays for itself in undo correctness.

---

### ADR-011
**3D-first engine; adopt the rasterizer rather than build it** · 2026-07-30 · Accepted
**Supersedes [ADR-009](#adr-009).**

BracketX is a real-time 3D production engine. Canvas2D cannot express a
perspective camera, depth, lighting, or meshes, so ADR-009's conclusion is void.
Full argument in [RFC-003](./RFC-003-rendering-architecture-3d.md).

WebGPU-first with a WebGL2 fallback behind one backend abstraction, capabilities
**tiered** rather than reduced to the intersection. An existing WebGPU-capable
3D engine provides meshes, materials, lighting, and GPU resource management; our
scene graph stays authoritative and its object graph is a rebuildable cache.

*Rationale:* a 3D engine renders 2D nearly free while a 2D engine can never
become 3D, so the foundation is decided by the content that cannot be
retrofitted. On adopt-vs-build, the industry has already answered — Pixotope,
Zero Density, and disguise all build broadcast production systems on Unreal
rather than writing rasterizers. The renderer is table stakes; the production
layer is the moat.

*Costs, accepted knowingly:*
1. Text quality becomes genuinely hard. Canvas2D gave the platform text engine
   for free; a GPU pipeline does not, and broadcast graphics are ~80% text.
   Mitigated by the dual-path design in RFC-003 §7, which remains the largest
   technical risk in the plan.
2. The asset pipeline expands from images and fonts to models, materials, and
   environments.
3. Phases 2–5 need real-time 3D specialists, which invalidates the roadmap's
   team assumption and its estimates.

*What survives from ADR-009:* transparent output forces grayscale antialiasing
on every option, so no renderer has a text-quality advantage from that
direction; and the runtime remains a pure function of
`(document, variables, time)`.

---

### ADR-012
**Adopt Three.js as the rendering substrate** · 2026-07-30 · Accepted
**Pending empirical validation** — see
[RENDER_ENGINE_EVALUATION §11](./RENDER_ENGINE_EVALUATION.md#11-this-is-a-paper-evaluation--the-empirical-spike-still-must-run)

Three.js (`WebGPURenderer`, automatic WebGL2 fallback) provides rasterization,
materials, lighting, and GPU resource management. BracketX owns the scene
document, runtime, render graph, text system, picking, and gizmos.

*Rationale, ranked:*

1. **Text.** `troika-three-text` demonstrates dynamic, on-the-fly SDF atlas
   generation with bidirectional layout, Arabic joining, and automatic Unicode
   fallback. Babylon's native MSDF path is pre-baked, which is structurally
   unsuited to unbounded glyph sets — and a Korean player name is not an edge
   case in esports.
2. **Minimal surface.** Babylon supplies opinionated scene serialization,
   animation, and GUI systems that duplicate what our engine core *is*. For a
   company whose product is the engine layer, "provides less" is the correct
   property.
3. **TSL** compiles one shader source to both WGSL and GLSL, directly serving
   the Baseline/Advanced tiering in RFC-003 §3 without divergent shader paths.
4. **Shallower coupling**, and therefore genuine replaceability.

*Where Babylon is better, honestly:* its Frame Graph (v1 in 9.0) is a real DAG
with resource aliasing and a visual editor, and Babylon Native is a credible
host for the reserved native runtime. We accept building a thinner render graph
ourselves; its strength there is also the deepest available coupling.

*Costs, accepted knowingly:* we now own text, picking, gizmos, and the render
graph; Three.js's monthly `r`-releases are an ongoing breaking-change tax,
concentrated in the render adapter by design; and `troika` carries third-party
bus-factor risk, mitigated by the fact that we own text regardless.

*Replaceability:* only `packages/render-three` may import `three`, enforced by
lint rather than discipline. The adapter is budgeted at 3–5k lines, making a
backend swap a 4–8 week project. Adapter size is a tracked metric.

*Reversal conditions:* enumerated in
[RENDER_ENGINE_EVALUATION §9](./RENDER_ENGINE_EVALUATION.md#9-where-babylon-would-win--and-what-would-reverse-this).

---

### ADR-013
**Architecture freeze** · 2026-07-30 · Accepted

**Frozen.** Scene graph · scene format · operations · render adapter · Three.js
adoption · 3D-first · engine boundaries.

**Promoted to Phase 2 design tasks**, and the last work before implementation:
text engine · event system · scheduler · memory ownership · runtime clock. Four
of the five were the "missing subsystem" findings in
[ARCHITECTURE_FINAL_REVIEW §2](./ARCHITECTURE_FINAL_REVIEW.md#2-critical-issues--must-fix-before-implementation).

**The bar for reopening a frozen item:** a demonstration that the existing
design *cannot satisfy a real implementation requirement*. Not preference, not
elegance, not a better idea. The demonstration must name the requirement, show
why the current design fails it, and state the cost of both fixing and not
fixing.

Everything else becomes an ADR and is **scheduled**, not retrofitted into the
foundation.

*Rationale:* the architecture is now more likely to degrade from continued
revision than from any remaining flaw. Nine documents of review have reached
diminishing returns; the open questions are ones only implementation can answer.

*Cost, accepted:* some decisions will prove suboptimal and we will live with
them longer than we would like. That is the intended trade — a frozen adequate
architecture beats a perpetually improving one that never ships.

*Note:* the freeze does not suspend
[ARCHITECTURE_FINAL_REVIEW](./ARCHITECTURE_FINAL_REVIEW.md)'s C2 (no declared v1
production platform), C8 (scope exceeds team by ~2×), or C9 (first application
does not exercise 3D). None is an architecture defect, so none blocks the
freeze — but all three are unresolved and belong to product, not engineering.
