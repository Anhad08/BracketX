# Engineering Workbench V3 — Implementation Report

**Date:** 2026-08-02 · **App:** `apps/showcase`
**Companions:** [ENGINE_WORKBENCH_REVIEW.md](./ENGINE_WORKBENCH_REVIEW.md) ·
[ENGINE_WORKBENCH_VERIFICATION.md](./ENGINE_WORKBENCH_VERIFICATION.md)

The showcase is no longer a showcase. It is the environment an engineer working
on BracketX should be in more than they are in a debugger.

---

## 1. What changed, in one table

| | V2 | V3 |
| --- | --- | --- |
| Tools | 6 | 8 (+ Performance, Watch; Frame folded into Performance) |
| Always-on panels | numbers | **findings**, then numbers |
| Navigation | sidebar | palette, fuzzy scene-graph search, full keymap |
| Inspector | tree + values | scene explorer: lazy tree, breadcrumbs, value origins, contributors |
| Performance | 240-sample mean/p95/max | 1,800-frame history, p50–p99, MAD spikes, baselines, regressions |
| Recorder | record, replay, verify | + export, import, run-vs-run diff, session snapshot diff |
| Stress | buttons | laboratory: presets, saved configs, deterministic sweeps, document-shape axis |
| Transport | none | frame stepping, deterministic |
| Workspace | 5 booleans | tool, pins, watches, layers, panel size, recents, saved configs |
| Headless tests | 196 | **284** |
| Browser tests | 15 | **29** |
| Engine changes | 3 (observability) | **0** |

---

## 2. Zero engine changes, and why that is the result

V2 added three engine fields, each demanded by a tool. V3 needed none — and two
of the three things that looked like they needed one turned out to be answerable
already.

**Command attribution** looked like it needed `ProjectionReport` on
`LiveCommandRecord`. It does not: a command that projected leaves a **new**
`lastReport` object behind it, so comparing identity across `applyLive`
attributes the projection exactly, and a command that did not project leaves the
previous report in place and is correctly attributed nothing.

```ts
const before = this.host.lastReport;
const result = this.host.applyLive(command, source);
const after = this.host.lastReport;
if (result.accepted && after !== null && after !== before) { /* attribute */ }
```

**An O(1) node count** looked like it needed a `SceneHost.nodeCount`. `MirrorGraph.size`
has been public and O(1) the whole time; the workbench was materialising an array
of every id to read `.length`.

