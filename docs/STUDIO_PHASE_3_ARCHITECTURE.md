# Streamatrix Studio Phase 3A — Authoring Architecture

**Date:** 2026-08-02 · **Status:** IMPLEMENTED
**Follows:** [IMPLEMENTATION_REPORT_STUDIO_PHASE_1.md](./IMPLEMENTATION_REPORT_STUDIO_PHASE_1.md) ·
[IF-003](./IMPLEMENTATION_FINDING_IF-003.md)
**Scope:** every authoring workflow that does not depend on text.

---

## 1. What this phase is

Phase 1 proved Studio could **hold** a document without corrupting it. Phase 3A
proves it can **author** one: build shapes, animate them, parameterise them,
arrange them, save them as reusable templates, and put them on air.

The success criterion is a sentence, and it is deliberately not the one the
original brief gave (that one requires text — see IF-003):

> A designer can build an animated, data-driven, shape-and-motion graphic — a
> sting, a sponsor wipe, an animated bar — entirely inside Studio, save it as a
> template, and take it to air.

Everything below serves that. The one architectural constraint that shaped
almost every decision is the brief's own:

> *"The authoring tools must treat every node generically so that a future
> TextNode automatically gains every editor capability without Studio
> modifications."*

That is not a nice-to-have; it is what makes Phase 3B cheap. §7 is the audit of
whether it actually holds.

---

## 2. Modules

Six new modules, all pure, all in `apps/studio/src/studio/`. Each is a function
from `(document, intent)` to a `Transaction`, and **none of them applies
anything** — the same split Phase 1 established, and the reason every claim in
the verification suite is a claim about a transaction rather than about a
rendered panel.

| Module | Owns | Lines |
| --- | --- | --- |
| `keyframes.ts` | Timeline and keyframe authoring — CRUD, drag, clipboard, retime, markers | ~640 |
| `presets.ts` | Animation presets that compile to ordinary tracks | ~410 |
| `arrange.ts` | Align, distribute, group, ungroup, layer order | ~330 |
| `program.ts` | The Preview → Take → Program bus | ~250 |
| `library.ts` | Templates, design tokens, the saved-scene shelf | ~340 |
| `session.ts` (extended) | Variable override / reset — the runtime half | +60 |

Five new UI surfaces consume them: the timeline editor, the motion panel, the
arrange bar, the Program row, and the library panel. Every one renders a model
computed in a module and turns a gesture into a transaction.

---

## 3. The decisions that mattered

### 3.1 The engine needed no new operation type

`doc.setMeta` has always addressed the whole document by path, so `animations.0`
is a legal target and a timeline edit is an ordinary undoable operation. Studio
adds **no second mutation mechanism**, no timeline-specific command, and no
editor-side model that has to be reconciled with the document's.

This was checked before writing code, not discovered afterwards. It is why
Phase 3A required no engine work for the entire timeline editor.

### 3.2 One operation replaces the whole timeline

A five-keyframe drag *could* be five `…keyframes.N.time` sets. It must not be:

1. **Keyframes are addressed by index and every mutation re-sorts.** The second
   operation in such a transaction would address a keyframe the first one moved.
   The bug is silent and depends on drag direction.
2. The inverse of a whole-timeline set is exact and needs no reasoning.

The cost is that an undo record holds two copies of one timeline. **Measured
rather than assumed** (§4): at 512 keyframes a drag costs 0.010 ms, and 16× more
keyframes costs only 1.5× more — the rewrite is nowhere near the dominant term.

### 3.3 Keyframes must leave the editor sorted

The engine sorts keyframes **once**, at load, and never again — a deliberate
performance change (`d473e6e`), and sampling relies on it.

So an editor that leaves a track out of order produces a scene that animates
wrongly in the session and **correctly after a save and reload**, which is the
worst possible way to find out. Every mutation in `keyframes.ts` re-sorts, and
the verification suite asserts it after a drag that crosses a neighbour.

### 3.4 Times snap to the frame grid

A designer drags on a pixel grid, and a pixel is not a frame. Without
quantisation a keyframe lands at 0.416673 s and nobody can key the same thing
twice. Frames are also what the transport addresses, so **a keyframe between two
frames is one the playhead can never sit exactly on**. The rate comes from
`world.output.fps`, not a constant.

