# Streamatrix Studio Phase 3A — Verification

**Date:** 2026-08-02
**Headless:** `apps/studio/src/authoring.test.ts` (63) +
`apps/studio/src/studio.test.ts` (62) = **125 passing**
**Browser:** `apps/studio/e2e/authoring.spec.ts` (10 passing, Chromium + SwiftShader)
**Benchmarks:** `apps/studio/src/authoring.bench.ts` (24)
**Engine regression:** `packages/engine-host/src/hybrid.test.ts` (+1)

---

## 1. How these were chosen

A claim is only interesting if it can fail. Every assertion below was written to
break under a specific plausible implementation, and several of them did break
first — §7 lists the four that caught real bugs during this phase.

**Two layers, answering two different questions.**

Everything in §2–§5 is **headless**, against `MockMirrorBackend`, for the reason
the Phase 1 suite gave: every claim there is about a document, a transaction, or
engine state, and a test that needed a browser to check one of those would
eventually be skipped.

§9 is in a **browser**, and it exists because that argument has a hole. Headless
tests prove the code paths are correct; they cannot prove a gesture *reaches*
them. The specific failure they cannot see is **a panel that renders perfectly
and is wired to nothing** — and Phase 3A shipped two of those before a browser
looked (§7.5, §7.6). Every browser test therefore ends on an assertion about
state the **engine** reports — the frame counter, the history depth — rather
than on the panel that caused it.

---

## 2. Preview never reaches Program without a Take

The brief made this non-negotiable: *"Preview should never affect Live. Changes
occur only after explicit transition."*

| Claim | How it is asserted | Would fail if |
| --- | --- | --- |
| Arbitrary Preview editing leaves Program untouched | Create 5 nodes, rename each, render, play, seek, undo. `program.host.sessionHash()` and the canonical document must both be **unchanged** | Program shared a document, a runtime, or a clock |
| A Take copies by value | Take, then rename in Preview. Program's bytes unchanged, and the node still holds its **pre-Take** name | Take passed a reference |
| `pending` tracks air, not the file | Air a non-trivial document, edit, undo. `pending` false, `dirty` **true** | `pending` were derived from the undo stack |
| Program keeps its own clock | Take, seek Program to 40, then seek Preview to 0 and play. Program still at frame 40 | One runtime backed both |
| Cut ≠ Take | `cut().played` is null; `take().played` is the entrance id | Cut played the entrance |
| Hold does not rewind | Take, seek to 24, hold. Frame is **24** and the clock is paused; Continue resumes at 24 | Hold called `stop` |
| Clear does not fake a pending | Cut, clear. `pending` stays false | The aired hash were cleared with the surface |
| Entrance/exit naming degrades sanely | No timelines → null; `Fade Out` + `Slide In` → correct pair; a single `Wiggle` → it is the entrance, no exit | The convention were required rather than assumed |
| **The canonical cache cannot go stale** | Three rounds of edit → `pending` true → undo → `pending` false | The cache were keyed on anything weaker than document identity |

The first row is the one that matters. It is asserted the only way that means
anything — by editing Preview as hard as an editor can and requiring Program to
be **byte-identical**, not merely "looking right".

---

## 3. Keyframe authoring

