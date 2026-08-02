# Implementation Report — Streamatrix Studio Phase 3A

**Date:** 2026-08-02 · **Branch:** `phase-2-engine`
**Brief:** Phase 3A — Studio Authoring. Every workflow independent of text.
**Companions:** [STUDIO_PHASE_3_ARCHITECTURE.md](./STUDIO_PHASE_3_ARCHITECTURE.md) ·
[STUDIO_PHASE_3_VERIFICATION.md](./STUDIO_PHASE_3_VERIFICATION.md)

---

## 1. Against the brief

| Asked for | Delivered | |
| --- | --- | --- |
| Object Toolbox | 9 kinds: Rectangle, Ellipse, Box, Sphere, Cylinder, Plane, Group, Camera, Light — sectioned, every one asserted to attach something | ✅ |
| Scene creation workflow | New / open / save / recents (Phase 1), plus save-to-library and open-a-copy | ✅ |
| Property Inspector | Context-aware, driven by a **description table** rather than a panel per component type | ✅ |
| Timeline authoring UI | Rebuilt: multi-timeline, rename, duration, loop, zoom, scrub, retime, per-track delay, markers | ✅ |
| Keyframe editing | Record, replace, multi-select, drag, delete, copy, paste-with-retarget, easing, quantised to the frame grid | ✅ |
| Animation preset system | 16 presets compiling to ordinary tracks; relative to the node; merge-into-existing | ✅ |
| Variable editor | Phase 1 shipped define/bind/default; **override + reset** complete it, in their own column | ✅ |
| Preview / Program workflow | Two sessions, two canvases, two clocks, one explicit transition | ✅ |
| Take / Cut / Auto transitions | Plus Hold, Continue and Clear — the words an operator says | ✅ |
| Asset Library | Motion presets, design tokens, saved scenes, templates | ⚠️ Fonts and images blocked on the asset pipeline |
| Save / Load templates | `document.template`, a parameter per variable, drift reporting, instantiate-with-lineage | ✅ |
| Selection, Multi-select | Phase 1 | ✅ |
| Alignment | 6 edges + 2 distribute axes, in **world** space, to the selection | ✅ |
| Grouping | Group in place, ungroup into the group's slot | ✅ |
| Layer ordering | Front / forward / backward / back, with ⌘] and ⌘[ | ✅ |
| Undo / Redo polish | Every gesture is exactly one step; no-ops return `null` and never reach the stack | ✅ |
| **Generic over node type** | Audited capability by capability — [architecture §7](./STUDIO_PHASE_3_ARCHITECTURE.md) | ✅ with two named exceptions |

**Not delivered, and why:** Text / Image / SVG tools, the six official templates,
and Blur / Glow / Dissolve presets. All three are the same rule — *a tool exists
only when the engine can draw what its name says* — and the first two are
IF-003, which you accepted.

---

## 2. What changed

```
 apps/studio/src/studio/keyframes.ts    NEW   timeline + keyframe authoring
 apps/studio/src/studio/presets.ts      NEW   16 presets, compiled to tracks
 apps/studio/src/studio/arrange.ts      NEW   align, distribute, group, order
 apps/studio/src/studio/program.ts      NEW   Preview → Take → Program
 apps/studio/src/studio/library.ts      NEW   templates, tokens, the shelf
 apps/studio/src/ui/timeline.tsx        NEW   the timeline editor
 apps/studio/src/ui/authoring.tsx       NEW   presets, arrange bar, library
 apps/studio/src/ui/program.tsx         NEW   the Preview/Program row
 apps/studio/src/authoring.test.ts      NEW   63 assertions
 apps/studio/src/authoring.bench.ts     NEW   24 benchmarks
 apps/studio/e2e/authoring.spec.ts      NEW   10 browser tests
 apps/studio/src/studio/session.ts      +     variable override/reset, notify
 apps/studio/src/studio/editing.ts      +     the toolbox, 9 kinds
 apps/studio/src/ui/panels.tsx          ~     inspector by table; old timeline out
 apps/studio/src/App.tsx                ~     program bus, tabs, arrange bar
 packages/engine-reconciler/…/mirror.ts FIX   lights were never attached
 packages/engine-reconciler/…/mesh-primitives.ts  +  the `disc` primitive
 packages/engine-scene/src/ids.ts       +     a `template` id kind
 packages/engine-text/src/index.ts      FIX   a boundary test red since T1
```

**Verification:** 125 headless + 10 browser + 24 benchmarks. Whole workspace:
35/35 tasks green (test, check-types, lint).

---

## 3. Six bugs, and what found each

The interesting part of this phase. Each was caught by a *different kind* of
assertion, and none by using the editor.

| | Bug | Found by |
| --- | --- | --- |
| 1 | **Ungroup's inverse collided with itself.** `previousNode` captured the group with its children, so undo reinserted nodes that were already back at the parent — `MirrorViolation: duplicate ownership` | A headless assertion that group+ungroup is two undo steps |
| 2 | **Ungroup could reorder the layers.** Open-ended order keys pushed the children past the group's following siblings | Asserting the slices before and after are *bit-for-bit the same list*, not just that the children returned |
| 3 | **Lights were never attached to their nodes.** `MirrorGraph.setAttachment` had no `light` case. The light existed on the backend, unparented, with no position or direction | The toolbox test — the first time a light was created through a **document** |
| 4 | **`pending` canonicalized the whole document on every render** — 0.586 ms, on a per-repaint path | A benchmark at realistic size |
| 5 | **The shell never re-read the engine.** Frame counter, playhead and live variables each correct once, then frozen. True since Phase 1 | A browser test |
| 6 | **Every recorded keyframe landed at time zero.** The playhead read a clip state that does not exist until a clip is cued | A browser test |

Three things worth drawing out.

**#3 is the one IF-003 predicted.** §6 of that finding said *"every lighting
claim in ADR-013 amendment 1 is a headless assertion about descriptors and
handles"*. It was exactly right. The existing tests asserted at the wrong level:
`attachmentOf` reads the **mirror**, the conformance suite calls `attachLight`
**directly**, and nothing asserted the one step between them. The regression test
now lives in `hybrid.test.ts` and asserts on the **backend snapshot**.

Nothing about ADR-013 was weakened to fix it. The boundary still has 30 methods;
one of them was simply never called.

**#4 is the third time a benchmark at realistic size found a cost structural
tests could not see** — after the workbench's `diagnostics()` and the Studio
bench's own NaN. Benchmarking at demo size hides O(scene) costs. That rule has
now paid for itself three times.

**#6 is the sharpest argument for the browser layer.** `setKeyframe` was correct
and thoroughly tested. It had no bug. The *caller* passed it 0, forever, and 125
headless assertions could not see it because they call `setKeyframe` themselves.

The general lesson, stated plainly: **a headless suite proves the code paths are
right; it cannot prove a gesture reaches them.** Phase 3A shipped two panels that
rendered perfectly and were wired to nothing, and both were invisible until a
browser looked. `apps/studio/e2e/` had been an empty directory with a config
since Phase 1.

---

## 4. Engine changes, and why each was legitimate

The phase was meant to need none. It needed two additions.

**A `disc` primitive.** SCENE_FORMAT declares `cornerRadius` on `rect` and
**nothing implements it** — so a Circle tool built that way would render a
square, which is the failure that kept Glow out of the presets. Implementing
`cornerRadius` properly is shader work with a material-kind consequence; a disc
is geometry, needing no backend method, no `MaterialDescriptor` change, and no
version bump (`primitive.shape` is already read defensively, §13 rule 4). The
rounded rect waits for the renderer work it actually needs.

**A `template` id kind.** One key in `ID_PREFIXES`, so a template's id can be
lineage: instantiating remints the document id and keeps the template's.

Both go through public API. Neither touches the frozen boundary.

---

## 5. Where I disagreed with the brief

Three places, all in the direction of shipping less.

**The brief listed Blur In, Dissolve and Glow as presets.** They are not shipped.
The engine has no blur, no bloom and no dissolve, and a designer who picks "Glow"
and gets a fade has been lied to by the tool. The panel says so on screen.

**The brief said "Object Toolbox" without qualification.** Text, Image and SVG
are absent for the same reason — a tool that produces an invisible node teaches a
designer to distrust the whole palette. Also said on screen, with the finding
number.

**"Auto" does not start a timer.** It takes and arms the exit; `Continue` plays
it. A hidden timer is a graphic that leaves air while an operator is still
talking about it.

---

## 6. The honest state of "generic over node type"

You made this the binding requirement, so here is the unvarnished answer.

**The tools are generic.** Keyframing addresses `(target, path)` and never asks
what a node is. Alignment reads world bounds. Grouping and ordering are tree
operations. Undo is `invertTransaction`. Preview/Program moves whole documents.

**Two lookup tables are not, and both are declarations rather than logic:**

- `colourPath` in `presets.ts` maps a component type to where its colour lives
  (`fill` for rect, `material.baseColor` for meshRenderer). A text node adds
  `color` — one line. A fade on a node with no colour correctly produces **no
  transaction** rather than a timeline that drives nothing.
- `COMPONENT_FIELDS` in the inspector describes each component's editable
  properties. A text node adds a row. A type **absent** from the table still
  renders — every scalar property appears as a raw field, because the underlying
  edit is a dot path and §7 makes every property animatable and bindable without
  a per-type vocabulary.

So: **Phase 3B's Studio work is two table rows, not a phase.** That was the point
of building the authoring tools first, and it holds.

---

## 7. Cost

Full table in the verification document. The headline is the one number the
benchmarks were written to produce:

> The whole-timeline rewrite — one operation per keyframe edit, traded
> deliberately for unconditional correctness — costs **1.5× for 16× the
> keyframes**. 0.0103 ms per drag at 512 keyframes, against a 16.7 ms frame.

Every per-pointer-move gesture is three orders of magnitude inside a frame.
Canonicalization (~0.55 ms / 64 nodes) is the only expensive operation, and it
now runs in exactly two places: saving a library card, and a Take.

---

## 8. What this phase does not close

- **The 3D viewport.** Still outstanding. Bug #3 is a reminder of what that
  costs: a light's attachment is now asserted to reach the backend, and whether
  it *visibly illuminates anything* remains unverified.
- **Keyframe pointer-dragging** has no browser test. The handler is exercised
  headlessly and by a click-select; nothing drags across a lane.
- **Text.** IF-003 stands. Phase 3B, with T2/T3/T4 decided first, and T3 formally
  before implementation starts.

---

## 9. Recommendation

Unchanged from IF-003 §6, and now with the authoring tools underneath it:

**Phase 3B — text engine → 3D viewport → Phase 3C — official templates.**

Text first, because it unblocks five of six official templates and the entire
lower-third success criterion. And the day `TextNode` exists, the timeline
editor, the presets, the alignment tools, the inspector, the templates and the
Take path all work on it — which is what Phase 3A was for.
