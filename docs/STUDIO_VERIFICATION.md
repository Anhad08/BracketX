# Streamatrix Studio — Verification

**Date:** 2026-08-02 · **Subject:** Studio Phase 1
**Verdict:** **VERIFIED.** Every required proof is executable and headless.

| Label | Meaning |
| --- | --- |
| **Proven** | Demonstrated by an executing test or measurement here |
| **Derived** | Follows from something Proven, plus a stated argument |
| **Assumed** | Believed, not tested; the risk is stated |
| **Unknown** | Cannot be established here; what would establish it is stated |

---

## 1. Reproduce

```
pnpm turbo run check-types lint test build      38/38
node tools/check-boundaries.mjs                 exit 0

studio                    62 tests
@bracketx/engine-host    184 tests
@bracketx/engine-scene   126 tests
showcase                 324 tests + 33 browser

pnpm --filter studio bench                      §4
```

---

## 2. The seven required proofs

### V1 — Scenes open correctly. **Proven.**

A new document validates, carries a camera, loads into the engine and draws.
Opening replaces the document, clears history, and resets the dirty flag.

**Proven negatively, which matters more:** a malformed document, a non-JSON
string and a document from a **higher format version** are each refused, and the
document that was already open is asserted **unchanged**. SCENE_FORMAT §13 says
a reader seeing a higher version must refuse rather than partially read;
partially reading is how a save silently drops fields.

### V2 — Save / load is lossless. **Proven, byte for byte.**

A document built through four real edits is serialised, parsed and re-serialised
and the two strings are asserted **identical** — not equivalent. A format that
only round-trips structurally is one that silently reorders keys and breaks
every hash downstream.

Stronger: the reopened document is loaded into a *second* engine session and its
**session hash and mirror size are asserted equal** to the first. Lossless on
disk is not the same claim as lossless in the engine.

**Also Proven:** no editor metadata leaks into the file. `selection`,
`viewport`, `workspace`, `expanded`, `locked` and `ui` are each asserted absent.

### V3 — Undo / redo is deterministic. **Proven.**

A five-edit sequence — create group, create rect, move, rename, reparent — is
snapshotted at every step, unwound checking **every intermediate state**, and
rewound checking every one again. Byte-identical throughout.

Beyond the document: after an undo, the **engine** is asserted back to its
previous session hash and mirror size. An undo that fixed the JSON and left the
scene wrong is the worst possible outcome.

**Also Proven:**
- A new edit clears the redo branch. Keeping it would mean redo could apply a
  transaction whose prior state no longer exists, and its inverse would be wrong.
- Deleting two nodes is **one** undo step.
- An edit that changes nothing is **not recorded** — property panels fire on
  every keystroke, and a history of no-ops makes undo feel broken long before it
  is.
- Dirtiness is tracked by history *position*, so undoing back to a save clears
  it. Proven.

### V4 — Hierarchy edits preserve identity. **Proven.**

Reordering and reparenting both report `nodesCreated: 0` and
`nodesDestroyed: 0`, and the mirror node is asserted to be **the same object**
before and after. Identity is what makes a reorder cheap: the mirror keeps the
handle, the GPU resources, and any animation in flight.

**Also Proven:** reparenting a node into its own subtree is refused *before* the
engine sees it — the engine would refuse too, but a drag that throws mid-gesture
leaves the editor holding a broken drag state. Duplicating remints every node
and component id and the result still validates; deleting a parent and its child
produces one removal, not two; the root can never be deleted.

### V5 — Inspector reflects runtime state. **Proven.**

A property edit is asserted to reach the **mirror's world matrix** on the next
projection. Bounds are read from the mirror, not the document, so a laid-out
child is boxed where it actually sits — Proven by two rects in a vertical layout
authored at the same `y` and asserted to have different world positions.

**Proven, and the reason an engine change was needed:** a variable defined
through an operation now reaches the runtime, and undoing removes it again.

**Proven, and subtler:** changing a default does **not** clobber a live operator
value. An operator who typed a score must not lose it because a designer edited
the authored default (RFC-002 §4.3).

### V6 — Timeline edits affect playback. **Proven.**