| Claim | How it is asserted | Would fail if |
| --- | --- | --- |
| **Keyframes leave the editor sorted** | Drag keyframe 0 past keyframe 1. Times are `[0.5, 0.75, 1]` **and** values travelled with their keyframes: `[1, 0, 2]` | A mutation appended without re-sorting — the engine sorts only at load, so this animates wrongly in-session and correctly after reload |
| Keying twice at one time replaces | Key `0.5` again with a new value. Three keyframes, not four; the value is the new one | Insert-always |
| A no-op is not an undo step | Key an identical value → `null` | Property panels fire per keystroke |
| Times snap to the frame grid | `quantize(0.4166666, 60)` = 25/60; a keyed 0.4166666 lands on 25/60 | A keyframe between two frames the playhead can never sit on |
| A clamped group keeps its spacing | Drag three keyframes by −5 s. Result `[0, 0.5, 1]`, not `[0, 0, 0]` | Each keyframe clamped independently |
| Duration grows to contain content | Drag the last keyframe +4 s → duration 5 | Clamping would strand the keyframe in the document, unreachable |
| An emptied track is removed | Delete all three keyframes → `tracks` empty, `validateTimeline` clean, document valid | A zero-keyframe track is invalid and would not load |
| **One operation per edit** | A two-keyframe move produces **1** operation, of type `doc.setMeta` | Per-keyframe path sets would have operation 2 address a keyframe operation 1 moved |
| Retime scales everything together | ×0.5 halves duration, delay, stagger interval and every keyframe time | Scaling a subset changes the animation's shape, not its speed |
| Retime refuses no-ops | factor 1 and factor 0 → `null` | |
| Copy is positional | Copy keyframes at 0.5 and 1.0 → clipboard times `[0, 0.5]` | Absolute times make paste a no-op |
| Paste retargets | Paste onto another node → its track has the same path at `[1.5, 2]`; the source track is untouched | |
| Paste wins a collision | Paste onto an occupied time → that time carries the **pasted** value | |
| Easing clears to *absent* | Set then clear → the `easing` key is **not present** | Writing `"linear"` breaks byte round-trip |
| `loop: false` is omitted | Loop on, loop off → document is byte-identical to before | Canonical form drops defaults |
| Markers stay unique and sorted | Set `b`@1, `a`@0.25, `b`@0.5 → `[a, b]` at `[0.25, 0.5]`; removing both drops the field | Two markers with one id makes "seek to X" ambiguous |
| Removing a timeline keeps the rest addressable | Remove the first of two, then edit the survivor | A path-set cannot express an array splice |
| **A mixed session round-trips** | 7 different edits, undo all → byte-identical to the start; redo all → byte-identical to the end | Any inverse being approximate |

---

## 4. Presets

| Claim | How it is asserted | Would fail if |
| --- | --- | --- |
| **Presets are relative** | Same slide on nodes at x=3 and x=−2. Each **ends at its own x** and starts 12 units left of it | An absolute preset would stack both nodes on one spot |
| They compile to an ordinary timeline | `validateTimeline` clean, the animator loads it, and sampling mid-flight is strictly between the endpoints; at the end it is exactly home | Any runtime special case |
| A fade is a hex-alpha colour animation | `withAlpha` truncates, clamps and expands `#abc`; the animator produces `#2f6febff` past the fade | The engine needed an `opacity` property |
| **A preset that would drive nothing is refused** | `fade-in` on a group → `null`, and no timeline is created | A timeline that "looks applied and does nothing" |
| Emphasis returns to rest | Every `pulse` track starts and ends at the node's authored 1.5 | Emphasis would displace and could not loop |
| **No preset names an effect the engine lacks** | No preset id contains blur, glow, dissolve, bloom or shadow — **and** every listed preset builds ≥1 track for a plain rect | A menu entry that lies about what it does |
| One undo step, exact inverse | Depth +1; undo → byte-identical, animator has no clips | |
| Merging grows the host timeline | Merge with a 0.2 s delay → 1 timeline, 2 tracks, duration 0.8 | The tail would be clamped away and the preset would look broken |

---

## 5. Arrangement, toolbox, variables, library

### Arrangement

| Claim | How it is asserted |
| --- | --- |
| **Alignment is in world space** | `b` at local x=0 inside a group offset to x=3 aligns left with `a` at x=−4: its **world** left edge matches, and its local x becomes −7 |
| Alignment is to the selection | Two nodes align to the higher of the two (y=2.5), nowhere near the canvas edge |
| Aligning twice is a no-op | Second call → `null`. One node → `null` |
| Distribute leaves the outermost alone | `[0, 5, 6]` → `[0, 3, 6]`; second call `null`; two nodes `null` |
| **Group does not move anything** | World rects of both children are unchanged to 6 decimals after grouping |
| Group lands in the first node's slot | The group takes that index and is **not** last — an appended group draws in front of everything |
| Group refuses across parents | Two nodes with different parents → `null`; the root → `null` |
| **Ungroup lands in the group's slot** | Children reappear at the group's index, in order, and everything before and after is bit-for-bit the same list |
| Each is one undo step | Group + ungroup = depth +2; two undos → byte-identical |
| Reorder refuses no-ops | `back` on the first → `null`; the root → `null` |
| An arrangement session stays valid | group → align → reorder → ungroup, then `validateDocument` |