### 3.5 A preset compiles to tracks and then stops existing

"Slide Left" is not a thing the runtime knows about. It is a function from a node
to two keyframes, applied once; afterwards the document contains a timeline
indistinguishable from one keyed by hand.

The reason is concrete: the moment a preset is a runtime concept, the engine has
to understand every preset anybody writes, presets cannot be edited after they
are applied, and **the Marketplace becomes a source of code rather than data.**

**Presets are relative.** "Slide in from the left" cannot mean "start at x = −8";
it means "start one screen-width left of wherever this node actually is, and end
where it is". Every preset reads the node's *authored* values, which is what
makes it reusable at all. Corollary: the authored value is the **resting** value,
so applying an entrance never moves the node.

**A fade needed no engine change.** There is no `opacity` on a rect, and adding
one would be an engine change for an authoring convenience. But SCENE_FORMAT
colours may be `#RRGGBBAA` and the engine's `interpolate` already blends hex
alpha — so a fade is a colour animation between the transparent and opaque forms
of the node's own colour. Found while writing the module.

**Blur In, Dissolve and Glow are not shipped.** Not because they are hard: the
engine has no blur, no dissolve and no bloom. A designer who picks "Glow" and
gets a fade has been lied to by the tool.

### 3.6 Program is a second session, not a second view

The obvious implementation is one engine and two views of a document. It cannot
work: **Program has its own clock.** A graphic animating on air must keep
animating while a designer scrubs the Preview timeline to frame 0, and one
runtime cannot be at two frames.

So Program is a full `StudioSession` with its own host, its own mirror and its
own canvas, and a Take is `program.open(JSON.parse(canonical(preview)))` — a
fresh parse of the same bytes, so Program can never share a reference with
something the designer is still editing. The cost is a second mirror; the
alternative is a preview that stops the show.

`entranceOf` / `exitOf` match by **name convention**, deliberately not by a
format field. Marking a timeline `role: "entrance"` in the document would put a
broadcast noun in the scene format — the exact thing SCENE_FORMAT §7 refuses for
components, and for the same reason: the engine would have to understand a
product concept forever.

### 3.7 Alignment is in world space

Aligning two nodes that sit in different parents has to put their edges in the
same place **on screen**, which is not the same as giving them the same local x.
So `arrange.ts` takes world bounds read from the **mirror** — which means a node
placed by layout or driven by animation aligns where it actually is.

Alignment is to the **selection**, not to the frame. A designer who selects three
nodes and presses "align left" means "line these up with each other"; aligning to
the canvas edge is the version of this feature everyone has used once.

### 3.8 There is still no Studio file format

A template is a **SCENE_FORMAT document that declares its parameters**. §11.3
already has `template: { id, name, parameters }`, and `TemplateParameter` says a
parameter becomes a variable at instantiation — so "save as template" is one
operation writing `document.template`, derived from the variables the designer
already declared.

Every variable becomes a parameter, because a variable nobody is meant to set is
a variable that should have been a literal. `templateDrift` reports the
divergence when somebody renames one, because the alternative failure mode is an
instantiation that silently ignores a parameter and looks like a broken feed.

**Design tokens live in the document.** A brand colour is part of the graphic; a
palette kept beside the file would not survive being sent to another designer or
instantiated by the Marketplace. They resolve *beneath* variables (§11.2), so
there is one chain and nothing to reconcile.

### 3.9 A variable's default and a variable's value are different acts

RFC-002 §4.3 draws the line: a default is a document edit — undoable, persisted.
A current value is runtime state — neither. Studio has to offer both, because a
designer changing what a template ships with and an operator typing a score into
it are different things.

They are two columns with two headers (`default (saved)` / `live (not saved)`),
because a designer who cannot tell which they just changed will lose work
believing they had edited the document.

`resetVariable` re-sets the default explicitly rather than issuing
`variable.clear` alone: the runtime has no memory of the document, so clearing
would leave the key **absent**, and a designer who resets a field and sees it go
blank has lost their default.

---

## 4. Cost

Measured on a 64-node scene with a 512-keyframe timeline — the top end of what a
real broadcast graphic reaches, not demo size. Full table in
[STUDIO_PHASE_3_VERIFICATION.md §6](./STUDIO_PHASE_3_VERIFICATION.md).