Adding a timeline through an operation registers it with the animator. Playing
and seeking to frame 30 samples the expected value; dragging the last keyframe
to 0.5s and re-cueing changes what is sampled at the same frame. The edit is
Proven undoable, restoring both the document bytes and the animator's keyframe.

**Proven negatively:** a `doc.setMeta` whose path reaches into `root` is
**refused**. The node operations own the tree and its invariants — order keys,
parentage, id uniqueness — and a path-set would bypass all three.

### V7 — Selections never mutate the engine. **Proven.**

Selecting, toggling and multi-selecting are performed, and the engine's session
hash, the document bytes, the history depth **and the dirty flag** are all
asserted unchanged. This is the whole argument for keeping selection out of the
document, executing.

---

## 3. Additional properties Proven

| Property | Why it matters |
| --- | --- |
| Primary selection is the **last** click | Shift-clicking a fourth node then dragging must drag relative to the one just clicked |
| Selection deduplicates | A marquee can report one node twice when it overlaps two of its own bounds |
| Range selection works over the **flattened** order | "Between" is a question about what is on screen, not about tree structure |
| Selection prunes deleted ids | Otherwise the inspector reads a node that is gone and the next drag targets nothing |
| Filtered outline keeps ancestors | A filtered tree that drops parents is a list |
| Collapsed subtree costs one row | 20 children, 1 row |
| `hiddenByAncestor` ≠ `visible: false` | A greyed row and an off row are different states |
| Three drop zones | Reparenting and reordering are different intentions; two zones gets one wrong half the time |
| Zoom is about a point | Zooming about the centre is what makes an editor feel like it is fighting you |
| Zoom clamps | Never zero, never infinite |
| Pixels-per-unit follows the **camera** | Proven by doubling `orthographicSize` and asserting the scale halved |
| Picking returns the **topmost** | Taking the first match hands back the root group every time |
| Snapping prefers candidates over the grid | A designer aligning two boxes means the boxes |
| Dragged nodes are excluded from their own snap candidates | Or everything snaps to itself |
| Keymap has no duplicate chords | Two bindings on one chord is a silent loss |
| Shortcuts do not fire while typing | An editor where "f" in a name field re-frames the viewport is one people stop typing in |
| Palette ranks by subsequence | `includes()` returns *Toggle safe areas* for "save as" |
| Workspace clamps a hostile size | Or the only escape from a broken layout is clearing storage |
| A blank document name yields `untitled.scene.json` | Not `scene.scene.json` |

---

## 4. Measured

One machine, mock backend, means. Published values only.

### Documents

| | 50 nodes | 1,000 nodes |
| --- | --- | --- |
| Parse and validate | 0.25 ms | 4.59 ms |
| Open into the engine (construct, load, first frame) | 0.28 ms | 4.72 ms |
| Serialize (canonical) | 0.22 ms | 4.66 ms |

### Edits — the gestures a designer repeats

| | mean |
| --- | --- |
| Set one property, 50 nodes | **0.010 ms** |
| Set one property, 1,000 nodes | **0.123 ms** |
| Nudge 20 nodes in one transaction | 0.214 ms |
| Undo then redo one step (150-deep stack) | **0.064 ms** |
| Create a node, then undo it | 0.228 ms |
| Reorder a node | 0.056 ms |

**Derived:** a property commit at 1,000 nodes is 0.12 ms — about 8 ms of work if
someone typed a hundred values a second, which nobody does. Undo does not depend
on stack depth; measured against a 150-entry history.

**Called out rather than averaged away:** the property edit is **12× more
expensive at 1,000 nodes than at 50**. `makeSetProp` captures the prior value
through `findNode`, which is O(scene). At 1,000 nodes that is invisible; at
100,000 it would be ~12 ms per keystroke commit and would need an index. See §6.

### Hierarchy

| | mean |
| --- | --- |
| Build the outline, collapsed | **0.005 ms** |
| Build the outline, fully expanded (1,000 nodes) | 0.207 ms |
| Filter the outline (1,000 nodes) | 0.397 ms |

The collapsed case is what actually runs: the outline descends only into
expanded branches, so a large document costs one row until someone opens it.