### Toolbox

| Claim | How it is asserted |
| --- | --- |
| **Every entry draws** | For all 9 kinds: the document validates, the node reaches the mirror, and the backend's attachment count for the expected kind goes up by exactly 1 |
| No broadcast nouns | No label or kind contains lower third, ticker, scoreboard, bug, bracket, leaderboard |
| No promises the engine cannot keep | No `text`, `image`, `svg`, `video` kind |
| A group round-trips | No `children: []`; insert-then-undo is byte-identical |
| **An ellipse is keyframed by the rectangle's code** | The same preset calls work, and the fade resolves `material.baseColor` instead of `fill` |

### Variables

| Claim | How it is asserted |
| --- | --- |
| An override is not a document edit | Runtime value changes; canonical bytes and history depth **unchanged** |
| Reset restores the default, not nothing | Override then reset → the default, and `isOverridden` false |
| An unknown key clears cleanly | Override then reset a key with no variable → undefined |

### Templates and library

| Claim | How it is asserted |
| --- | --- |
| A parameter per variable, `required` when there is no default | 2 variables → 2 parameters; the one with a `null` default is `required` |
| **Lineage survives a re-save** | Promote, rename, promote again → same template id, new name |
| Drift is reported | Add a variable after promoting → `'variable "extra" is not a parameter'` |
| Demote keeps the variables | `template` gone, 2 variables intact, document valid |
| Instantiate remints the document and keeps the template | New document id, same template id, new `createdAt`, valid |
| **A card cannot go stale** | Rename the document → the card's name changes, because every field is read out of the document |
| Saving twice updates | Keyed by document id; 1 entry, the later `savedAt` |
| A corrupt or absent store does not break opening | `null` store and `"{not json"` both → `[]` |
| Tokens sort, dedupe and vanish cleanly | Inserted in reverse → sorted; identical set → `null`; all removed → absent from the canonical bytes |
| A template round-trips | The card's json **is** `canonicalize(document)`; an instance is deliberately different |

---

## 6. Cost

64-node scene, 512-keyframe timeline. Mean, vitest bench, `MockMirrorBackend`.

| | Mean | p99 |
| --- | --- | --- |
| **Keyframe drag** | | |
| move one keyframe, 32 in timeline | 0.0068 ms | 0.0157 |
| move one keyframe, 512 in timeline | **0.0103 ms** | 0.0201 |
| move twenty keyframes, 32 | 0.0111 ms | 0.0217 |
| move twenty keyframes, 512 | 0.0219 ms | 0.0396 |
| **Keyframe CRUD** | | |
| record a keyframe | 0.0097 ms | 0.0171 |
| delete a keyframe | 0.0106 ms | 0.0310 |
| set easing on twenty | 0.0133 ms | 0.0244 |
| retime the whole timeline | 0.0394 ms | 0.0682 |
| **Clipboard** | | |
| copy eight keyframes | 0.0014 ms | 0.0024 |
| paste onto twenty nodes | 0.0302 ms | 0.0529 |
| **Presets** | | |
| apply a slide to one node | 0.0050 ms | 0.0101 |
| apply a fade to sixty-four nodes | 0.138 ms | 0.255 |
| merge into a 512-keyframe timeline | 0.0107 ms | 0.0179 |
| **Arrangement** | | |
| compute world bounds, 64 nodes | 0.0050 ms | 0.0091 |
| align twenty nodes | 0.178 ms | 0.282 |
| distribute twenty nodes | 0.189 ms | 0.325 |
| group twenty nodes | 0.387 ms | 0.644 |
| reorder one node | 0.0104 ms | 0.0176 |
| **Air** | | |
| cut a 64-node scene to Program | 0.493 ms | 1.20 |
| `pending` | **0.000054 ms** | 0.0001 |
| **Library** | | |
| describe a document for a card | 0.547 ms | 1.05 |
| promote to a template | 0.0066 ms | 0.0118 |
| merge the starter palette | 0.0083 ms | 0.0150 |
| canonicalize a 64-node document | 0.555 ms | 1.00 |

