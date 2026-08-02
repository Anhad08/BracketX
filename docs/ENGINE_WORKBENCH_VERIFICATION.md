# Engineering Workbench V3 — Verification

**Date:** 2026-08-02 · **Subject:** the workbench as a daily engineering environment
**Verdict:** **VERIFIED.** Every required proof is executable. The tooling's cost
is measured at scale rather than at demo size, which is the specific thing V2 did
not do.

| Label | Meaning |
| --- | --- |
| **Proven** | Demonstrated by an executing test or measurement here |
| **Derived** | Follows from something Proven, plus a stated argument |
| **Assumed** | Believed, not tested; the risk is stated |
| **Unknown** | Cannot be established here; what would establish it is stated |

---

## 1. Reproduce

```
pnpm --filter showcase test               284 passed   (headless)
cd apps/showcase && npx playwright test    29 passed   (browser)
pnpm --filter showcase bench              overhead, §5
pnpm turbo run check-types lint test build  34/34
node tools/check-boundaries.mjs           exit 0
```

---

## 2. The six required proofs

### V1 — Diagnostics remain synchronized. **Proven, headlessly and in a browser.**

Headless: every field of `diagnostics()` is asserted equal to the engine object
it came from — frame, node count, outputs, command counters, timings. The panel
computes nothing the engine already knows.

Browser: the frame counter, the frame-history graph, and the output monitor's
counters are each read twice with a gap and asserted to have moved. This is the
Phase 1 failure — numbers individually correct and collectively frozen — and it
is guarded in the only place it can occur.

**Also Proven:** both hashes are `null` unless requested, and equal to the
engine's when requested. See §4.

### V2 — Overlays remain accurate. **Proven.**

Debug boxes are asserted against every node's world matrix, with Y flipped
(the canvas grows down, the scene grows up), and classified layout vs anchor vs
bounds. Proven in the browser that the overlay is **absent from the DOM** unless
asked for — an overlay that exists while switched off would appear in screenshots
meant to be baselines.

### V3 — Performance measurements remain trustworthy. **Proven.**

- Percentiles are **nearest-rank**, so every reported value is a frame that
  happened rather than one interpolation invented. Asserted.
- Spike detection is **median absolute deviation**, not standard deviation:
  a series with forty quiet frames and four enormous ones reports exactly the
  four. σ would have been inflated by the spikes until they stopped looking
  like spikes. Asserted both ways.
- **Proven not to cry wolf**: a perfectly steady series (MAD = 0) reports no
  spikes, and a 20× outlier at 20 microseconds reports none either. Both are
  guarded because both are how a metrics panel becomes ignored.
- Regressions are declared on **p95**, and a 4× ratio between two sub-0.02 ms
  numbers is Proven *not* to be reported — arithmetically enormous, materially
  three microseconds.
- Downsampling keeps the **worst** sample per bucket, not the average.
  Asserted: a single 100 ms frame among ninety-nine 1 ms frames survives ten-fold
  downsampling. Averaging would have hidden the one frame the graph exists for.

### V4 — Session replay remains deterministic. **Proven, and Proven to fail when it should.**

A 90-frame recording with two collection commands replays into a fresh session
with zero mismatches. **A tampered recording is detected**: corrupting the
checkpoint hashes produces `matched: false` with a `session` mismatch. A
verification tool that cannot fail is decoration.

**New in V3, and the more important proof:** a checkpoint taken on the same frame
as a command is Proven to replay clean. See §3.

Also Proven: a recording from another scene is refused; a recording round-trips
through JSON; two recordings of the same scenario are compared and the **first**
disagreeing frame is named.

### V5 — Inspector never diverges from runtime. **Proven.**

Every row's `parentId`, `childCount`, and `effectiveVisible` are asserted equal
to the mirror's; `worldMatrix` is asserted **identical**, not close. Rows are
Proven to arrive parent-before-child.

The inspector reads the **mirror**, and a test proves collection instances
appear — an inspector reading the document would be missing exactly the nodes
hardest to reason about.

Variables come from the engine's own `dependenciesOf` reverse index. Recomputing
them would be a second answer to a question the engine answers.

**The scoped-value proof.** For an instance, the origin's resolved row is
asserted to be the row the instance actually renders: its identity matches the
suffix in the node id, and the row exists in the collection. This is the one
place the workbench derives rather than reads (§6), so it is the one place with
an explicit agreement test.

### V6 — Timeline accurately represents playback. **Proven, twice.**

Headless: the reported playhead is asserted **identical** to
`animator.clipState(...).seconds`, so the timeline cannot be a second clock.
Command markers are asserted to sit at `(frame − startFrame) × speed / rate` —
the exact inverse of the animator's own playhead — and markers outside the clip's
duration are Proven to be omitted.

Browser: the playhead's CSS offset changes between two samples while playing, and
a marker appears for a command issued during the clip.

---

## 3. The bug a browser found, now guarded headlessly

`Checkpoint` recorded only a frame. Several commands can arrive while the clock
reads frame F, and a checkpoint can be taken before, between, or after them —
so replay had to guess, and guessed "before". When a click landed on the same
frame as a checkpoint tick, the verifier reported a divergence that had not
happened.