| Gesture | Mean | Tolerance |
| --- | --- | --- |
| Move one keyframe (512 in timeline) | **0.0103 ms** | fires per pointer move |
| Move twenty keyframes | 0.0219 ms | " |
| Record a keyframe | 0.0097 ms | per commit |
| Retime a whole timeline | 0.0394 ms | a click |
| Apply a preset to 64 nodes | 0.138 ms | a click |
| Align twenty nodes | 0.178 ms | a click |
| Group twenty nodes | 0.387 ms | a click |
| Cut a 64-node scene to air | 0.493 ms | once per graphic |
| `pending` (per render) | **0.000054 ms** | every repaint |

The whole-timeline rewrite (§3.2) is confirmed cheap: **16× the keyframes costs
1.5× the time** (0.0068 ms at 32 keyframes, 0.0103 ms at 512), so the rewrite is
nowhere near the dominant term at any realistic size. That is the specific thing
these benchmarks were written to check, because §3.2 traded a known cost for
unconditional correctness — and an untested cost is a guess.

**One regression was found by these benchmarks and fixed.** `bus.pending`
canonicalized the entire document on every read, and it is read on every render
of the Program row — 0.586 ms at 64 nodes, and it would be tens of milliseconds
at broadcast scale. Cached on the document's object identity in a `WeakMap`,
which is exact because documents are immutable: every edit produces a new object,
so identity is as precise as content and the cache cannot answer for a document
that changed. **0.586 ms → 0.000054 ms, ~10,800×**, and a Take got ~4× faster as
a side effect because it no longer canonicalizes twice.

This is the third time a benchmark at realistic size has found a cost that
structural tests could not see. It is the same shape as the workbench's
`diagnostics()` finding.

---

## 5. Two engine changes, and why each was legitimate

Phase 3A was meant to need no engine work. It needed two small additions and
found one bug.

### 5.1 A `disc` primitive — because `cornerRadius` is a lie

SCENE_FORMAT declares `cornerRadius` on `rect`, and **nothing implements it**.
No backend reads it. So a "Circle" tool authored as a square rect with a corner
radius would render a square — the same failure that kept Glow out of the
presets.

Implementing `cornerRadius` properly is a **shader** concern: a rounded rect is a
signed-distance fill, not a triangle fan, and it has a material-kind consequence.
A disc is geometry. It needs no backend method, no `MaterialDescriptor` change
and no format version bump — `primitive.shape` is a free string that
`readPrimitive` already reads defensively (§13 rule 4).

So the honest circle is a disc, and the rounded rect waits for the renderer work
it actually needs.

### 5.2 A `template` id kind

One key in `ID_PREFIXES`. Its own kind rather than reusing `scene`, because a
template's id is **lineage**: instantiating one remints the document id and keeps
this, so "which template is this graphic from" stays answerable.

### 5.3 The bug: lights were never attached

`MirrorGraph.setAttachment` had cases for `mesh`, `camera` and `none` — and
**not for `light`**. `#applyLight` recorded the attachment on the mirror node and
`attachLight` was never called. The light existed on the backend, unparented,
with no position and no direction, because the descriptor deliberately carries
neither (C3).

Nothing caught it: `attachmentOf` in the test suite reads the **mirror**, and the
conformance suite calls `attachLight` **directly**. Nothing asserted the one step
between them.

This is exactly what [IF-003 §6](./IMPLEMENTATION_FINDING_IF-003.md) predicted —
*"every lighting claim in ADR-013 amendment 1 is a headless assertion about
descriptors and handles"* — and it was found the first time a light was created
through a **document**, by Studio's toolbox. The regression test lives in
`hybrid.test.ts`, at the level the bug lived at, and asserts on the backend
snapshot rather than on the mirror's record of it.

**Nothing about the boundary was weakened to fix it.** ADR-013 still has 30
methods; one of them was simply never called.

---

## 6. What is on screen

