# Streamatrix Studio — Architecture

**Date:** 2026-08-02 · **App:** `apps/studio` · **Phase:** 1
**Companions:** [STUDIO_VERIFICATION.md](./STUDIO_VERIFICATION.md) ·
[IMPLEMENTATION_REPORT_STUDIO_PHASE_1.md](./IMPLEMENTATION_REPORT_STUDIO_PHASE_1.md)

Studio is the first end-user application on the engine. Its job in Phase 1 is
not to be pretty — it is to prove the public APIs are expressive enough to build
a production editor **without cheating**.

---

## 1. The division, stated once

| Studio owns | The engine owns |
| --- | --- |
| authoring, editing, project management | runtime, rendering, evaluation |
| interaction, workflows, selection | animation, determinism, outputs |
| history *position* (the stack) | history *semantics* (`invertTransaction`) |
| the viewport transform | the scene camera |

**Studio is not a second runtime.** There is one `SceneHost`, one clock, one
reconciler, one mirror. The editor drives them; it never reimplements them.

Three consequences that shaped the code:

- **Preview is the engine rendering to a canvas**, at the document's own
  resolution — the same pixels a programme output receives. Studio never draws
  its own approximation of a rectangle. The day an approximation disagreed with
  the engine would be the day someone shipped a graphic that looked different on
  air than it did while they were making it.
- **Playback is `SceneHost.play/pause/seek`.** Studio owns no timer.
- **Live update is `reconciler.project(transaction)`**, not a rebuild — except
  where it cannot be, which is recorded honestly in §7.

---

## 2. Shape

```
apps/studio/src/
  studio/            the core. No React. Headlessly testable.
    document-store   transactions in, undo/redo over invertTransaction
    editing          intents → Transactions. Pure.
    selection        Studio-owned, pure functions over an immutable set
    outline          the document flattened for a tree view
    viewport         three coordinate spaces, picking, snapping
    project          new / open / save / recents, SCENE_FORMAT only
    session          the one hold on the engine
    commands         one command list; palette, keyboard and menus read it
    workspace        panel state, persisted, never in the document
    ids              injectable id minting
  ui/                React. Renders models, turns gestures into transactions.
    scene-view · panels · palette
  App.tsx            the shell: owns everything reachable from two places
```

The split is the same one the workbench made and for the same reason: a claim
like *"save and reload is lossless"* or *"a reorder preserves identity"* is a
claim about a **document**, and a test that needed a browser to check it is a
test that will eventually be skipped.

---

## 3. Editing: one path, no exceptions

Every change to a document is a `Transaction` produced by a pure function in
`editing.ts` and applied by `SceneHost.apply`. Nothing else mutates.

```
gesture ──► editing.ts (pure) ──► Transaction ──► store.apply ──► host.apply
                                                       │
                                                       └─► undo stack
```

**One transaction is one undo step** (RFC-002 §6). Deleting four nodes is one
step. A drag across two hundred pointer events is one step — the drag drives the
store *silently* for feedback, then rewinds and applies once through the
recording path, so the stack holds a single entry with the correct prior state.

**There is no second undo implementation.** Every engine operation carries
enough prior state to invert itself, so undo is a stack and nothing else:

```ts
undo  ─►  host.apply(invertTransaction(t))
redo  ─►  host.apply(t)
```

No snapshots, no diffing, no shadow document. An editor with its own history
would be a second definition of what an edit *is*, and the two would disagree
the first time the engine gained an operation Studio did not know about.

---

## 4. Selection belongs to Studio

Putting a `selected` flag on a node would make the inspector trivial and would
be wrong three ways at once: clicking would land on the undo stack and dirty the
file; two people editing one document would fight over each other's cursors,
because the document is what synchronises; and the render surface would have to
know what a designer had clicked.

So selection is plain Studio state, and
[the verification suite asserts](./STUDIO_VERIFICATION.md) that changing it
leaves the engine's session hash and the document bytes untouched.

**Lock is the same call.** Visibility is a document property — it changes what
goes on air, so toggling it is an undoable operation. Lock changes only which
gestures Studio accepts, so it stays in the workspace. The alternative (a
`locked` field, round-tripped as an unknown node field under §13) is defensible
and was rejected: an editor affordance in a broadcast document is a field every
downstream reader has to ignore.

---

## 5. The viewport is not a camera

The obvious implementation of zoom is to change the camera's
`orthographicSize`. It must never ship: **the camera is content**. It is what
the programme output draws through and it is persisted.

Studio's navigation is a view transform over the rendered canvas. Three spaces,
converted in exactly one file:

```
world    metres, Y up, origin centre     what the document stores
canvas   pixels, Y down, origin top-left what the engine renders
screen   pixels in the viewport element  what a mouse reports
```