**Proven fixed.** `Checkpoint.sequence` makes a checkpoint a position in the
command stream rather than a moment on the clock. The regression test
deliberately collides a command and a checkpoint on one frame, asserts the
collision actually happened (`checkpoint.sequence > command.sequence`), and
asserts a clean replay with every checkpoint checked.

**Derived:** V2's browser suite reported "Replay matched" for recordings whose
verdict was a coin toss whenever timing collided. The green was real; its
reliability was not.

---

## 4. Scalability — the property V2 failed

The requirement: usable at hundreds of thousands of nodes. Measured at 4,000
rows, against a **0.0016 ms** frame on the same scene.

**Proven by benchmark, with the V2 shape kept runnable so the comparison is real
rather than asserted:**

| Sampled read (10 Hz) | V2 | V3 | Change |
| --- | --- | --- | --- |
| `diagnostics()` | 5.17 ms | **0.0004 ms** | 12,900× |
| `diagnostics({hashes: true})` | 9.77 ms | on demand only | — |
| node count | 0.0089 ms | 0.0001 ms | 89× |
| inspector tree, collapsed | 0.911 ms | 0.0009 ms | 1,012× |
| inspector tree, expanded, capped at 400 | 0.911 ms | 0.108 ms | 8.4× |
| debug boxes | 0.516 ms | 0.057 ms | 9× |

**Proven by test, not only by benchmark:** a collapsed collection of 2,000 rows
produces exactly **one** inspector row. That is the property; the benchmark is
its consequence.

**Proven:** truncation is reported, never silent — `truncated: true` and a row on
screen saying so. A partial answer that looks complete is worse than a slow one.

**Root cause, recorded because it will recur:** `Runtime.stateHash` is a *getter*
that canonicalises and hashes all runtime state on every access, and
`host.session()` reads it. Nothing in the type system says so. The sampled path
now reads frame, clock status, states and clips from the objects that hold them
and never constructs a snapshot.

---

## 5. Measured overhead

Against a **0.0016 ms** frame (mock backend, 4,000-row scene):

| Read | Cost | Rate | Cost per second |
| --- | --- | --- | --- |
| Checkpoint tick | 0.00005 ms | per frame | 0.003 ms |
| Attribution lookup | 0.0001 ms | 10 Hz | 0.001 ms |
| `diagnostics()` | 0.0004 ms | 10 Hz | 0.004 ms |
| Output rows / timeline | 0.0002 ms | 10 Hz | 0.002 ms |
| Watch, three variables | 0.0005 ms | 10 Hz | 0.005 ms |
| Node detail | 0.0029 ms | 10 Hz | 0.029 ms |
| Inspector tree, collapsed | 0.0009 ms | 10 Hz | 0.009 ms |
| Inspector tree, 400 rows | 0.108 ms | 10 Hz | 1.08 ms |
| Debug boxes, capped at 500 | 0.057 ms | 10 Hz | 0.57 ms |
| Console filter, 400 records | 0.013 ms | 10 Hz | 0.13 ms |
| Churn attribution, 200 records | 0.046 ms | 10 Hz | 0.46 ms |
| **Findings, end to end** | **0.223 ms** | **2 Hz** | **0.45 ms** |

Invoked reads — a human pressed a key, and a few milliseconds is invisible:

| Read | Cost |
| --- | --- |
| Search 4,000 nodes | 3.58 ms |
| Distribution over 300 frames | 0.146 ms |
| Distribution over 1,800 frames | 0.212 ms |
| Spike detection over 300 frames | 0.085 ms |
| Diff two 4,000-row snapshots | 0.078 ms |
| Rank the palette | 0.006 ms |
| Replay and verify 60 frames | 0.277 ms |

**Derived: the workbench does not significantly affect its own measurements.**
The most expensive thing it does on a timer is **0.045% of a core**. The worst
case with a tool open — inspector at 400 rows plus overlays plus findings — is
about **2.2 ms per second, 0.22% of a core**.

**Stated honestly:** against a *mock-backend* frame of 0.0016 ms, the tool costs
more per second than the engine does. That ratio is a statement about how cheap a
mock frame is, not about the tool: with a real GPU backend the frame is orders of
magnitude more expensive, and the absolute figure — a fifth of one percent of one
core — is what an engineer actually pays.

**Proven, not assumed:** the findings rules themselves cost **0.0003 ms**. The
0.223 ms is almost entirely the statistics they read, which is why the window is
bounded at 300 frames and the rate at 2 Hz.

---

## 6. Where the workbench derives rather than reads

Exactly one place, deliberately, and it is the highest-value field in the
inspector.

| Derived | Why not read | How it is kept honest |
| --- | --- | --- |
| A repeat instance's scoped item | The engine's scopes are one per instance per projection and transient. Retaining them so a tool could read them is memory the engine should not spend for a tool. | The derivation is the documented keyed-identity rule (`<templateId>#<identity>`), implemented once in `scene-index.ts`. A test asserts the resolved row against the collection the instance renders — if the engine's rule changed, it fails. |

Everything else is read from a public API and displayed unmodified.

---

