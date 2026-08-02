# Streamatrix Studio — Phase 1 Implementation Report

**Date:** 2026-08-02 · **App:** `apps/studio`
**Companions:** [STUDIO_ARCHITECTURE.md](./STUDIO_ARCHITECTURE.md) ·
[STUDIO_VERIFICATION.md](./STUDIO_VERIFICATION.md)

Streamatrix stops being an engine that renders graphics and becomes a platform
that authors them.

---

## 1. What shipped

| Area | Delivered |
| --- | --- |
| **Shell** | Resizable docks, persistent workspace, command palette, full keymap with a generated reference, status bar, dark **and** light themes |
| **Scene View** | Engine-rendered canvas, pan / zoom / fit, safe areas, grid, rulers, guides, snapping, selection boxes, marquee, move gizmo |
| **Hierarchy** | Nesting, visibility, lock, filter, drag to reorder, drag to reparent, rename, duplicate, delete |
| **Inspector** | Node, transform, size, appearance, layout, states, live world readout from the mirror |
| **Toolbox** | Group · Rectangle · Camera. Three, deliberately |
| **Selection** | Single, multi, marquee, hierarchy range, keyboard navigation |
| **Undo / redo** | Over the engine's `invertTransaction`. No second implementation |
| **Files** | New, open, save, save-as, recents. SCENE_FORMAT only |
| **Timeline** | Clips, keyframes, playhead, markers, scrub, drag a keyframe — as document operations |
| **Variables** | Create, edit defaults, bind, inspect readers; runtime values shown and not editable |

62 headless tests, 24 benchmarks, 38/38 turbo tasks, boundaries green.

---

## 2. The question this phase answers

*Are the engine's public APIs expressive enough to build a production editor
without cheating?*

**Yes, with three additions and one honestly-named limitation.** All three
additions are plumbing at the seam between document state and runtime state.
None changed a rendering or evaluation rule. Every one was found by building
something real rather than by reading the API surface.

The parts that needed nothing at all are the more interesting result: the
operation system inverted every edit without Studio writing a line of undo
logic; the reconciler preserved identity through reorders and reparents without
being asked; the mirror answered every question picking and gizmos had.

---

## 3. Undo, in eleven lines

```ts
undo() { this.host.apply(invertTransaction(entry.transaction)); }
redo() { this.host.apply(entry.transaction); }
```

That is the whole implementation. Every engine operation carries enough prior
state to invert itself, so Studio needs a **stack** and nothing else — no
snapshots, no diffing, no shadow document.

An editor with its own history would be a second definition of what an edit *is*,
and the two would disagree the first time the engine gained an operation Studio
did not know about. RFC-002 §6 exists to prevent exactly that, and this phase is
the proof it works.

**One gesture is one undo step.** A drag across two hundred pointer events
drives the store *silently* for feedback, then rewinds to the drag's start and
applies once through the recording path — so the stack holds a single entry with
the correct prior state.

---

## 4. Three engine additions

### 4.1 `apply()` syncs variable definitions

`load()` seeds runtime values from document defaults. `apply()` did not — so
defining a variable in the editor put it in the document and the runtime never
learned it existed. The binding resolved to nothing and the node rendered its
fallback.

The naive fix is to re-seed every default on every transaction, and it is wrong:
it would wipe an operator's live value the moment a designer edited anything
else. RFC-002 §4.3 keeps those separate, so each case is decided explicitly:

```
define      seed only if the runtime has no value — an override outranks a definition
setDefault  update only if the runtime value is still the OLD default
remove      clear it
```

**A bug the tests caught in this change:** `resolveVariable` returns a *fallback*
(`null`) for an absent key, so the first implementation's `!== undefined` guard
was true for every key and skipped every definition silently. Now
`state.variables.has(key)`.

### 4.2 `apply()` reloads document-level subsystems

`animations` and `tokens` are read at `load()` into the animator and the
variable source. A transaction that edited one of them changed the document and
nothing else — so a timeline edit landed in the file and never reached the
playhead.

Keyed on the path's first segment rather than on the operation type, because
`doc.setMeta` addresses the whole document and the segment is what says which
subsystem cares.

### 4.3 `makeSetDocProp`, and a guard on the tree

`doc.setMeta` is named for its first consumer and has always addressed the whole
document — `animations.0.tracks.1.keyframes.2.time` is as valid as `meta.name`.
That is why the timeline needed **no new operation type**: it needed a capturing
helper so the edit inverts, which is now exported.

It also needed a guard. A path-set into `root` would bypass the invariants the
node operations maintain — order keys, parentage, id uniqueness — and produce a
document the mirror cannot project. `doc.setMeta` now refuses `root`, `format`,
`version` and `id`.

The name stays. Renaming a serialised operation is a format break, and a doc
comment is cheaper than a migration.

---

## 5. The limitation, named rather than hidden

