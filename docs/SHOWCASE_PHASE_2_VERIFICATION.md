# Showcase Phase 2 Verification

**Date:** 2026-08-02 · **Subject:** the engineering workbench
**Verdict:** **VERIFIED.** Every required proof is executable. The tooling's overhead is measured, not assumed.

| Label | Meaning |
| --- | --- |
| **Proven** | Demonstrated by an executing test or measurement here |
| **Derived** | Follows from something Proven, plus a stated argument |
| **Assumed** | Believed, not tested; the risk is stated |
| **Unknown** | Cannot be established here; what would establish it is stated |

---

## 1. Reproduce

```
pnpm --filter showcase test        196 passed   (headless)
cd apps/showcase && npx playwright test   15 passed   (browser)
pnpm --filter showcase bench       overhead, §4
pnpm turbo run check-types lint test build   34/34
node tools/check-boundaries.mjs    exit 0
```

---

## 2. The six required proofs

### V1 — Overlays stay synchronized. **Proven, in a browser.**

The frame breakdown's history grows while a scene runs, and the output monitor's
counters rise. Asserted by reading the DOM twice with a gap.

This is the specific failure Phase 1 shipped and fixed — a panel whose numbers
were individually correct and collectively frozen — so it is guarded in the
browser, which is the only place it can happen.

### V2 — The command log updates correctly. **Proven.**

Headless: `source` is `"operator"` for controls, `"scene"` for load commands,
`"replay"` for a replay, and never `"unknown"`. `durationMs` is non-negative and
strictly positive for a 2,000-row collection replace. A target is derived for
every command shape.

Browser: clicking a control adds rows, and the log shows `variable.set` and
`operator`. Pausing freezes the view while the engine keeps running; resuming
reveals what was missed.

### V3 — The inspector reflects runtime state. **Proven.**

Every node's `parentId`, `childIds`, and `effectiveVisible` are asserted equal to
the mirror's. `worldMatrix` is asserted identical, not merely close.

The inspector reads the **mirror**, not the document, and a test proves
collection instances appear — an inspector reading the document would be missing
exactly the nodes hardest to reason about.

Variables are read through the engine's own `dependenciesOf` reverse index;
recomputing them would be a second answer to a question the engine answers.

### V4 — The timeline follows playback. **Proven, twice.**

Headless: the reported playhead is asserted **identical** to
`animator.clipState(...).seconds`, so the timeline cannot be a second clock.
Direction and speed are reported; a stopped clip reports no state.

Browser: the playhead's CSS offset changes between two samples while playing.

### V5 — The output monitor updates live. **Proven.**

Headless: every row matches `outputStats()` exactly, `rendered + skipped` equals
the frames stepped, and a half-cadence output reports 30 effective fps.

Browser: binding a preview adds a row showing `960×540` and `1/2`, and its
rendered count rises over time.

### V6 — Replay matches the recording. **Proven, and Proven to fail when it should.**

A 90-frame recording with two collection commands replays into a fresh session
with zero mismatches across multiple checkpoints.

More importantly: **a tampered recording is detected.** Corrupting the
checkpoint hashes produces `matched: false` with a `session` mismatch. A
verification tool that cannot fail is not a verification tool, and this is the
assertion that proves it can.

Also Proven: a recording from another scene is refused, and a recording
round-trips through JSON so it can be attached to a bug report.

---

## 3. Additional properties Proven

| Property | Why it matters |
| --- | --- |
| Filtered tree keeps ancestors of matches | A filtered tree that drops parents is a list, and loses the point of a tree |
| Debug boxes project with Y flipped | The canvas grows down, the scene grows up; asserted against every node's world matrix |
| Debug boxes classify layout vs anchor vs bounds | An overlay that cannot distinguish them cannot answer why a node moved |
| Layers are absent from the DOM when off | Proven in the browser — the overlay does not exist unless asked for |
| Switching all six tools produces no console error | The cheapest test that catches the most careless breakage |
| Command console pause does not stop the engine | Proven by resuming and finding new rows |

---

## 4. Measured overhead

Against a **0.0008 ms** frame:

| Read | Cost | vs frame |
| --- | --- | --- |
| Checkpoint tick | 0.00003 ms | 0.04× |
| Output rows | 0.0001 ms | 0.13× |
| Timeline | 0.0001 ms | 0.13× |
| Node detail | 0.0001 ms | 0.13× |
| Debug boxes (50 rows) | 0.0004 ms | 0.5× |
| Inspector tree (50 rows) | 0.0054 ms | 6.8× |
| Console filter (400 records) | 0.0102 ms | 12.8× |
| Replay + verify 60 frames | 0.19 ms | — |

At 10 Hz, the worst tool costs **0.1 ms per second ≈ 0.01% CPU**.

**Derived:** the tooling does not significantly affect its own measurements. The
most expensive tool read is 22× cheaper than `diagnostics()` (0.226 ms), which
the overlays already call, so the panels were never the dominant cost — the
session hash is.

---

## 5. Public API audit

**Proven: the showcase uses only public APIs.** Every import is a package entry
point; nothing reaches into `src/`, and the boundary checker passes.

Three additions were made to the engine rather than worked around:

| Addition | Demanded by | Kind |
| --- | --- | --- |
| `LiveCommandRecord.source` | Command console | Observability |
| `LiveCommandRecord.durationMs` | Command console | Observability |
| `Animator.clipState` / `clipStates` | Timeline | Observability |

All read-only. No engine behaviour changed, and all 148 `engine-host` tests
passed unmodified.

**Not added, deliberately:** an inspector write path. That is the editor, not the
workbench.

---

## 6. Limits

| Claim | Status | What would establish it |
| --- | --- | --- |
| GPU time in the frame breakdown | **Unknown** | `EXT_disjoint_timer_query`. The render bar is submission time and the panel says so on screen |
| Overhead figures hold on other hardware | **Assumed** | Runs elsewhere. Ratios should hold; absolutes are one machine's |
| A recording survives an engine version change | **Assumed — probably false** | Recordings are debugging artefacts for one build, not an archive format. Nothing versions them |
| The workbench is pleasant to use under pressure | **Assumed** | Use. Correctness is Proven; whether the layout serves someone debugging at 3am is a judgement no test makes |
| Inspector cost at 10,000 nodes | **Unknown** | Measured to 50 rows / 35 nodes. A very large scene may need virtualised rows |

---

## 7. Assessment

The workbench's own bugs were both in the tool: a frozen overlay in Phase 1, and
a mislabelled `fps` in Phase 2 that was arithmetically right and materially
misleading. Both were caught by looking at what the tool said and disbelieving
it — which is the habit the tool exists to make cheap.

The strongest result is V6's negative case. A replay verifier that only ever
reports success is decoration; this one is Proven to detect a corrupted
checkpoint, which means a green result carries information.

**Verdict: VERIFIED.** The showcase is now the engineering cockpit, and its cost
to be so is 0.01% CPU.