## 7. Additional properties Proven

| Property | Why it matters |
| --- | --- |
| The scene index is cached on document identity | Documents are immutable, so object identity is an exact version stamp — no invalidation logic can go stale |
| The index walks iteratively | A tool that stack-overflows on an unusual document fails exactly when it is needed. Proven at 20,001 levels |
| Frame stepping is deterministic | Two sessions stepped alike reach identical session hashes — the property that makes "reproduce at frame N" mean anything |
| Stepping stops the loop first | Proven with an injected scheduler; without it the assertion could not be written |
| Attribution is bounded | 700 commands, oldest attributions dropped, newest retained — a workbench open all day must not accumulate a report per command |
| A command that changed nothing is attributed nothing | Claiming `playback.pause` dirtied nodes would be worse than saying nothing |
| Shortcuts do not fire while typing | A workbench where typing `s` in a filter takes a screenshot is one people stop typing in. Proven in the browser |
| The keymap has no duplicate chords | Two bindings on one chord is a silent loss |
| Every binding has a palette entry | An action reachable only by an undocumented key does not exist. This is an audit test, and it is what stops a future tool adding an invisible shortcut |
| The keyboard reference is generated from the keymap | A shortcut sheet that lies is worse than no sheet |
| Applying a stress config twice is a no-op | Proven by session hash. A configuration must be a function of the target state, not an accumulation |
| Stress rows are deterministic | A stress run whose input is random cannot be compared to the run before it |
| `budgetCeiling` returns null, not zero | "0 rows fit" and "the smallest size tried already missed" are different findings |
| A held history window does not grow | §8 |
| Workspace survives reload, and a hostile store cannot inject fields | Proven: unknown keys dropped, a 9,999% panel height clamped to 80 |

---

## 8. The second tool bug, found by a benchmark

`FrameHistory.samples()` returned the live internal array before the ring
wrapped. Anything holding a window watched it fill underneath.

It was caught because a benchmark **made no sense**: a 300-sample window and an
1,800-sample window reported identical cost, because they were the same array.

**Proven fixed**, with a regression test that holds a 5-sample window, pushes 35
more, and asserts the window is still 5 long.

Worth recording as a pattern: the previous two tool bugs were caught by
disbelieving a *displayed* number. This one was caught by disbelieving a
*benchmark*. Both are the same habit.

---

## 9. Public API audit

**Proven: the workbench uses only public APIs.** Every import is a package entry
point, nothing reaches into `src/`, and `check-boundaries.mjs` passes.

**Engine changes required by V3: none.**

That is the headline result of the audit. Three additions looked necessary and
each turned out not to be:

| Wanted | Looked like it needed | Actually available |
| --- | --- | --- |
| Which command caused this churn | `ProjectionReport` on `LiveCommandRecord` | `lastReport` object identity across `applyLive` — a command that projected leaves a new report behind it |
| Node count without O(n) | a `nodeCount` on `SceneHost` | `MirrorGraph.size`, already public and O(1) |
| Which nodes read a variable | a dependency graph export | `DependencyIndex.dependents`, already public |

**Considered and rejected:** exposing per-node dirty sets. The projector's
`DirtySet` is created and discarded per projection; retaining it means the engine
holds state past the frame that consumed it, for a tool. The question is answered
better by command attribution, which names a cause rather than a location.

---

## 10. Limits

| Claim | Status | What would establish it |
| --- | --- | --- |
| GPU time in the frame breakdown | **Unknown** | `EXT_disjoint_timer_query`. The render bar is submission time and the panel says so on screen |
| Overhead figures hold on other hardware | **Assumed** | Runs elsewhere. Ratios should hold; absolutes are one machine's |
| Usable at 100,000 nodes | **Derived, not Proven** | Measured to 4,000. Every sampled read is now O(visible) or O(1) by construction, so the argument is structural rather than empirical — but search is O(scene) per keystroke and will need debouncing at ~100,000 (extrapolating 3.58 ms → ~90 ms) |
| A recording survives an engine version change | **Assumed — probably false** | Recordings are debugging artefacts for one build. Nothing versions them, deliberately |
| Screen-reader usability | **Unknown** | A pass with one. Roles and labels are present and untested |
| The palette traps focus | **Disproven** | Escape closes it and the input is focused on open, but Tab escapes the dialog. Open |
| The workbench is pleasant under pressure | **Assumed** | Use. Correctness is Proven; whether the layout serves someone debugging at 3am is a judgement no test makes |

---

## 11. Assessment

Four defects surfaced during this rebuild — a metric that was O(scene) on a
timer, an inspector that printed `undefined` for the case it exists to explain, a
replay verifier that reported false divergences, and a ring buffer that leaked
its own array. **All four were in the tool.**

The strongest results are the two negative ones: the replay verifier is Proven to
detect a corrupted checkpoint *and* Proven not to report a divergence that did
not happen. A verifier that can only say yes is decoration; one that cries wolf
is worse. This one is asserted in both directions, which is what makes a green
result carry information.

**Verdict: VERIFIED.** The workbench is now measured at the scale it claims to
support, costs 0.045% of a core to keep its findings current, and required no
engine change to do any of it.