```
┌─ Toolbox ────────┬─ Arrange bar: align · distribute · group · order ──────┐
│ Shapes           ├────────────────────────────────────────────────────────┤
│  Rectangle       │                                                        │
│  Ellipse         │                  Scene view                            │
│ 3D               │           (the engine, rendering)                      │
│  Box Sphere      │                                                        │
│  Cylinder Plane  ├────────────────────────────────────────────────────────┤
│ Structure        │  ▣ ON AIR   Program monitor      TAKE  Cut  Auto        │
│  Group           │                                  Hold  Continue  Clear  │
│ Scene            ├────────────────────────────────────────────────────────┤
│  Camera  Light   │ timeline │ presets │ variables │ library      [Program] │
├──────────────────┤                                                        │
│ Hierarchy        │  Move ▾  dur 2.0  ☐loop   play stop  ×2fast  zoom ────  │
│                  │  4 keyframes  copy paste delete  easing▾   key prop▾    │
│                  │  transform.position.0  Bar  ◆────◆──────◆               │
└──────────────────┴────────────────────────────────────────────────────────┘
```

The layout is designed for what it will host, not for today's demo scenes:

- **Program is a row, never a tab.** On-air state is the one thing an operator
  must never have to go and find. A tab can be behind another tab. It costs
  vertical space and that is the correct trade.
- **The bottom dock is a tab strip that grows.** Marketplace, Production Queue
  and Asset Browser are tabs beside `library` when they exist — no restructuring.
- **The left dock is create-then-navigate**, which is the order the work happens.
- **Every action has a command entry.** An action with no entry in `commands.ts`
  is unreachable from the keyboard and invisible to search — asserted in the
  Phase 1 suite and still true of the 40-odd commands Phase 3A added.

---

## 7. The generic-node audit

The binding requirement was: *a future TextNode gains every editor capability
without Studio modifications.* Checked capability by capability.

| Capability | Generic? | Why |
| --- | --- | --- |
| Selection, multi-select, marquee | ✅ | Ids only |
| Hierarchy, reorder, reparent | ✅ | Order keys only |
| **Keyframe authoring** | ✅ | A track is `(target, path)`. Nothing asks what the node is |
| **Animation presets** | ⚠️ **Partly** | Transform presets are generic. `fade` resolves a *colour path* per component type |
| **Alignment / distribute** | ✅ | World bounds from the mirror, via `node.size` |
| **Group / ungroup / layer order** | ✅ | Tree operations |
| Undo / redo | ✅ | `invertTransaction` |
| Save / load / template | ✅ | SCENE_FORMAT |
| Preview / Program | ✅ | Whole documents |
| **Inspector** | ⚠️ **By table** | `COMPONENT_FIELDS` — a row per type, not a panel per type |

Two are honestly not fully generic, and both are one-line extensions rather than
new code:

- **`colourPath`** in `presets.ts` maps a component type to where its colour
  lives (`fill` for rect, `material.baseColor` for meshRenderer). A text node
  adds `color`. That is a line, and a fade on a node with no colour correctly
  produces **no transaction** rather than a timeline that drives nothing.
- **`COMPONENT_FIELDS`** in the inspector describes each component's editable
  properties. A text node adds a row. A component type **absent** from the table
  still renders — every scalar property appears as a raw field, because the
  underlying edit is a dot path and §7 makes every property animatable and
  bindable without a per-type vocabulary.

So the answer is: **the tools are generic; two lookup tables are not, and both
are declarations rather than logic.** That is the honest version, and it is what
makes Phase 3B's Studio work a day rather than a phase.

---

## 8. What Phase 3A deliberately does not do

| | Why |
| --- | --- |
| Text, Image, SVG tools | The engine cannot draw them (IF-003). A toolbox entry that produces an invisible node teaches a designer to distrust the whole palette |
| Blur / Glow / Dissolve presets | No blur, no bloom, no dissolve in the engine |
| Rounded rectangles | Needs shader work, not geometry (§5.1) |
| The six official templates | Five of six are text-first (IF-003 §4) |
| A 3D viewport | Still outstanding; scheduled after the text engine |
| Font / image asset library | Needs the asset pipeline |
| Auto-timer on `Auto` | A hidden timer is a graphic that leaves air while an operator is still talking about it. `Auto` arms the exit; `Continue` plays it |

---

## 9. Next

1. **Phase 3B — the text engine.** T2/T3/T4 decided first; T3 (adopt vs
   re-implement troika) formally, because it changes what gets built.
2. **The 3D viewport**, immediately after.
3. **Phase 3C — the official graphics library**, once TextNode exists.

Phase 3A's authoring tools land on text for free on day one, which was the point
of building them first.
