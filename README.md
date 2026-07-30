# BracketX

An AI-first, browser-first live production platform for broadcast graphics —
esports, sports, podcasts, and live events.

## Documentation

Read these before contributing. They are the source of truth, in this order:

| Document | What it answers |
| --- | --- |
| [docs/PRODUCT.md](./docs/PRODUCT.md) | What we are building, for whom, and what we are deliberately *not* building |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | How it is structured, and why — including a decision log |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | **Canonical roadmap** — 17 phases from foundation to public launch, what blocks what, and which decisions gate which phase |
| [docs/DATABASE.md](./docs/DATABASE.md) | Verified database state, how to run Postgres locally, and where the generated schema differs from its documentation |

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
