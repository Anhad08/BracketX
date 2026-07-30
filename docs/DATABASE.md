# BracketX — Database Verification Record

**Verified:** 2026-07-30 · **Against:** PostgreSQL 17.10 (x86_64-windows, native binaries)
**Better Auth:** 1.6.25 · **Drizzle ORM:** 0.45.2 · **drizzle-kit:** 0.31.10

> This is the evidence that the Phase 0 database layer works, not a design
> document. The model itself is in
> [ARCHITECTURE.md §5](./ARCHITECTURE.md#5-data-model--phase-0).
>
> Every claim below was read out of `pg_catalog` / `information_schema` on a
> live server after applying the committed migrations — not inferred from the
> Drizzle source that was supposed to produce it.

---

## 1. How to reproduce

```sh
# Option A — Docker (primary path)
docker compose up -d

# Option B — no Docker required (real native PostgreSQL 17 binaries)
pnpm --filter @bracketx/db db:dev-server

# then
cp .env.example .env          # set BETTER_AUTH_SECRET
pnpm --filter @bracketx/db db:migrate
pnpm --filter @bracketx/db exec node scripts/introspect.mjs

# integration tests — starts and tears down its own server if
# DATABASE_URL is unset, reuses it if set
pnpm --filter @bracketx/core test:integration
```

## 2. Verified state

**8 tables:** `account` · `invitation` · `member` · `organization` · `project` ·
`session` · `user` · `verification`

Teams and dynamic access control are disabled, so `team`, `teamMember`, and
`organizationRole` are correctly absent.

### Timestamps

All **19** timestamp columns are `timestamp with time zone`. Zero naive
`timestamp` columns. This is the one deliberate modification to the generated
schema — see §4.

### Foreign keys and delete behaviour

| From | To | ON DELETE | Why |
|---|---|---|---|
| `account.user_id` | `user` | CASCADE | Credentials are meaningless without the user |
| `session.user_id` | `user` | CASCADE | Sessions die with the user |
| `member.user_id` | `user` | CASCADE | Link row |
| `member.organization_id` | `organization` | CASCADE | Link row |
| `invitation.inviter_id` | `user` | CASCADE | — |
| `invitation.organization_id` | `organization` | CASCADE | — |
| `project.organization_id` | `organization` | CASCADE | Deleting a workspace must not strand projects |
| **`project.created_by_id`** | `user` | **SET NULL** | **A project belongs to the workspace, not its author** |

That last row is the one that matters and the reason the Golden Path exists.

### Unique constraints

| Constraint | Scope |
|---|---|
| `user_email_unique` | `user(email)` |
| `session_token_unique` | `session(token)` |
| `organization_slug_unique` | `organization(slug)` — **global across all tenants** |
| `project_organization_id_slug_unique` | `project(organization_id, slug)` — **per workspace** |

The asymmetry is intentional and worth internalising: two customers **cannot**
both own the workspace slug `acme`, but they **can** both have a project called
`finals`.

### Indexes

Beyond the four primary keys and four unique indexes above:

`session(user_id)` · `account(user_id)` · `verification(identifier)` ·
`member(organization_id)` · `member(user_id)` · `invitation(organization_id)` ·
`invitation(email)` · `project(organization_id)` · `project(created_by_id)`

## 3. Test coverage

**25 unit tests** (no database) — permission logic, role parsing, fail-closed
behaviour, prototype-pollution resistance.

**11 integration tests** (real PostgreSQL) — including the Golden Path:

```
create user → create workspace → create project → fetch project
            → delete user → project still exists, created_by_id is NULL
```

Also proven against the live server: workspace deletion cascades to projects;
user deletion removes membership but not the workspace; cross-tenant reads
return 404; identical project slugs coexist across workspaces; duplicate slugs
within one workspace are rejected by the **constraint itself** (SQLSTATE 23505,
asserted directly rather than via message text) and not merely by the
application pre-check; orphan `organization_id` is rejected (SQLSTATE 23503).

## 4. Differences between generated SQL and the documented schema

Findings from comparing Better Auth's published documentation, the CLI output,
and the live database. Ordered by how much they matter.

### 4.1 The docs understate `defaultStatements` — **would have caused a bug**

The organization plugin's documentation page lists three permission resources:
`organization`, `member`, `invitation`. The shipped code
(`plugins/organization/access/statement.mjs`) defines **five**, adding `team`
and `ac`.

Had the statement been hand-transcribed from the docs, `team` and `ac` would
have silently disappeared from the access-control object and the built-in role
definitions that reference them would have broken. `packages/auth/src/permissions.ts`
spreads `defaultStatements` rather than re-declaring it, so this cannot recur.

### 4.2 The generated schema is stricter than the docs describe — **in our favour**

The documentation states that `member` and `invitation` have foreign keys but
does not specify delete behaviour. The generator emits `ON DELETE CASCADE` on
all four. It also adds seven indexes and three column defaults
(`member.role` → `'member'`, `invitation.status` → `'pending'`,
`user.email_verified` → `false`) that the docs do not mention, plus a full set
of Drizzle `relations()` definitions.

### 4.3 Timestamps are generated without time zones — **deliberately overridden**

The generator emits naive `timestamp`. All 19 columns were changed to
`timestamptz`. BracketX schedules and runs live events across time zones, so a
naive timestamp is a latent wrong-show-time bug.

**This must be reapplied after every `auth:generate`.** The header of
`packages/db/src/schema/auth.ts` carries the warning; regenerating without
reapplying it will produce a migration that silently downgrades every column
back to `timestamp`.

### 4.4 `organization` and `member` have no `updatedAt`

Better Auth ships `createdAt` only. `organization.updatedAt` was added via
`schema.organization.additionalFields` with `input: false` so a client cannot
set it. `member.updatedAt` was deliberately not added — a single overwritten
column records that a role changed but never what it changed from, which is a
job for an audit log (Phase 16), not a timestamp.

### 4.5 `session.activeOrganizationId` has no foreign key

Better Auth's design, confirmed on the live schema: the column is plain `text`
with no constraint. It therefore outlives a deleted organization and survives a
user being removed from one.

This is a security-relevant gap, not a cosmetic one — trusting it would grant
access to a workspace the user no longer belongs to. `resolveActiveWorkspace`
in `packages/core` re-validates it against `member` on every read and returns
`null` for a stale pointer. Covered by unit test.

### 4.6 Better Auth does not index every foreign key column — **open, upstream**

`invitation.inviter_id` has an `ON DELETE CASCADE` foreign key and **no index**.
Postgres does not index foreign key columns automatically, and the referencing
side is what gets scanned when a referenced row is deleted. Every user deletion
therefore sequentially scans `invitation`.

Harmless at current scale, and left unpatched on purpose: adding it would mean a
second hand-modification to reapply after every regeneration (§4.3 is already
one). Revisit if `invitation` grows or user deletion becomes routine — for
example when account deletion ships for GDPR.

The same defect in **our own** table was fixed: `project.created_by_id` was
unindexed despite its `ON DELETE SET NULL`, which would have made every user
deletion scan `project`. Migration `0001` adds `project_created_by_id_idx`.
Found by introspecting the live database, not by reading the schema.

## 5. Known limitations of this verification

Stated plainly so the coverage is not overread:

- **No Docker on the verification machine.** PostgreSQL 17.10 was run from real
  native binaries via `embedded-postgres` rather than the committed
  `docker-compose.yml`. Same engine, same version line, same wire protocol,
  same `node-postgres` driver — but the compose file itself has not been
  executed. First person with Docker should run `docker compose up -d` and
  confirm.
- **Single-connection testing.** Concurrency, pooling behaviour under load, and
  lock contention are unexercised. The unique constraints are proven to hold;
  their behaviour under a genuine race is inferred from Postgres semantics, not
  observed.
- **Auth flows are not integration-tested.** Fixtures insert `user`,
  `organization`, and `member` rows directly. `auth.api.signUpEmail` and
  `auth.api.createOrganization` have not been exercised against a live server —
  that arrives with the Phase 0 UI work, which is the first thing to call them.
