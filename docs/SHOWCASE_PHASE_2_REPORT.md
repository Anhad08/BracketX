# Showcase Phase 2 — Engineering Workbench

**Date:** 2026-08-02 · **App:** `apps/showcase`
**Companion:** [SHOWCASE_PHASE_2_VERIFICATION.md](./SHOWCASE_PHASE_2_VERIFICATION.md)

The showcase is now the engineering cockpit. When something goes wrong in the
engine, the first move is to open a scene and a tool — not a debugger.

---

## 1. What was built

Eight tools, in two places: overlays that are always visible, and a docked
workbench with one tool at a time.

| Tool | Answers |
| --- | --- |
| **Scene Inspector** | What exists, where, why, and what feeds it |
| **Command Console** | What changed this, from where, and how long it took |
| **Timeline** | Where the playhead is, and in which direction |
| **Debug Layers** | Where the boxes actually are |
| **Frame Breakdown** | Where the frame went, over time |
| **Output Monitor** | What each surface is doing |
| **Session Recorder** | Does this reproduce? |
| **Stress Dashboard** | Where does it stop fitting in a frame? |

All data extraction lives in `tools/model.ts` and `tools/recorder.ts` as plain
functions over a `ShowcaseSession`, so every tool is verified headlessly. The
React panels render those results and compute nothing.

---

## 2. Engine API improvements

Three, all observability, none new capability. Each was needed by a tool and
added to the engine rather than worked around.

### 2.1 `LiveCommandRecord.source`

The console needed to answer "what changed this". A log that cannot attribute a
change sends someone to a debugger, which is the outcome this phase exists to
prevent.

Free-form string, not an enum: the engine must not enumerate its callers. A
fixed set would need extending for every new kind of input, which is exactly the
coupling Live Control was built to avoid. Recorded, never interpreted.

`ShowcaseSession.send` tags `"operator"`, scene-load commands tag `"scene"`, and
`SceneHost.replay` tags `"replay"` — so a replayed session is distinguishable
from a live one in its own log.

### 2.2 `LiveCommandRecord.durationMs`

Without it, a 12 ms collection rebuild and a 12 ms render are indistinguishable
in a log. Measured around the whole apply, projection included.

### 2.3 `Animator.clipState(clipId)` / `clipStates()`

The timeline needed the playhead, the direction, and the anchor frame. Deriving
them externally would have meant reimplementing `#secondsFor` — a second copy of
the one calculation that must never disagree with itself.

Read-only by construction. The timeline is a **view** of the runtime and cannot
advance anything; a timeline that owned playback would be a second clock.

**No engine behaviour changed.** All 148 `engine-host` tests passed unmodified
throughout.

---

## 3. Decisions worth defending

### Only the visible tool reads the engine

Tools are tabs. Eight panels sampling simultaneously would make the workbench a
measurable fraction of the process it measures.

Measurement later showed this was *less* necessary than assumed — see §5 — but
the design is still right: it means adding a ninth tool costs nothing when it is
not open.

### Pausing the console freezes the view, not the engine

A console that stopped the show to be read would be useless during exactly the
thing worth reading it for. Pause snapshots the log; the engine keeps running,
and resuming shows what was missed.

### Debug layers are SVG over the canvas, never geometry in the scene

Adding debug nodes to the document would make the thing being measured different
from the thing that ships, and would put debug boxes in screenshots meant to be
baselines. The overlay projects world coordinates to canvas pixels using the
orthographic camera's scale — stated in the code, because the same maths would
be silently wrong for a perspective camera.

### A recording stores hashes, not just commands

Replaying commands through the same code trivially yields the same result, so a
command-only recording would always "pass" and prove nothing. The value is the
**checkpoints**: session hashes at recorded frames. A replay reaching a
different hash means something non-deterministic entered the engine, which is
the bug class hardest to find any other way.

Replay runs frame by frame, applying each frame's commands before advancing.
Applying them all up front would reach the right final state by the wrong route
and would not catch an ordering bug.

Verification forks a **new** session. Replaying into the one that produced the
recording would compare a state against itself and pass unconditionally.

### The frame breakdown is scaled to the budget, not to itself

A bar that rescales to its own maximum always looks full. The question is never
"which part is biggest" but "does it fit in 16.67 ms".

---

## 4. An honesty fix in the overlay

The performance panel reported **739 fps**.

That number was arithmetically correct — 1000 ÷ 1.352 ms — and completely
misleading. The loop is capped by `requestAnimationFrame` at the display
refresh, so the engine was running at 60 while the panel implied it was running
at 739.

Relabelled to **capacity**: frames per second the engine *could* produce. An
engineer reading "fps: 739" would go looking for a frame rate that was never the
engine's to set.

Worth recording because it is the same failure as the Phase 1 frozen overlay: a
number that is individually correct and collectively misleading. A diagnostics
panel is believed, which makes its labels part of its correctness.

---

## 5. Measured overhead

Against a frame at **0.0008 ms** (mock backend, 50-row scene):

```
checkpoint tick                     0.00003 ms
output rows / timeline / node detail  0.0001 ms
debug boxes, 50 rows                 0.0004 ms
inspector tree, small                0.0030 ms
inspector tree, 50 rows              0.0054 ms
console filter, 400 records          0.0102 ms
replay and verify 60 frames          0.19   ms
```

The most expensive tool read is the console text filter at 0.0102 ms. At the
10 Hz sampling rate that is **0.1 ms per second — about 0.01% CPU**.

**The finding that matters:** every tool is at least 20× cheaper than
`diagnostics()` at 0.226 ms, which the overlays already call. The dominant cost
was never the panels — it is `sessionHash()`, which canonicalises every variable
including collections. The tab design is defensible, but the measurement says
even eight simultaneous tools would have been affordable.

The tooling does not significantly affect what it displays, and that is now a
measurement rather than an intention.

---

## 6. What Phase 2 does not do

**No editing.** The inspector is read-only. An inspector that could write would
be the beginning of the editor, and this is not that application.

**No visual regression tooling.** Still deferred, for the same reason as Phase 1:
producing stable bytes and deciding whether two sets of bytes are acceptably
similar are separate problems.

**No GPU timing.** Not available from this side of the backend boundary.
`RENDER_BACKEND_VERIFICATION §7` still holds, and the frame breakdown says so on
screen rather than implying its render bar is GPU time.

---

## 7. Assessment

The workbench found two things while being built: a mislabelled metric that
would have misled anyone reading it, and — in Phase 1 — an overlay that had
silently stopped updating. Both were in the tool, not the engine, which is the
right place for a tool's bugs to be.

The engine additions were all observability, and all were demanded by a concrete
tool rather than anticipated. That is the pattern §9 asked for: improve the API,
never bypass it, and let real usage decide what the API is missing.