### Selection, picking, viewport

| | mean |
| --- | --- |
| Select one | 0.0001 ms |
| Toggle within a 100-node selection | 0.004 ms |
| Select all, 1,000 nodes | 0.042 ms |
| Compute bounds, 50 nodes | 0.006 ms |
| Compute bounds, 1,000 nodes | 0.154 ms |
| Pick, 50 nodes | 0.0002 ms |
| Pick, 1,000 nodes | 0.003 ms |
| Marquee, 1,000 nodes | 0.015 ms |
| Snap candidates, 1,000 nodes | 0.041 ms |
| Zoom step | 0.0001 ms |
| **Engine frame, 1,000 nodes (for comparison)** | **0.0015 ms** |

**Derived:** a marquee drag recomputes bounds and hit-tests every pointer move —
0.154 + 0.015 ≈ 0.17 ms at 1,000 nodes, comfortably inside a 60 Hz pointer
budget. Panning and zooming cost 0.0001 ms plus a CSS transform; the canvas is
**not redrawn**, because the engine renders only when something changed.

---

## 5. Engine changes — the audit

**Three, all at the seam between document and runtime. None changed a rendering
or evaluation rule.**

| # | Change | Found by | Proven by |
| --- | --- | --- | --- |
| 1 | `SceneHost.apply` syncs variable definitions (define / setDefault / remove), with an override never clobbered | The variable editor's first variable | *a variable defined through an operation reaches the runtime*, *changing a default does not clobber a live operator value* |
| 2 | `SceneHost.apply` reloads document-level subsystems when `animations` or `tokens` change | The timeline's first keyframe | *adding a timeline through an operation registers it with the animator* |
| 3 | `makeSetDocProp` exported; `doc.setMeta` now refuses `root`/`format`/`version`/`id` | Timeline editing needed a capturing helper, and could have reached the tree | *refuses a document path that would reach into the tree* |

**Not added, deliberately:** a `node.selected` flag, a Studio file format, a
second undo implementation, a resize gizmo that would fight layout, and a
`locked` node field. Each is argued in
[STUDIO_ARCHITECTURE.md](./STUDIO_ARCHITECTURE.md).

**A bug the tests caught in change #1:** `resolveVariable` returns a *fallback*
(`null`) for an absent key, so the first implementation's `!== undefined` guard
was true for every key and silently skipped every definition. Now
`state.variables.has(key)`.

---

## 6. Limits

| Claim | Status | What would establish it |
| --- | --- | --- |
| Timings hold on other hardware | **Assumed** | Runs elsewhere. Ratios should hold; absolutes are one machine's |
| Usable at 100,000 nodes | **Unknown** | Measured to 1,000. The outline and picking are fine by construction; `makeSetProp`'s O(scene) prior-value capture is the term that would need an index |
| Layout edits use a rebuild, not an incremental projection | **Known limitation, documented** | The projector cascading placement invalidation. Recorded in STUDIO_ARCHITECTURE §7 rather than hidden |
| Every gesture reachable from the keyboard | **Derived** | Every command is in one list and the keymap is asserted complete and label-complete; that *every* UI button routes through it is by construction, not asserted |
| The editor is pleasant to use | **Assumed** | Use. Correctness is Proven; whether the layout serves a designer at 2am is a judgement no test makes |
| Browser behaviour | **Unknown for Studio** | No Playwright suite yet. Everything asserted here is headless and about documents; the showcase's 33 browser tests still pass |

---

## 7. Assessment

Twelve tests failed on their first run and **six were real bugs**, not test
mistakes: a duplicate that collided on order keys, picking that returned the
bottom node because a stack reverses siblings, a group that emitted
`children: []` and so failed to round-trip, a variable sync guarded on the wrong
sentinel, layout that never re-applied on an incremental projection, and a
filename that produced `scene.scene.json`.

None of them would have been found by reading the API surface. All six were
found by building something real and asserting on documents rather than on
screenshots.

**Verdict: VERIFIED.** The engine's public APIs were expressive enough to build
this editor with three additions, all plumbing, and one honestly-named
limitation.
