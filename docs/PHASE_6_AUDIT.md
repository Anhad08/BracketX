# Phase 6 Audit — Time & Animation

**Date:** 2026-08-02 · **Requested by:** CTO, before Studio
**Question:** was ROADMAP_V2 Phase 6 delivered, merged, removed, or skipped?
**Method:** verified against `ROADMAP_V2.md`, `ROADMAP.md`, `SCENE_FORMAT.md`, the
git history, and the implemented code. Nothing below is inferred from a commit
message alone.

---

## Verdict

**Phase 6 was neither merged nor removed. It was implemented under the wrong
number, and three of its five requirement lines were never delivered.**

The number gap is harmless. What the number gap *hid* is not.

**Status: INCOMPLETE.** Two of the gaps are ordinary work. One — the timeline
model — invalidates a downstream estimate and needs a decision before Phase 9,
not after.

**Directly answering the concern raised:** Phase 6 contained no asset pipeline
and no persistence. Assets are Phase 1 (complete, `SceneDocument.assets`,
content-addressed GPU resources in ENGINE_RUNTIME §4.4); persistence is Phase 0.
Neither is at risk. The foundation under Studio is sound. What is missing is
animation *expressiveness* and a sequencing substrate — real, but not
foundational in the way feared.

---

## 1. Why the number gap exists

Two roadmaps with different numbering were both live.

| | `ROADMAP.md` (original) | `ROADMAP_V2.md` (current) |
| --- | --- | --- |
| Phase 5 | **Animation Engine** | Authoring Surface — *APPLICATION* |
| Phase 6 | Live Production | **Time & Animation** — *ENGINE* |
| Phase 7 | Graphics Components | Live Control |

The commits mix the two schemes, and the switch happens **between two adjacent
commits**:

```
1436938  feat(host):   Phase 3 A1 — Output abstraction      ← V2 numbering
a8275a9  feat(engine): Phase 4 A2/A3 — collections           ← V2 numbering
beb1f75  feat(engine): Phase 4 A4/A5/A6/A8 — composition     ← V2 numbering
6ec5f29  feat(engine): Phase 5 — animation                   ← OLD numbering  ⚠
d473e6e  perf(animation): sort keyframes at load
6b4338d  feat(engine): Phase 7 — Live Control                ← V2 numbering
```

`6ec5f29` is Phase 6 work wearing Phase 5's label. **ROADMAP_V2 Phase 5
(Authoring Surface) is genuinely not started** — correctly, since it is the
application layer Studio will be.

So the sequence is `V2:3 → V2:4 → V2:6(mislabelled 5) → V2:7`. Nothing was
skipped in the ordering. The damage is that the work was checked against **old
Phase 5's exit criteria**, which are weaker than V2 Phase 6's, and the difference
is exactly what is missing.

---

## 2. Requirement-by-requirement

ROADMAP_V2 §Phase 6 has five lines. Each is checked below against code, not
against the commit message.

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| **R1** | One timeline model — ordered addressable positions with typed events; animation and Phase 9 sequencing are two readers of it | ❌ **Not built** | §3.1 |
| **R2** | Property interpolation, easing, **duration/delay/stagger** | ⚠️ **Partial** — no delay, no stagger | §3.2 |
| **R3** | Named states with **declared transitions**; no privileged names | ⚠️ **Partial** — names ✅, transitions ❌ | §3.3 |
| **R4** | Deterministic playback; **late-join settles to a correct state** | ⚠️ determinism ✅ Proven, late-join **Derived, untested** | §3.4 |
| **R5** | Exit: a scene using state names other than in/idle/out animates correctly | ✅ **Met** | §3.5 |

### Solidly delivered, and it is substantial

Interpolation for numbers/vectors/sRGB colours · 20 named easings plus
deterministic fixed-iteration cubic-bezier · multi-track clips · looping ·
reverse · seeking · scrubbing · animation events on a half-open interval ·
hold-on-completion vs revert-on-stop · O(animated nodes) projection cost ·
44 tests including replay-identical, seek-equals-play, and no-drift-over-two-loops.

