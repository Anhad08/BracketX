# Streamatrix Studio — Product Architecture

**Date:** 2026-08-03 · **Status:** IMPLEMENTED (Phase 4)
**Principle:** the engine is our technology; the Studio is our product.
**Raises:** [IF-005](./IMPLEMENTATION_FINDING_IF-005.md)

---

## 1. What changed, in one sentence

Studio stopped being an editor with panels and became a product with sections —
and every engine concept moved behind a switch that is off by default.

Before, the application was one screen whose tabs were `timeline`, `presets`,
`variables`, `library`. Three of those four are engine nouns. A designer opening
it had to learn our architecture before they could make a graphic, which is the
definition of leaking an implementation.

---

## 2. The information architecture

Eight sections. Every name describes what a person is trying to **do**.

| | What you do here |
| --- | --- |
| **Home** | Recent work, and somewhere to start |
| **Design** | Build and animate a graphic |
| **Templates** | Reusable graphics you have saved |
| **Marketplace** | Themes, motion and graphics packs |
| **Assets** | Fonts, colours and motion you can reuse |
| **Outputs** | Where your graphics are sent |
| **Settings** | Appearance and behaviour |
| **Developer** | Engine internals — *only with the mode on* |

Inside Design, the same rule applied to the panels a designer uses all day:

| Was | Is | Why |
| --- | --- | --- |
| Hierarchy | **Layers** | A designer has layers; an engineer has a hierarchy |
| Inspector | **Properties** | " |
| Node | **Layer** | " |
| Presets | **Motion** | |
| Variables | **Data** | Fields a producer or a feed can change |
| Library | **Templates** | |

The persisted ids did not change. Renaming a stored key would have discarded
everyone's saved layout for a caption change.

---

## 3. The rule, and how it is enforced

> With Developer Mode off, **no engine term appears in any label, tab, command
> title or panel heading.**

That is a claim that rots unless it is checked, so it is checked. `shell.ts`
exports `ENGINE_TERMS` — mirror, backend, projection, reconciler, dirty node,
snapshot, conformance, primitive, msdf, atlas, glyph, descriptor, handle,
transaction, mesh, geometry, material, upem, diagnostic — and `leaksEngineTerm`
word-boundary matches against it.

Three suites apply it:

1. Every section label and hint, every pack and template description.
2. **Every layer name a template creates** — no `nod_`, no `rect_001`.
3. **The rendered DOM**, in a browser, for every section *and every editor tab*.

That third one found a real leak: the properties panel had been shipping
*"read from the mirror, so layout and animation are included"* since Phase 1. It
now reads *"on screen at −4.35, −2.78 · after layout and animation"* — the same
useful fact, in a broadcaster's words.

**Developer Mode deletes nothing.** It is a first-class, discoverable switch in
Settings, and the words a broadcaster must never see are exactly the words an
engineer finds when it is on. The engineering workbench remains a separate
internal application, and remains the deep instrument.

---

## 4. Content — why a product needs it

The success criterion is thirty seconds to a lower third. **An empty editor
cannot meet it however good it is.** A first-time user with a blank canvas and a
toolbox of rectangles is being asked to be a designer before they are allowed to
be a user.

So Studio ships the brief's free tier, pre-installed:

| | |
| --- | --- |
| **3 theme packs** | Midnight, Broadcast Red, Studio Light |
| **3 motion packs** | Motion Essentials, Snap, Emphasis |
| **1 graphics pack** | Broadcast Starter: Lower Third, Scoreboard, Title Card |

Phase 3's brief said *"do not create demo scenes, do not create fake templates,
do not hardcode graphics."* Nothing here contradicts it, and the distinction is
worth stating precisely.

A demo scene is a fixture that exists to prove the engine works. Every template
here is a **product**: parameterised, variable-driven, animated, editable in
every panel, saveable, takeable to air, and indistinguishable from one a
designer built — because it is built from the same primitives through the same
operations. The test is exact and asserted: **delete `packs.ts` and a designer
loses content, not capability.** Nothing in Studio or the engine knows a pack
exists; `installTheme` returns an ordinary transaction and a template returns an
ordinary document.