### What the numbers say

**The whole-timeline rewrite is cheap.** This is the number the benchmark exists
for. §3.2 of the architecture traded a known cost for unconditional correctness,
and an untested cost is a guess. **16× the keyframes costs 1.5× the time.** The
rewrite is not the dominant term at any size a graphic reaches.

**Every per-pointer-move gesture is three orders of magnitude inside a frame.** A
drag at 512 keyframes is 0.010 ms against a 16.7 ms budget.

**Canonicalization is the only expensive thing here**, at ~0.55 ms for 64 nodes —
and it is O(document), so it would be tens of milliseconds at broadcast scale. It
appears in exactly two places: saving a card (once, deliberate) and a Take (once
per graphic). It used to appear in a third, which is §7.4.

---

## 7. What the suite caught

Six real bugs, all found by an assertion rather than by use — and each by a
*different kind* of assertion, which is the point.

### 7.1 Ungroup's inverse collided with itself

`ungroup` emits `[move child…, remove group]`, and `previousNode` captured the
group **as authored** — with its children still inside. Inverting a transaction
reverses it, so undo reinserted the group carrying copies of nodes that were
already back at the parent:

```
MirrorViolation: create("nod_00000005"): already exists — duplicate ownership
```

Caught by *"group and ungroup are each one undo step"*. Fixed by capturing the
group **emptied** — which is what it actually is by the time the removal runs.

### 7.2 Ungroup could reorder the layers

Generating the children's new order keys with an open upper bound would push them
past the group's following siblings. Caught by asserting that the slices before
and after the group's slot are bit-for-bit the same list, rather than just that
the children came back.

### 7.3 Lights were never attached to their nodes

`MirrorGraph.setAttachment` had cases for `mesh`, `camera` and `none` and **not
for `light`**. The projector recorded the attachment on the mirror node;
`backend.attachLight` was never called. The light existed on the backend,
unparented — with **no position and no direction**, because a `LightDescriptor`
deliberately carries neither (C3).

Nothing caught it because the existing tests asserted at the wrong level:
`attachmentOf` reads the **mirror**, and the conformance suite calls
`attachLight` **directly**. Nothing asserted the one step between them.

This is what [IF-003 §6](./IMPLEMENTATION_FINDING_IF-003.md) said would happen —
*"every lighting claim in ADR-013 amendment 1 is a headless assertion about
descriptors and handles"* — and it surfaced the first time a light was created
through a **document**, by the toolbox test.

The regression test is in `hybrid.test.ts`, at the level the bug lived at:

> *reaches the BACKEND, not just the mirror's record of it* — asserts on
> `backend.snapshot()` and checks the light carries the node's world matrix,
> which only an **attached** light has at all.

### 7.4 `pending` canonicalized the whole document on every render

Found by the benchmark, not by a test — `pending` cost more than three quarters
of a whole Take. Cached on document object identity (`WeakMap`), which is exact
because documents are immutable. **~10,800× faster.**

Guarded by an assertion that the cache cannot go stale: three rounds of
edit → `pending` true → undo → `pending` false. A cache keyed on anything weaker
than identity fails it.

*This is the third time a benchmark at realistic size has found a cost structural
tests could not see*, after the workbench's `diagnostics()` and the Studio bench's
own NaN. Benchmarking at demo size hides O(scene) costs — the rule keeps holding.

### 7.5 The shell never re-read the engine

**Found by the browser, and invisible to all 125 headless tests.**

The scene view drives a `requestAnimationFrame` loop that renders the engine to
its canvas. Nothing ever told **React** the engine had moved. Runtime changes — a
seek, a cue, a live variable — are not document edits, so they never reach
`store.subscribe`, which is the only thing the shell listened to.

The result: the frame counter, the timeline playhead, and the live variable
column were each correct **once** and then frozen. Every panel individually
right, collectively stale. This was true since Phase 1 and could not be seen
headlessly, because a headless test reads the session directly rather than the
DOM rendered from it.

