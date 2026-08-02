# Engineering Workbench — Critical Review

**Date:** 2026-08-02 · **Subject:** `apps/showcase` as BracketX's primary engineering environment
**Companions:** [IMPLEMENTATION_REPORT_WORKBENCH_V3.md](./IMPLEMENTATION_REPORT_WORKBENCH_V3.md) ·
[ENGINE_WORKBENCH_VERIFICATION.md](./ENGINE_WORKBENCH_VERIFICATION.md)

The brief: assume twenty engineers use this every day for ten years. Find every
weakness. Do not stop at visual polish.

**Verdict: the V2 workbench was a good demo and a poor tool.** Every panel was
correct. Almost none of them answered the question an engineer actually arrives
with, and three of the six were quietly O(scene) on a ten-times-a-second timer —
which means the tool would have become the load on exactly the scenes worth
investigating.

Six defects below are load-bearing. Two of them are bugs the tool had, not
opinions about it.

---

## 1. The finding that matters most: the tool violated its own scalability rule

The requirement is that the workbench "stay usable with scenes containing
hundreds of thousands of nodes". V2 was benchmarked against a thirty-five-node
scene, where nothing is measurable and nothing is learned.

Benchmarked at 4,000 rows, against a **0.0016 ms** frame:

| Sampled read, ten times a second | V2 cost | What it was doing |
| --- | --- | --- |
| `diagnostics()` | **5.17 ms** | `Runtime.stateHash` canonicalises and hashes all runtime state — on every sample |
| `diagnostics({hashes})` | **9.77 ms** | the above, plus a second full canonicalisation |
| node count | 0.0089 ms | materialising an array of every node id to read `.length` |
| inspector tree | 0.911 ms | flattening the entire mirror, then hiding rows in the component |
| debug boxes | 0.516 ms | walking the entire document, then drawing every rectangle |

`diagnostics()` alone was **3,200× the frame it described**, and it ran whether
or not anyone was looking at the number it produced. At 100,000 nodes it would
have been a stall.

The reason all four were invisible: `mirror.size` exists and is O(1), the log
already holds what the panel recomputed, and the showcase scenes are small. None
of it is subtle. It survived because *correctness* tests passed and nobody
measured at scale — the exact failure mode P-001 documented in the engine and
which had been allowed to reappear in the tool that watches the engine.