The one thing genuinely not available — per-node dirty sets — was **rejected**
rather than added. The projector's `DirtySet` is created and discarded per
projection; retaining it means the engine holds state past the frame that
consumed it, for a tool. And the question it would answer ("what caused this
churn") is answered better by attribution, which names a *cause* rather than a
*location*.

An API that survives a demanding consumer without changing is a better result
than an API that grows to meet one.

---

## 3. The scalability rebuild

V2 was benchmarked at 35 nodes. The requirement is 100,000. At 4,000 rows, three
of its sampled reads were O(scene) on a 10 Hz timer, and `diagnostics()` cost
**5.17 ms against a 0.0016 ms frame** — 3,200× the thing it described.

### 3.1 The rule, written into the code

`tools/model.ts` now labels every exported function:

> **SAMPLED** — called on the 10 Hz tick while a tool is open. Must be
> O(visible) or O(1). Never O(scene).
> **INVOKED** — called when a human does something. May be O(scene); a human
> typing tolerates a few milliseconds and cannot tell.

Search is INVOKED and stays a full scan. The tree is SAMPLED and descends only
into expanded nodes, so a collapsed 100,000-node collection costs **one row** —
asserted by test, not only by benchmark.

### 3.2 The root cause worth remembering

`Runtime.stateHash` is a **getter** that canonicalises and hashes all runtime
state on every access, and `host.session()` reads it. Nothing in the type system
says so; it looks like a field. `diagnostics()` now reads frame, clock status,
states and clips directly from the objects that hold them and never constructs a
snapshot. Both hashes are opt-in.

### 3.3 A cached document index

Every tool needed "the authored node behind this mirror id". V2 answered it with
a recursive document search *per selection* and a full id map *per sample*.

`SceneIndex` builds it once and caches against the **document object**. Engine
documents are immutable — `apply()` returns a new one — so object identity is an
exact version stamp: no invalidation logic, no staleness, and a `WeakMap` collects
the old one. The cost moves from O(n) per sample to O(n) per document change,
which is the trade, stated.

It walks iteratively. R-001 logged the engine's own traversal-depth ceiling; a
debugging tool that stack-overflows on the document it is meant to explain fails
exactly when it is needed. Proven at 20,001 levels.

---

## 4. Findings, not numbers

Ten rules in `tools/alerts.ts`. Each is a pure function of a snapshot, so each is
asserted headlessly — and each prints the evidence it rests on, because a
diagnostic nobody can disagree with is one nobody can trust.

```
Runtime is +25% vs baseline "main"
  p95 4.83 now, 3.86 at capture (frame 1,204, 300 samples).

Scene churn originates from collection.patch (feed)
  42 of 45 dirty nodes (93%) across 6 commands, 84 backend writes.

Mirror grew 300 nodes in 10s
  100 → 400 with no scene change. A mirror that only grows is a lifetime bug;
  MirrorBackend contract C2 puts that on the reconciler.
```

Every alert carries an action — open this tool, select this node, watch this
variable — which is why the shell owns selection rather than the inspector. An
alert that can say "go here" is the difference between a finding and a fix.

**No anomaly model.** No learned thresholds, no "unusual activity detected".
Everything above is derivable by hand from the numbers it prints.

Findings sample at **2 Hz** while numbers sample at 10. Partly cost (0.223 ms
against 0.0004 ms for `diagnostics()`), mostly judgement: a finding that appears
and vanishes five times a second is a finding nobody reads. Numbers move fast;
conclusions should not.

---

## 5. The inspector as a scene explorer

The pane is organised around one question — *where did this come from* — rather
than around the shape of the data structures.

**The defect it fixes:** V2 printed `item: undefined` for every collection
instance, because the engine records the *scope name* as the dependency and the
scope itself is transient. Those are precisely the nodes hardest to reason about
and the reason the inspector reads the mirror at all.

V3 resolves it and says how:

> `item` **scope** → `{id, name, score, color}`
> row `t8` of `standings` · collection.patch from feed @ f4102

This is the **one** place the workbench derives rather than reads, and it is
labelled as such in the code and in the verification document. The engine's
scopes are one per instance per projection; retaining them so a tool could read
them is memory the engine should not spend. The derivation is the documented
keyed-identity rule, implemented once, and a test asserts the resolved row
against the collection the instance actually renders.

Also new: breadcrumbs from the mirror's own ancestors, animation contributors
with a *driving* flag, "placed by *Table* (vertical, gap 0.12) — its own
transform position is overridden", declared states with the active ones marked,
outputs this node is the camera for, and pins that survive a scene switch.

---

## 6. Discoverability

The highest-value single addition. One chord reaches every scene, every tool,
and every action.

Matching is subsequence with position bonuses — consecutive runs beat scattered
characters, word boundaries beat mid-word, shorter wins ties. `neb` finds
`nod_entry_background`; `includes()` returns nothing and the engineer goes back
to scrolling, which is the friction the feature exists to remove.

The keymap is data, and the help sheet is generated from it, so it cannot lie.
An audit test asserts **every binding has a palette entry** — an action reachable
only by an undocumented key does not exist. Shortcuts are Proven not to fire
while a text field has focus, because a workbench where typing `s` in a filter
takes a screenshot is one people stop typing in.

Chords follow tools engineers already have in their fingers: `⌘K` palette, `⌘F`
find, `.`/`,` frame stepping, space transport, `1`–`8` tools. Inventing a novel
scheme would cost every new engineer a week of misfires for nothing.

---

## 7. The stress laboratory

A dashboard shows. A laboratory answers.

`runSweep` steps frames **by hand at fixed wall times** rather than by
`requestAnimationFrame`, so a sweep produces the same frame sequence on a loaded
machine as an idle one. The absolute milliseconds still depend on hardware —
nothing fixes that — but the *work* is identical, which is what makes two runs
comparable. It warms up before measuring, because folding a one-off mirror
rebuild into a steady-state p95 reports a cliff that does not exist.

The axes split on a principle, not on convenience:

- **Runtime axes** — collection size, clips, outputs, command rate, playback
  speed and direction — are expressible as commands, so the laboratory drives
  them through the same command path everything else uses. A stress run is as
  replayable as a show.
- **Document axes** — node count, hierarchy depth — are scene *shape*. No
  command can change them, and inventing one would be a command that edits the
  document: precisely the RFC-002 §4.3 boundary the engine is built on. Those go
  through a rebuild with declared parameters, via the same `SceneHost.load` a
  scene switch uses.

Applying a configuration twice is Proven to be a no-op, by session hash — a
config must be a function of the target state, not an accumulation. Rows are
deterministic, because a stress run whose input is random cannot be compared to
the run before it.

---

## 8. Two bugs in the tool

### 8.1 The replay verifier cried wolf

`Checkpoint` recorded a frame. Several commands can arrive while the clock reads
frame F, so a checkpoint could sit before, between, or after them — and replay
guessed "before". When a click landed on the same frame as a checkpoint tick, the
verifier reported a **divergence that had not happened**, intermittently, in the
one tool whose entire value is that red means something.

Fixed by recording the log's sequence number: a checkpoint is now a position in
the command stream, not a moment on the clock. Replay compares before a frame's
commands, after each one, and after the step, and matches on `(frame, sequence)`.

The only defect in this whole rebuild that **required a browser to find**.

### 8.2 The frame history handed out its own buffer

`samples()` returned the live internal array before the ring wrapped, so anything
holding a window watched it fill. Caught because a benchmark made no sense: two
windows of very different sizes reported identical cost, because they were the
same array.

Both previous tool bugs were caught by disbelieving a displayed number. This one
was caught by disbelieving a benchmark. Same habit.

---

## 9. Visual design

Five rules, applied rather than decorated:

1. **Readability over density, then density.** A table nobody can scan is not
   dense, it is small.
2. **Numbers are tabular and right-aligned.** A column of frame times that
   shifts as digits change cannot be compared by eye, which is the only thing a
   column of frame times is for.
3. **One accent.** Blue means "you are here". Colour otherwise means severity
   and nothing else, so a red thing is always a problem.
4. **No animation** except a single change flash. Motion in the chrome competes
   with motion in the scene being verified.
5. **The scene is the brightest thing on screen.** Every panel sits below it in
   contrast so the eye lands on the picture first.

Severity is carried by a border *and* a word, never colour alone. Focus is
visible via `:focus-visible` rather than suppressed. Tabs carry
`role="tablist"`/`aria-selected`; overlays are `role="dialog"`; every control has
a label.

---

## 10. Cost

Against a **0.0016 ms** frame at 4,000 rows:

```
diagnostics()                  0.0004 ms   10 Hz     (was 5.17 ms)
inspector tree, collapsed      0.0009 ms   10 Hz     (was 0.911 ms)
inspector tree, 400 rows       0.108  ms   10 Hz
debug boxes, capped at 500     0.057  ms   10 Hz     (was 0.516 ms)
churn attribution, 200 rows    0.046  ms   10 Hz
findings, end to end           0.223  ms    2 Hz
```

Worst case with a tool open: about **2.2 ms per second — 0.22% of one core**.
The findings *rules* cost 0.0003 ms; the 0.223 ms is almost entirely the
statistics they read, which is why the window is bounded at 300 frames.

Stated honestly: against a mock-backend frame the tool costs more per second than
the engine does. That is a statement about how cheap a mock frame is. With a real
GPU backend the frame is orders of magnitude more expensive, and a fifth of one
percent of a core is what an engineer actually pays.

---

## 11. What was deliberately not built

Dockable panels, flame graphs over four timing buckets, allocation tracking with
no API to read, a per-node dirty heatmap that would make the engine retain state
for a tool, a force-directed dependency hairball, anomaly detection nobody can
argue with, inspector editing, GPU timing that is not visible from this side of
the backend boundary, and visual regression comparison.

Each is argued in [the review, §9](./ENGINE_WORKBENCH_REVIEW.md#9-deliberately-not-built).
Building all of them mechanically would have produced a worse tool.

---

## 12. Assessment

Four defects surfaced during the rebuild and all four were in the tool: a metric
that was O(scene) on a timer, an inspector that printed `undefined` for the case
it exists to explain, a replay verifier that reported false divergences, and a
ring buffer that leaked its own array.

Three of the four were catchable headlessly and should have been caught in V2.
The reason they were not is a single habit that is now written into the code: the
tool was measured at demo size instead of at the scale it claims to support. The
benchmark file keeps the V2 shapes runnable specifically so that claim stays
falsifiable.

The engine came through a demanding consumer unchanged. That is the part worth
keeping.