Caught by *"a runtime override is not a document edit"* — the reset button never
appeared, because `isOverridden` was never re-read.

Fixed with two mechanisms, because there are two questions:

- `StudioSession.subscribe` fires on discrete runtime changes (seek, play,
  pause, cue, override, reset, open).
- While the clock is **running** there is no discrete event, so the shell ticks
  React per animation frame — **and only while playing.** An unconditional loop
  would re-render an idle editor 60×/s for nothing.

### 7.6 Every recorded keyframe landed at time zero

**Also found by the browser.** The timeline editor's playhead was
`clipState?.seconds ?? 0`, and a clip has no state until it is **cued**. So a
designer who scrubbed to 1.5 s and keyed a property got a keyframe at 0 — and
keying again at a different position silently replaced it, because
insert-or-replace-by-time is correct and both keys were at time 0.

The whole recording gesture produced exactly one keyframe, forever.

Caught by *"keying a property creates a track, and the drag is undoable"*, which
scrubs the lane between two keys and expects **two** keyframes. Fixed by falling
back to `session.frame / rate` — the engine's own clock, since scrubbing seeks it
to exactly `seconds × rate`. Both branches derive from one clock and Studio still
owns none.

This is the sharpest example of why the browser layer exists. `setKeyframe` was
correct, thoroughly tested, and had no bug. The *caller* passed it 0.

### And one pre-existing failure fixed on the way

`tools/boundaries.test.ts` had been **red since the T1 text spike landed**:
`engine-text/src/index.ts` declared `layer: "engine-text"`, which is not a layer.
`tools/engine-layers.mjs` is the single source of truth and says `engine-core`.
One line. A guardrail that is red by default is a guardrail nobody reads.

---

## 8. In a browser

Ten tests, Chromium on ANGLE/SwiftShader, against a real WebGL backend.
`apps/studio/e2e/` had been an empty directory with a config since Phase 1.

| Claim | Ends on |
| --- | --- |
| Boots and reports engine state | The status bar's node count — so the session constructed and a frame rendered, not that React mounted |
| **All nine toolbox entries create a node the engine accepts** | History depth +9, no error overlay, 11 outline rows |
| Keying creates a track; the undo works | Two keyframes after scrubbing between keys, then one after ⌘Z |
| Selecting a keyframe enables copy and delete | "1 keyframes", copy enabled, and deleting the last one removes the **track** |
| **A preset compiles to a timeline that plays** | Two keyframes in the ordinary timeline editor, then the frame counter — read from the runtime clock — leaves `f0` |
| A preset offers nothing the engine can't draw | The preset **buttons**, not the panel text, which deliberately explains the absence |
| Aligning already-aligned nodes is a no-op; grouping is one step | History depth unchanged, then +1 |
| **Take puts a graphic on air; a later Preview edit does not** | Tally `OFF` → `ON AIR`; a Preview edit flips the pending message and leaves the tally alone |
| A runtime override is not a document edit | History depth **unchanged**, reset button visible — RFC-002 §4.3 executing |
| A template declares a parameter per variable | "1 parameters", then drift reported when a variable is added |

---

## 9. What is still not verified

Stated rather than implied.

| | Why |
| --- | --- |
| Lights on **screen** | §7.3 fixed the attachment and asserts it reaches the backend. Whether a directional light visibly illuminates a face pointing at it is **still** unverified, and still waits on the 3D viewport (IF-003 §6) |
| The `disc` primitive's pixels | Its geometry is asserted through the toolbox tests (a mesh attaches, in both a mock and a real backend); nobody has looked at a circle |
| Keyframe **dragging** by pointer | The drag handler is exercised by the headless `moveKeyframes` tests and by a click-select in the browser, but no test drags a keyframe across a lane |
| Text, images, SVG | Not built. IF-003 |
| Multi-user / concurrent editing | Out of scope; `actorId` is carried on every transaction so it stays possible |
| Storage quota behaviour | The library degrades silently on a full store by design; only the corrupt-**read** path is asserted |