**Fixed.** Every function in `tools/model.ts` is now labelled `SAMPLED` or
`INVOKED`, and the rule is stated in the file: sampled reads are O(visible),
never O(scene). Post-fix numbers are in [§ Overhead](#8-overhead-after) and the
verification document.

---

## 2. Passive numbers. "Dirty nodes: 42" is not a diagnostic

V2 displayed metrics. An engineer reading `Runtime 4.6 ms` has to answer
"compared to what?" themselves, and `Dirty nodes: 42` has no answer at all
without opening two more panels.

Three things were missing, and all three are now present:

**A baseline to compare against.** Capture one (`B`), change something, and the
performance table shows `+25%` per phase. Regressions are declared on **p95**,
not the mean, because the mean hides the frames that drop — p95 is the frame
somebody will send you a video of.

**Attribution.** Every command's projection is now recorded, so the console can
say *"42 of 45 dirty nodes from `collection.patch` on `entries`, sent by `feed`,
across 6 commands"*. This needed no engine change: a command that projected
leaves a new `lastReport` object behind it, so comparing identity across
`applyLive` attributes the projection exactly, and a command that did not
project is correctly attributed nothing.

**A findings panel that states conclusions.** Ten rules, each a pure function of
a snapshot, each printing the evidence it rests on:

> Runtime is +25% vs baseline "main" — p95 4.83 now, 3.86 at capture (frame 1,204, 300 samples).
> Output `preview` missed 12 frames — no camera resolved. A missed frame is black on air, not a dropped frame.
> Mirror grew 300 nodes in 10s — 100 → 400 with no scene change. A mirror that only grows is a lifetime bug.

Deliberately **no anomaly model, no learned thresholds, no "unusual activity
detected"**. Every finding above can be derived by hand from the numbers it
prints, which is what makes it possible to disagree with one. A diagnostic
nobody can argue with is a diagnostic nobody can trust.

---

## 3. The inspector answered "what" and never "where did this come from"

V2's detail pane listed a node's variables and their values. For a collection
instance — the nodes that are *hardest* to reason about and the reason the
inspector reads the mirror at all — it printed `item: undefined`, every time,
because the engine records the scope name as the dependency and the scope itself
is transient.

An inspector that renders `undefined` for the interesting case teaches an
engineer to distrust the whole panel.

The detail pane is now organised around one question. Each section answers it for
a different kind of value:

| Section | Answers |
| --- | --- |
| Values read | variable / **scope** / token / unresolved, the resolved value, and the last command that wrote it — with its source and frame |
| Animation | which clips target this node, which path, and which are *driving* right now |
| Position | "placed by *Table* (vertical, gap 0.12) — its own transform position is overridden" |
| States | declared overrides, with the active ones marked |
| Camera for | outputs this node renders |
| Breadcrumbs | the mirror's own ancestor chain, each one clickable |

The scope resolution is the one place the workbench **derives** rather than
reads, and it is labelled as such in the code and in the verification document.
The engine's scopes are one-per-instance-per-projection and retaining them so a
tool could read them is memory the engine should not spend. The derivation is the
documented keyed-identity rule and nothing more, and a test asserts the resolved
row against the collection the instance actually renders.

---

## 4. Discoverability: twelve scenes and eight tools, and no way in

V2 had a sidebar and tab strip. Nothing else. Finding a node meant scrolling a
tree; switching scenes meant reading a list; there were no shortcuts, so nothing
could be learned by muscle memory and nothing could be done without a mouse.

The single highest-value addition in V3 is the **command palette** — one chord
reaches every scene, every tool, and every action, ranked by what you typed. It
is also the discoverability mechanism: a workbench with this much surface has
more than anyone will read documentation for, and a palette turns that surface
into something you find by guessing at it.

Matching is subsequence with position bonuses, not `includes()`. `neb` finds
`nod_entry_background`; substring search returns nothing and the engineer goes
back to scrolling, which is the friction the whole feature exists to remove.

Alongside it: **global scene-graph search** ranked rather than filtered ("the
twenty best of a hundred thousand" is a usable answer; "1,412 matches" is not),
and a keymap whose help sheet is *generated from the bindings* so it cannot lie.

An audit test asserts that **every binding has a palette entry**. An action
reachable only by an undocumented key does not exist.

---

## 5. Frame stepping was missing, and it is the difference between a report and a bug

There was no way to advance one frame. "It flickers sometimes" cannot become a
reproducible report without it.

`.` steps one frame, `,` steps back, `Shift .` steps ten. Stepping **pauses
first** — not politeness: a running loop advances between the step and the read,
and a bug inspected at "frame 412" that was actually frame 414 is a bug nobody
can reproduce. Two sessions stepped alike are asserted to reach identical session
hashes.

---

## 6. Two bugs in the tool itself

Both were found by the tool's own instrumentation, which is the outcome worth
having.

### 6.1 Replay verification cried wolf — found only in a browser

`Checkpoint` recorded a **frame**. But several commands can arrive while the
clock reads frame F, and a checkpoint can be taken before them, between them, or
after them. Replay had to guess which state the checkpoint described; it assumed
"before any of frame F's commands".

When an operator's click landed on the same frame as a checkpoint tick, the guess
was wrong and the verifier reported a **divergence that had not happened**.
Intermittently. In the one tool whose entire value is that a red result means
something — and a verifier that cries wolf is worse than none, because the next
real red is ignored.

Fixed by recording the log's sequence number alongside the frame, so a checkpoint
is a position in the command stream rather than a moment on the clock. There is
now a headless regression test that deliberately collides a command and a
checkpoint on one frame.

This is the only defect in the whole review that **required a browser to find**.
Everything else was catchable headlessly and should have been caught earlier.

### 6.2 The frame history handed out its own buffer

`samples()` returned the live internal array before the ring wrapped, so anything
holding a window watched it fill underneath. A benchmark caught it by making no
sense: two windows of very different sizes reported identical cost, because they
were the same array.

---

## 7. Subsystem review

| Subsystem | Verdict | Action |
| --- | --- | --- |
| **Navigation** | Weak — list-only, no search, no recents | Palette, scene filter, `[`/`]`, recents ordering |
| **Information architecture** | Sound. Overlays for state, tabs for investigation | Kept; findings panel added above the numbers |
| **Viewport** | Good. Checkerboard is load-bearing (alpha bugs) | Unchanged; selection/pins now highlight in the overlay |
| **Inspector** | Weakest subsystem | Rebuilt — see §1, §3 |
| **Timeline** | Displayed playback, did not explain it | Command markers on the clip's own axis; per-clip transport |
| **Diagnostics** | Numbers without conclusions | Findings panel, §2 |
| **Performance** | 240-sample mean/p95/max, no history | 1,800-frame history, p50/p90/p95/p99, MAD spike detection, baselines |
| **Replay** | Correct in principle, ambiguous in practice | §6.1 |
| **Session recording** | No export/import, no run-to-run comparison | Export, import, hold-and-compare, session snapshot diffing |
| **Command console** | Log without consequence | Per-command dirty/writes, "changed the scene" filter, churn attribution |
| **Stress dashboard** | Buttons and eyeballs | A laboratory: presets, saved configs, deterministic sweeps, a document-shape axis |
| **Output monitor** | Good | Camera column, now clickable to the node |
| **Screenshots** | Deterministic and stable | Unchanged. Comparison is still deferred — see §9 |
| **Overlays** | Correct | Selection highlight; layer state persists |
| **Scene switching** | Worked | Pins, watches, and tool survive it |
| **Keyboard** | Absent | Full keymap, generated reference, does not steal keys while typing |
| **Search** | Absent | Fuzzy, ranked, over both the graph and the palette |
| **Accessibility** | Partial | Roles on tabs and dialogs, `aria-label` on every control, visible focus ring, no colour-only state |
| **Scalability** | **Failed its own requirement** | §1 |
| **Plugin readiness** | Registry was already the right shape | Extended with build parameters; tools remain a data-driven list |

### Accessibility, specifically

Not decoration: an engineer who cannot use a tool from the keyboard is an
engineer who is slower at it, permanently.

Tabs carry `role="tablist"`/`aria-selected`; palette and help are `role="dialog"`;
every input has a label; focus is visible via `:focus-visible` rather than
suppressed; severity is carried by a border **and** a word, never colour alone;
numeric columns are tabular-figures so they can be compared by eye.

**Not done:** full focus trapping in the palette, and a screen-reader pass. Both
are real and both are honestly open — see §9.

---

## 8. Overhead, after

Everything below is measured against a **0.0016 ms** frame on a 4,000-row scene.

| Sampled read (10 Hz) | V2 | V3 | Change |
| --- | --- | --- | --- |
| `diagnostics()` | 5.17 ms | **0.0004 ms** | 12,900× |
| node count | 0.0089 ms | 0.0001 ms | 89× |
| inspector tree, collapsed | 0.911 ms | 0.0009 ms | 1,012× |
| inspector tree, expanded, capped at 400 | 0.911 ms | 0.108 ms | 8.4× |
| debug boxes | 0.516 ms | 0.057 ms | 9× |
| output rows / timeline / watch | — | 0.0002–0.0005 ms | — |

| Findings (2 Hz) | Cost |
| --- | --- |
| End to end | **0.223 ms** — 0.045% of a core |

The most expensive thing the workbench now does on a timer costs **0.045% CPU**.
The dominant term is summarising 300 frames across six fields (0.146 ms), which
is why findings sample at 2 Hz rather than 10 — and the better reason is that a
finding that appears and vanishes five times a second is a finding nobody reads.
Numbers move fast; conclusions should not.

---

## 9. Deliberately not built

The brief listed features. Building all of them mechanically would have produced
a worse tool, so these were rejected with reasons.

| Rejected | Why |
| --- | --- |
| **Dockable / detachable panels** | Weeks of layout state for a problem the keyboard already solves. Two browser windows on the same `#/scene` URL is free and better. Revisit if anyone actually asks. |
| **Subsystem flame graphs** | The engine emits four timing buckets. A flame graph of four bars is a decorated bar chart. It would become right the day the engine emits a call tree — and not before. |
| **Allocation tracking** | No public API exposes it. `performance.memory` is Chrome-only, quantised, and process-wide. A memory panel that cannot distinguish the engine from React would be a lie with a chart on it. The mirror-growth rule catches the leak class that matters. |
| **Per-node dirty heatmap** | The projector's `DirtySet` is created and discarded per projection. Exposing node-level dirt means the engine retains state past the frame that consumed it — memory spent for a tool. The question ("what caused this churn") is answered *better* by command attribution, which is cheaper and names a cause rather than a location. |
| **Dependency graph visualisation** | A force-directed graph of 4,000 nodes is a hairball. The reverse index already answers the real question — "if I change this, what redraws" — as a number, and the watch window shows the readers as a clickable list. |
| **Anomaly detection** | Every rule must be arguable. A model that says "unusual" without saying why cannot be disagreed with, and a diagnostic nobody can disagree with is one nobody can trust. |
| **Inspector editing** | Unchanged from V2: an inspector that writes is the beginning of the editor, and this is not that application. |
| **GPU timing** | Still not visible from this side of the backend boundary. `RENDER_BACKEND_VERIFICATION §7` holds; the panel says so on screen rather than implying its render bar is GPU time. |
| **Visual regression comparison** | Producing stable bytes and deciding whether two sets of bytes are acceptably similar are different problems. Still deferred, still deliberate. |

---

## 10. What is still weak

Honest, and none of it was hidden.

1. **Search is O(scene) per keystroke.** 3.58 ms at 4,000 nodes; at 100,000 it
   will be ~90 ms and will need debouncing or an index. Acceptable today because
   a human pressed a key; not acceptable forever. Not built now because building
   an index for a cost nobody has hit is speculative optimisation.
2. **No focus trap in the palette.** Escape closes it and the input takes focus
   on open, but Tab escapes the dialog.
3. **No screen-reader pass.** Roles and labels are present and untested by
   anyone using one.
4. **The stress laboratory's depth axis rebuilds the document.** Correct — depth
   is document shape and no command may change it — but it means a depth sweep
   cannot run inside one `runSweep` call.
5. **Recordings are not versioned.** Still debugging artefacts for one build,
   not an archive format. Unchanged from V2 and still the right call.
6. **The inspector caps at 400 rows and says so.** Not virtualised. A real
   windowing implementation is warranted the first time somebody genuinely wants
   4,000 rows expanded, which has not happened.

---

## 11. Assessment

The workbench found four things while being rebuilt: a metric that was O(scene)
on a timer, an inspector that printed `undefined` for the case it exists to
explain, a replay verifier that reported false divergences, and a ring buffer
that leaked its own array. All four were in the tool. That is the right place
for a tool's bugs to be, and finding them is the argument for the tool.

The V2 report closed by saying the engine additions were all observability and
all demanded by a concrete need. V3 needed **no engine additions at all** — every
question the tools ask was already answerable through a public API, including the
one that looked like it needed a new field. That is a stronger result than
another three exports would have been.