### Themes work because of design tokens

Tokens are document data (SCENE_FORMAT §11.2) and resolve *beneath* variables.
Every template binds its colours to `color.primary`, `color.surface`,
`color.ink`, `color.muted` rather than to literals — so applying a theme is
**one operation, one undo step, and touches not a single node.** Both facts are
asserted.

That is also why a template inserted into a project that already has a palette
arrives matching it.

### A motion pack ships no code

It names presets that already exist. That is what keeps a Marketplace item a
data download rather than a plugin — and it is asserted that every curated id
resolves to a real preset, so a pack cannot offer a move that does nothing.

---

## 5. What is deliberately absent

Seven of the brief's eleven asset categories and four of its twelve Marketplace
categories need images, SVG or video. The engine draws none of them
([IF-005](./IMPLEMENTATION_FINDING_IF-005.md)).

They are **not stubbed**. No empty Images tab, no greyed-out icon packs, no
placeholder thumbnails. Phase 3A settled this rule for the toolbox — *a tool
exists only when the engine can draw what its name says* — and it applies
unchanged. What ships is what works, plus one honest line: *"Icons, stingers and
brand packs arrive with image support."*

The cost is stated plainly rather than buried: **until the asset pipeline lands,
a Streamatrix graphic cannot contain a logo.** That is one of the six steps in
the 30-second criterion, and the browser suite asserts the gap so a future change
cannot appear to close it without actually doing so.

---

## 6. Performance

The brief's non-negotiable: *"While redesigning Studio, do not weaken the
engine."*

Nothing in the engine changed in this phase. Two UI decisions actively help:

**Browsing costs zero rendering.** Sections replace the editor rather than
sitting beside it, so `SceneView` unmounts, the canvas leaves the document, and
its animation-frame loop stops. Asserted in a browser: `canvas` count is 1 in
Design, **0** in the Marketplace, and 1 again on return with the graphic intact.

**Developer Mode reads on render, never polls.** No interval, no subscription,
no per-frame work. A diagnostic that becomes part of the load it is measuring is
the specific failure the workbench documented, and the rule carries over.

The editor's own rules are untouched: the scene is the brightest thing, chrome
does not move, numbers are tabular.

---

## 7. The visual language

A spacing scale (4/8/12/16/24/32/48), one radius pair, **one duration and one
curve** for the whole product. Two would read as two applications stitched
together.

The editor's rules and the product's rules deliberately differ:

> The editor is dense because density is what an instrument owes its user. Home
> is open because openness is what a first impression owes a stranger.

And one rule that carries everywhere: **motion is only ever a response.**
Nothing animates on its own, nothing loops, nothing pulses for attention — a
designer is judging motion they authored, and chrome that moves competes with
it. `prefers-reduced-motion` removes what remains.

---

## 8. What Phase 4 did not do

| | |
| --- | --- |
| Dockable panels | The layout is fixed and resizable, not rearrangeable. Worth doing; not the difference between an IDE and a product |
| Timeline curve editor | Keyframes, easing, markers, multi-select and retiming all exist. Bézier curve handles do not |
| A remote Marketplace | Everything is bundled and local. There is no service, no account, no payment |
| Assets: images, SVG, video, audio, models | IF-005 |
| Learning resources | Three inline hints on Home. Not a tutorial system |
| Multi-resolution canvas | The canvas is the document's own output size. Switching resolutions is a document edit, not a view mode |

---

## 9. Next

1. **The 3D viewport.** Still the last outstanding *engine* capability, deferred
   three times now. Lighting and world-space text remain confirmed only by
   headless assertion.
2. **The asset pipeline** (images + SVG). Closes the Assets browser, four
   Marketplace categories, and the logo step of the success criterion.
3. **Phase 3C — the official graphics library**, once logos are possible.