The stateless-sampling architecture is right and is the reason most of the hard
cases are free. **This audit is not a criticism of what was built.** It is about
what the label caused nobody to look for.

---

## 3. The gaps, verified

### 3.1 G1 — There is no timeline model *(most expensive)*

ROADMAP_V2 is explicit: *"ordered addressable positions with typed events.
Animation and Phase 9 sequencing are two readers of it, **not two timelines**."*

What exists is a **clip sampler**:

```ts
export interface AnimationClip {
  readonly id: string;
  readonly name: string;
  readonly duration: number;      // seconds
  readonly loop?: boolean;
  readonly tracks: readonly AnimationTrack[];   // target: node id
  readonly events?: readonly AnimationEvent[];  // payload?: unknown  ← untyped
}
```

There are no addressable positions, no cues, no typed events — `payload` is
`unknown`. Nothing here is a substrate a second reader could sit on.

**The consequence is a false estimate already written into the roadmap.**
ROADMAP_V2 Phase 9 says:

> **4–6 weeks** (down from 6–8 — the timeline already exists from Phase 6)

It does not exist. Phase 9 currently carries a two-week discount against work
that was never done, and would discover it in week one.

**This is the one gap that needs a decision rather than an implementation.**
Either R1 is real — in which case a timeline model is designed now, before
Studio builds a UI against a clip-shaped API that will change — or R1 is
withdrawn and Phase 9's estimate is corrected back to 6–8 weeks. Both are
defensible. Choosing neither is what actually costs money.

### 3.2 G2 — `delay` and `stagger` do not exist

```
$ grep -rn "stagger" packages/ apps/ docs/
docs/ROADMAP.md:508     - Timing: duration, delay, stagger across children
docs/ROADMAP_V2.md:84   - Property interpolation, easing, duration/delay/stagger.
```

Two hits in the entire repository, both of them the requirement itself. No
`delay` field on a clip or a track either.

**Why this matters more than it sounds.** A staggered reveal — rows appearing
0.05s apart — is the single most common broadcast animation there is. Without
it, the only way to stagger sixteen leaderboard rows is sixteen clips with
hand-offset keyframes. And collection instances are **data-driven**: their ids
(`nod_entry#t8`) do not exist until the collection resolves, so clips cannot be
authored against them at all. A staggered reveal over a live collection is
currently **not expressible**.

Phase 10 (Content Packs) is explicitly forbidden from writing engine code and
must report gaps instead of patching them. This is a gap it will hit on its
first pack.

### 3.3 G3 — States are named, but transitions are not declared

