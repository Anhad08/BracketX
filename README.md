# BracketX

A real-time 3D broadcast and event production engine. Tournament management,
sports, podcasts, conferences, and corporate events are applications built on
it — the engine is the product.

## Documentation

Read these before contributing. They are the source of truth, in this order:

| Document | What it answers |
| --- | --- |
| [docs/PRODUCT.md](./docs/PRODUCT.md) | What we are building, for whom, and what we are deliberately *not* building |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | How it is structured, and why — including a decision log |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | **Canonical roadmap** — 17 phases from foundation to public launch, what blocks what, and which decisions gate which phase |
| [docs/GRAPHICS_LIBRARY.md](./docs/GRAPHICS_LIBRARY.md) | **The live work queue** for the overlay library, 3D overlays, gizmo snapping and Adaptive Graphics — what is done, what is next, and what has been **cut** (virtual sets) |
| [docs/DATABASE.md](./docs/DATABASE.md) | Verified database state, how to run Postgres locally, and where the generated schema differs from its documentation |
| [docs/ARCHITECTURE_VERIFICATION.md](./docs/ARCHITECTURE_VERIFICATION.md) | **Read first.** Adversarial verification — every claim labelled Proven/Derived/Assumed/Unknown, defects, and blocking changes |
| [docs/ARCHITECTURE_FINAL_REVIEW.md](./docs/ARCHITECTURE_FINAL_REVIEW.md) | Architecture freeze review — critical issues, reversals, and subsystem scores |
| [docs/ENGINE_RUNTIME.md](./docs/ENGINE_RUNTIME.md) | Clock, scheduler, event system, memory ownership — the frame loop and its resources |
| [docs/ENGINE_RECONCILIATION.md](./docs/ENGINE_RECONCILIATION.md) | Reconciler and ownership model — one owner per object, one path per mutation, one derivation per cache |
| [docs/TEXT_ENGINE.md](./docs/TEXT_ENGINE.md) | Text pipeline: fonts, shaping, bidi, MSDF atlases, layout, determinism |
| [docs/ENGINE_ARCHITECTURE.md](./docs/ENGINE_ARCHITECTURE.md) | **Highest-level technical document** — engine layers, and the boundary between engine and applications |
| [docs/SCENE_FORMAT.md](./docs/SCENE_FORMAT.md) | **Canonical scene schema** (v2, 3D) — renderer- and editor-agnostic |
| [docs/RFC-003](./docs/RFC-003-rendering-architecture-3d.md) | Rendering: WebGPU-first, adopt-vs-build, camera, text, OBS. **Supersedes RFC-001** |
| [docs/RENDER_ENGINE_EVALUATION.md](./docs/RENDER_ENGINE_EVALUATION.md) | Three.js vs Babylon.js vs build — recommendation, migration strategy, risk assessment |
| [docs/RFC-002](./docs/RFC-002-scene-document-model.md) | Edit model: operations, transactions, undo/redo, path to collaboration |
| [docs/RFC-001](./docs/RFC-001-rendering-architecture.md) | *Superseded.* Retained for decision history |

## Getting started

Requires Node 20.9+ (see [.nvmrc](./.nvmrc)) and pnpm.

```sh
pnpm install
cp .env.example .env    # then set BETTER_AUTH_SECRET

# Start Postgres — either one:
docker compose up -d                          # if you have Docker
pnpm --filter @bracketx/db db:dev-server      # if you don't

pnpm --filter @bracketx/db db:migrate
pnpm dev                # apps/web on http://localhost:3000
```

## Repository layout

```
apps/web/                    Next.js 16 — app, auth, dashboard, editor
packages/ui/                 Shared React primitives
packages/eslint-config/      Shared ESLint flat config
packages/typescript-config/  Shared tsconfig bases
docs/                        Product, architecture, roadmap
```

Packages arriving in Phase 0 (`db`, `auth`, `core`) and paths reserved for later
phases (`packages/schema`, `apps/render`, `apps/realtime`) are described in
[ARCHITECTURE.md §3](./docs/ARCHITECTURE.md#3-repository-layout).

## Commands

All run from the repository root.

| Command | Does |
| --- | --- |
| `pnpm dev` | Start all apps in watch mode |
| `pnpm build` | Build everything |
| `pnpm lint` | ESLint, zero warnings tolerated |
| `pnpm check-types` | TypeScript, no emit |
| `pnpm format` | Prettier write |

Scope to one package with a filter: `pnpm build --filter=web`.

## Conventions that will trip you up

- **Domain logic goes in `packages/core`, never in a route handler.** This is
  load-bearing, not stylistic —
  [ARCHITECTURE.md §4](./docs/ARCHITECTURE.md#4-why-packagescore-exists) explains
  what breaks otherwise.
- **New build-time env var?** Add it to `tasks.build.env` in
  [turbo.json](./turbo.json) *and* [.env.example](./.env.example). Skipping the
  first one lets Turborepo serve a cache artifact built against different values.
- **`packages/ui` is a leaf.** It may not import `core`, `db`, or `auth`.

## Where things go

Stated because more than one session works in this tree at once, and a file in
the wrong place is how two of them end up doing the same work twice — or
committing each other's half-finished edits.

| Kind of file | Home |
| --- | --- |
| Engine capability | `packages/engine-*/src/<thing>.ts` — beside its siblings. A pure generator of geometry, pixels or keys goes next to `mesh-primitives.ts` / `paint.ts`, not in a new package |
| Engine unit test | `packages/engine-*/src/<thing>.test.ts` — same folder as the code |
| Studio logic | `apps/studio/src/studio/<thing>.ts` — pure, no React, no DOM, so it is testable without a browser |
| Studio unit test | `apps/studio/src/<thing>.test.ts` — `src/`, **not** `src/studio/`; matches every existing one |
| Studio browser test | `apps/studio/e2e/<thing>.spec.ts` — drives a real pointer, asserts what a person sees |
| Plans, findings, decisions | `docs/` — **and add it to the table above**, or the next session will not find it |
| Debug screenshots, pixel probes, throwaway scripts | A scratch directory, never the repo. A stray `p3d.png` at an app root or a `probe.spec.ts` in `e2e/` gets collected by the suite and reviewed as though it were real |

Playwright's `test-results/` and `playwright-report/` are generated, and are
gitignored. Two of those files had been committed; if you find them tracked
again, untrack them rather than editing them.

**Before starting a substantial piece of work, read
[docs/GRAPHICS_LIBRARY.md](./docs/GRAPHICS_LIBRARY.md) §5.** It is the live
queue, it records what has been cut and why, and it is the cheapest way for two
sessions not to collide.