Pixels-per-unit is derived from the **active camera's** orthographic size, never
a constant — a hardcoded 108 works until someone authors a different camera, at
which point every gizmo is silently wrong and the scene still looks fine.

Node bounds read the **mirror's** world matrix, so a node placed by layout or
driven by animation is boxed where it actually is. An editor that drew handles
at the authored position would be unusable for exactly the scenes composition
was built for.

---

## 6. Files: there is no Studio format

What Studio saves is a SCENE_FORMAT document and nothing else — canonical JSON
in, canonical JSON out, validated on the way in by the engine's own
`validateDocument`. A `.studio` wrapper carrying editor metadata is the obvious
design and it is a trap: the moment it exists, a document Studio wrote is not a
document the renderer, an importer or another editor can read.

Editor state lives in the workspace store. Losing it costs nothing; losing
portability costs everything.

A document from a **higher** format version is refused, never partially read
(§13). Refusal happens at the door, before the open document is torn down —
"your file is broken" is a much worse message when it arrives after the work is
gone.

---

## 7. Engine changes, and one limitation

Three additions, all made through the public API rather than around it. Full
audit in the [implementation report](./IMPLEMENTATION_REPORT_STUDIO_PHASE_1.md).

| Change | Why Studio needed it |
| --- | --- |
| `SceneHost.apply` syncs variable definitions | Defining a variable put it in the document and the runtime never learned it existed |
| `SceneHost.apply` reloads document-level subsystems | A timeline edit landed in the file and never reached the playhead |
| `makeSetDocProp`, and `doc.setMeta` refuses tree paths | Timeline editing needed a capturing helper; the tree needs protecting from path-sets |

**The limitation, recorded rather than hidden.** Layout is resolved top-down: a
container computes placements and its *children* read them when re-applied. An
incremental projection re-applies only the nodes an operation touched, so
setting `layout` on a container — or adding a child to one — updated the
container and left its children where they were. The document was right and the
picture was wrong.

`SceneHost.apply` now **rebuilds** when a transaction can move a laid-out child.
That is a public API and the correct answer for now: layout edits are rare next
to property drags, and the alternative is teaching the projector to cascade
placement invalidation — a change to a frozen hot path with no measurement
behind it. It is a limitation, not a fix, and it is named as one.

---

## 8. The rule the toolbox exists to enforce

Three entries: **Group, Rectangle, Camera**. Deliberately no fourth.

There is no "lower third" tool and there must never be one. A lower third is a
group with a rectangle; a scoreboard is a group with a layout and a collection;
a bracket is a template repeated over data. The moment Studio ships a component
that knows what a lower third *is*, the engine's general-purpose capabilities
stop being the thing that gets exercised — and the long-term goal is precisely
that a designer builds all four from the same primitives, with no special case
anywhere in the stack.

The panel says so on screen, not only in this document.

---

## 9. Commands: one list, three surfaces

Every action is declared once in `commands.ts`. The palette searches it, the
keyboard dispatches from it, the menus render it. **An action with no entry
there does not exist** — a button that calls something directly is unreachable
from the keyboard and invisible to search.

Matching is subsequence with position bonuses rather than `includes()`, because
a designer typing "sa" for *Save as* should not get *Toggle safe areas* first.

The keyboard reference is generated from the keymap, so it cannot drift from the
bindings. A shortcut sheet that lies is worse than no sheet.

---

## 10. What Phase 1 does not do

| | Why |
| --- | --- |
| Resize / rotate gizmos | A resize handle writes `size`, and layout overrides `size` for a laid-out child. Shipping a handle that silently does nothing inside a layout container is worse than not shipping one. |
| Text nodes | The text engine is a separate spike (T1). The toolbox stays honest about what the engine can draw today. |
| Multi-document tabs | One document, one session. Two would need two hosts and two canvases, which is real work with no Phase 1 consumer. |
| Collaborative editing | Phase 14. The operation log is already the right substrate; nothing here forecloses it. |
| Detachable panels | The dock resizes and persists. Detaching is weeks of layout state for a problem the keyboard already solves. |
| Asset import | Phase 1 assets exist in the format; no consumer in the editor yet. |

---

## 11. What Studio proved about the engine

The brief asked whether the public APIs are expressive enough to build a
production editor without cheating. Phase 1's answer:

**Yes, with three additions and one limitation** — and every one of them was
found by building something real rather than by reading the API surface. The
operation system inverted every edit without Studio writing a line of undo
logic; the reconciler kept identity through reorders and reparents without being
asked; the mirror answered every question the gizmos had.

The three additions were all *plumbing at the seam between document and
runtime*, which is exactly where a first editor would be expected to find gaps,
and none of them changed a rendering or evaluation rule.