Half of R3 is done well. `NodeStateOverride`, the `state.set`/`state.add`/
`state.remove` commands, and the showcase `states` scene ("Four states the
engine assigns no meaning to") deliver author-defined names with nothing
privileged. R5 passes because of this work.

The other half is absent. A state change is an **instantaneous swap**. Nothing
declares that going from `warning` to `success` takes 400ms on `easeOutQuint`.
Searching for a transition concept in engine-scene or engine-host returns only
the runtime's unrelated lifecycle state machine.

So states *cut*. They do not *animate*. For a broadcast product that is the
difference the roadmap called out in old Phase 5: *"a lower-third that pops in
without animation reads as amateur."*

### 3.4 G4 — `SCENE_FORMAT §10` and the implementation describe different models

The frozen format document specifies **state-bound** animation:

```json
"states":  [{ "id": "st_in", "name": "In", "duration": 600 }],
"animation": { "tracks": [{ "stateId": "st_in", "property": "...", "keyframes": [{ "t": 0 }] }] }
```

— per-node tracks, bound to a state by `stateId`, `t` in **milliseconds from the
state's start**, because "states are independently cued on air".

What was built is **document-level clips**: `animations: AnimationClip[]`,
`target` node ids, `time` in **seconds**, no `stateId`, no linkage to `states`
at all.

The fossil is still in the tree. `SceneDocument.states: SceneState[]` — the
format's `{id, name, duration, loop}` — is declared, validated, and **read by
nothing**. `validate.ts` builds the id set and then discards it:

```ts
const stateIds = new Set((document.states ?? []).map((s) => s.id));
// … 116 lines later …
void stateIds;                                    // ← the linkage never built
```

`SCENE_FORMAT` open item **F3** — *"whether `states` are fixed (in/idle/out) or
author-defined; **gates the Phase 6 control surface**"* — is still marked open,
due Phase 2. It was in fact answered by the Phase 4 states work (author-defined),
and nobody closed it.

This is not a correctness bug: the implemented model works and is tested. It is a
**specification divergence** that will mislead the next person to read
SCENE_FORMAT — including Studio, which will read §10 to build a timeline UI.

### 3.5 G5 — Late-join is argued, not tested

The architectural case is strong and stated in `animator.ts`: sampling is a pure
function of `(clip, time)` with `time = (frame − startFrame) / rate`, so a
session joining at frame 4,000 is correct on its first sample with no settle.

But old Phase 5 exit criterion 5 and ROADMAP_V2 R4 both name it, and no test
asserts it. The closest is *"seeking reaches the same value as playing there"*,
which is adjacent but not the same claim.

**Derived, not Proven.** This is a twenty-line test, not a redesign.

---

## 4. Process finding

Phases 2.3, 2.4, 2.5 and 2.6 each shipped an implementation report and a
verification document. **Phases 3 A1, 4, 6(animation) and 7 shipped none.** The
gap begins exactly where Project Alpha handed over to fast sequential delivery.

Every defect in §3 would have been caught by writing "here is each roadmap
requirement and here is the test that proves it" — which is precisely what those
documents forced. The Showcase and Workbench phases reinstated the habit; the
four engine phases between did not have it.

**Recommendation:** a phase does not close without a requirement-to-evidence
table. Not a heavyweight document — a table.

---

## 5. What I recommend, and what it costs

Phase 6 is **incomplete**, so by the standing instruction implementation stops
until it is closed. Sizing, in dependency order:

| | Work | Size | Blocks Studio? |
| --- | --- | --- | --- |
| **G5** | Late-join test | ~1 hour | No — but do it first, it is free |
| **G4** | Reconcile `SCENE_FORMAT §10` with the implemented model; close F3; delete `SceneState` or wire it | ~half a day | **Yes** — Studio will read §10 to build its timeline UI |
| **G2** | `delay` on a track, and stagger over a repeat's instances | ~3–5 days | **Yes** — Studio's timeline should not be designed before the timing model it edits is final |
| **G3** | Declared state transitions (duration + easing per state pair, or per state) | ~4–6 days | **Yes** — same reason |
| **G1** | Timeline model — **decide before building** | decision now; 1–2 weeks if adopted | **Yes**, for the API shape Studio binds to |

**≈ 2–3 weeks** to close G2–G5, plus the G1 decision. Against a 6–8 week original
estimate for a phase that delivered perhaps 60% of its scope, that is consistent.

**On G1 specifically, my recommendation:** build the timeline model now, before
Studio. Not because Phase 9 needs it soon, but because Studio's timeline UI is
the single largest thing that will bind to this API, and rebuilding a shipped
editor's timeline against a different substrate is the most expensive version of
this mistake. If the answer is instead "clips are enough, sequencing gets its
own timeline", then ROADMAP_V2 must say so and Phase 9 goes back to 6–8 weeks —
because two timelines is precisely what R1 was written to prevent.

I have **not** started any of this. `ROADMAP_V2.md` has been corrected to record
the true status (§Completed table and the Phase 5/6/9 entries) so the roadmap
stops asserting something that is not true, but no engine code has changed.
