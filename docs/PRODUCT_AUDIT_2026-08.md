# Product Audit — August 2026

**Purpose:** name every unfinished feature, placeholder, engineering screen and
production blocker, then say which this milestone closed. Nothing is hidden; an
audit that flatters the product is worse than no audit.

---

## 1. The rule this milestone applied

The brief's own Current Rule:

> Does this complete an existing capability? Or does this create another
> partially finished subsystem? If it creates another unfinished subsystem: do
> not build it.

The brief also lists **SVG, Video, Audio and 3D** under "Complete The Existing
Asset System". Those four are not unfinished — they **do not exist**, and
[IF-006](./IMPLEMENTATION_FINDING_IF-006.md) refused them one milestone ago with
reasons that have not changed. Building them now would create four new major
subsystems, which is the thing this brief forbids in its opening lines.

They remain deferred. What was finished is what was genuinely half-built.

---

## 2. Placeholders found

**None in code.** A sweep for `TODO`, `FIXME`, `not implemented` and
`coming soon` across `apps/studio/src` and `packages/*/src` returns only
`placeholder=` attributes on real inputs. The codebase has not accumulated
stub debt.

The placeholders were at **product** level: a model with fields nothing could
edit, and a browser that listed assets it could not open.

---

## 3. Closed by this milestone

| Gap | Was | Now |
| --- | --- | --- |
| Asset previews | Text tiles | Thumbnails from the on-air pixels, over a transparency checkerboard |
| Asset search | None | Name and tag search, ranked; empty state names the query |
| Asset inspector | None | Size, stored bytes, usage count, version count |
| Rename | Model only | Editable, persisted, survives reload |
| Tags | Model only | Editable, searchable |
| Favourites | Model only | Toggle, shown on the tile |
| Duplicate | None | Record copy, no byte copy |
| Delete | None | Removes the record, reclaims bytes only when nothing can still reach them |
| Replace | Registry only | In the inspector; identity kept, so every graphic updates |
| Shipped-asset safety | None | Delete disabled — an included asset returns on next launch |

Nine browser tests exercise these as real gestures.

---

## 4. Still unfinished — honestly

### Asset system
- **JPEG / WebP / AVIF.** Codecs, not architecture. A week each behind the
  existing port. *Not a blocker for beta if the product says "PNG".*
- **SVG, Video, Audio, 3D.** IF-006 §3–5. Each is a phase.
- **Collections.** The field and the registry support them; there is no UI. Tags
  cover most of the same need, which is why this ranked below them.
- **Bulk operations.** No multi-select.
- **Drag from browser onto canvas.** Import accepts drops; placing an asset into
  a scene by dragging does not exist. Assets reach graphics through the `logo`
  variable today.

### Marketplace
- Install, uninstall, search and categories work. **Versioning, dependencies,
  integrity verification, licensing and updates do not.** There is no package
  format with a version field, so "update a package" has nothing to compare.
  *This is a beta blocker for a paid Marketplace, not for a free tier.*

### Starter content
- ~~Three templates.~~ **Closed.** Eight templates across four jobs: lower
  third, title card, sponsor bar, ticker, breaking news, scoreboard,
  leaderboard, countdown — in three graphics packs, all free tier. Every one
  ships with an entrance; the ticker ships with an exit because it is the one
  graphic an operator genuinely takes down.
- Still thin: no social or corporate graphics, and no transition packs. Both are
  content, and the components exist.

### Platform
- **Studio is not connected to `packages/auth`, `packages/db` or
  `packages/core`.** No login, no cloud, no projects, no teams. Assets persist
  to IndexedDB on one machine.
- **No production build verification** in CI beyond typecheck and tests.

### Rendering
- **No 3D viewport.** Deferred three times. Lighting and world-space text cannot
  be confirmed visually.
- **Mipmaps ship for images only.** Correct, but untested visually at minified
  sizes because there is no visual-regression harness.

---

## 5. Engineering screens

**One, and it is correct:** Developer Mode, hidden behind a toggle, with an
enforced no-jargon rule on everything outside it. A browser test asserts a
stale preference cannot resurrect it.

No other screen leaks engine vocabulary. The `ENGINE_TERMS` list is checked
against every shipped user-facing string.

---

## 6. Public Beta readiness

| Area | State |
| --- | --- |
| Shell, navigation, information architecture | **Ready** |
| Create → customise → preview → program → take → air | **Ready** |
| Text, variables, timeline, states, collections | **Ready** |
| Images, asset library | **Ready** |
| Themes and motion packs | **Ready** |
| Marketplace (free tier) | **Ready** |
| Marketplace (paid, versioned) | **Blocked** — no package format |
| Accounts, cloud, teams | **Blocked** — platform junction not built |
| Starter content breadth | **Ready enough for beta** — 8 templates, 4 categories |
| Vector, video, audio, 3D | **Deferred** — IF-006 |

**Assessment: a free, local, image-and-text broadcast graphics tool is close to
beta. A commercial cloud product is not.**

### Update — starter content closed

One of the two blockers is gone. What remains:

1. **The Studio↔platform junction.** Without accounts there is no product to
   sell and no way to deliver a paid Marketplace. This is a **New Platform
   Capability** and needs explicit approval before it starts.
2. **Marketplace package format.** Versioning, dependencies and integrity have
   nothing to operate on until packages carry a version. This IS existing
   product completion and is the recommended next milestone.

Neither is an engine problem. That is the healthiest finding in this audit.