Layout is resolved top-down: a container computes placements and its **children**
read them when they are re-applied. An incremental projection re-applies only
the nodes an operation touched — so setting `layout` on a container, or adding a
child to one, updated the container and left its children exactly where they
were. **The document was right and the picture was wrong.**

`SceneHost.apply` now rebuilds when a transaction can move a laid-out child.
That is a public API and the correct answer for now: layout edits are rare next
to property drags, and the alternative is teaching the projector to cascade
placement invalidation — a change to a frozen hot path with no measurement
behind it.

It is a limitation, not a fix. If layout editing becomes hot, the projector
change is the real answer and this note is where it starts.

---

## 6. Decisions worth defending

**Selection is Studio's.** A `selected` flag on a node would make the inspector
trivial and would be wrong three ways: clicking would land on the undo stack and
dirty the file; two people editing one document would fight over each other's
cursors; and the render surface would know what a designer had clicked. Proven:
selecting leaves the session hash, the document bytes, the history depth and the
dirty flag all unchanged.

**Lock is Studio's; visibility is the document's.** Visibility changes what goes
on air, so toggling it is an undoable operation. Lock changes only which gestures
the editor accepts. An editor affordance in a broadcast document is a field every
downstream reader has to ignore.

**Pan and zoom are not a camera.** The camera is *content* — it is what the
programme output draws through and it is persisted. Zoom is a view transform over
rendered pixels, and the verification suite asserts the engine cannot observe it.

**There is no Studio file format.** A `.studio` wrapper carrying editor metadata
is the obvious design and a trap: a document Studio wrote must be readable by the
renderer, an importer and any other editor. Proven: no editor key appears in a
saved file.

**Ids are injected, not random.** `crypto.randomUUID()` satisfies SCENE_FORMAT
§13 in one line and makes every guarantee untestable — "lossless", "deterministic"
and "preserves identity" are all claims about a document being *identical*, and a
document with random ids is never identical to itself.

**Three tools, no fourth.** There is no lower-third tool and there must never be
one. A lower third is a group with a rectangle; the moment Studio ships a
component that knows what one *is*, the engine's general-purpose capabilities stop
being what gets exercised. The panel says so on screen.

---

## 7. Six real bugs the tests found

Twelve tests failed on their first run. Six were real:

| Bug | Consequence if shipped |
| --- | --- |
| Duplicate kept the original's **order key** | Every duplicate gesture failed — the engine correctly refuses a colliding key |
| `nodeBounds` used a stack, which **reverses siblings** | Clicking overlapping nodes selected the one *underneath* |
| A new group emitted `children: []` | Insert-then-undo did not round-trip; canonical form omits an empty array |
| Variable sync guarded on `!== undefined` against a `null` fallback | Every variable definition silently skipped |
| Layout never re-applied on an incremental projection | Setting a layout did nothing visible |
| `fileNameFor("")` produced `scene.scene.json` | Cosmetic, and the kind of thing that ships forever |

None would have been found by reading the API surface. All six came from
building something real and asserting on documents rather than screenshots.

---

## 8. Cost

Measured, mock backend, means. Full table in the verification document.

```
set one property, 1,000 nodes        0.123 ms
undo then redo (150-deep stack)      0.064 ms
build the outline, collapsed         0.005 ms
pick, 1,000 nodes                    0.003 ms
marquee frame, 1,000 nodes           0.169 ms   (bounds + hit test)
open a 1,000-node document           4.72  ms
serialize a 1,000-node document      4.66  ms
engine frame, 1,000 nodes            0.0015 ms  (for comparison)
```

**Called out rather than averaged away:** a property commit is **12× more
expensive at 1,000 nodes than at 50**, because `makeSetProp` captures the prior
value through an O(scene) `findNode`. Invisible today; at 100,000 nodes it would
be ~12 ms per keystroke and would need an index. Recorded in the verification
document's limits.

Panning and zooming cost 0.0001 ms plus a CSS transform. **The canvas is not
redrawn** — the engine renders only when something changed, which is what the
brief asked for by name.

---

## 9. What Phase 1 does not do

Resize and rotate gizmos (a resize handle writes `size`, and layout overrides
`size` for a laid-out child — shipping a handle that silently does nothing
inside a layout container is worse than not shipping one), text nodes, multi-
document tabs, collaborative editing, detachable panels, asset import, and a
browser test suite for Studio.

Each is argued in [STUDIO_ARCHITECTURE.md §10](./STUDIO_ARCHITECTURE.md).

---

## 10. Assessment

The long-term goal is that a designer builds a lower third, a scoreboard, a
leaderboard or a bracket entirely through Studio — no code, no JSON, and **no
special-case logic anywhere in the stack**.

Phase 1 does not get there: without text nodes a lower third has no words. But
it establishes the thing that makes getting there possible — every one of those
four graphics is a group, a layout, a collection and a timeline, and Studio has
a general-purpose editor for all four with no knowledge of any of them.

The engine came through its first real editor with three plumbing additions and
one named limitation. That is a stronger result than a longer list would have
been.
