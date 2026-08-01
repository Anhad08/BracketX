# Showcase Verification — Phase 1

**Date:** 2026-08-02 · **Subject:** `apps/showcase` foundation
**Verdict:** **VERIFIED.** Every Phase 1 requirement is Proven by an executing test. Two limits are recorded rather than claimed.

| Label | Meaning |
| --- | --- |
| **Proven** | Demonstrated by an executing test or measurement in this repository |
| **Derived** | Follows from something Proven, plus a stated argument |
| **Assumed** | Believed, not tested; the risk is stated |
| **Unknown** | Cannot be established here; what would establish it is stated |
| **Disproven** | Tested and found false |

---

## 1. Reproduce

```
pnpm --filter showcase test      33 passed
pnpm --filter showcase bench     measurements in §4
pnpm turbo run check-types lint test build   34/34 successful
node tools/check-boundaries.mjs  exit 0
```

All 33 run headlessly against `MockMirrorBackend`. No browser, no canvas, no GL.

---

## 2. The required proofs

The brief asked for integration tests proving five things. Each is Proven.

### V1 — Scenes load correctly. **Proven.**

A registered scene builds its document, populates the mirror, applies its opening
commands, and binds any extra outputs. Loading twice produces byte-identical
mirrors, which also proves `build()` is deterministic — a scene that renders
differently on a second load is a bug the showcase surfaces rather than caches.

### V2 — Overlays remain synchronized with the engine. **Proven.**

`diagnostics()` is asserted field by field against the engine it read from:
frame against `clock.frame`, session hash against `sessionHash()`, node count
against `mirror.nodeIds()`, frames and submissions against the host's own
counters, commands against the log.

Two further properties:

- **No tearing.** Two consecutive reads return the same frame and hash, because
  a snapshot is taken once rather than fields read lazily.
- **Timings decompose.** `runtime + animation + render ≤ total`, asserted over
  30 frames. A breakdown whose parts exceed the whole is a breakdown nobody can
  reason with.

### V3 — Screenshots are deterministic. **Proven, at the engine level.**

Arriving at frame 30 by playing 30 frames and by seeking produces an identical
session hash and byte-identical mirror. The clock is Proven paused after a seek,
so the frame cannot drift under the capture. Names are Proven stable and carry no
timestamp.

**Limit, stated:** this proves the *engine state* behind a capture is
reproducible. That the encoded PNG bytes are identical is **Unknown** here —
`toDataURL` needs a real canvas. See §5.

### V4 — Engine state matches displayed diagnostics. **Proven.**

Covered by V2. Additionally, a rejected command is Proven to surface in the
overlay with its reason rather than being swallowed — a diagnostics panel that
hides failures is worse than none.

### V5 — Multiple scenes switch without leaks. **Proven.**

Dispose frees every mirror node and every GPU resource. Twenty consecutive
switches each end with zero nodes and zero materials — a per-switch leak is
invisible in a single-scene test and makes the tool unusable after an afternoon.

Commands after dispose are ignored rather than thrown, so a stray control click
during teardown cannot break the shell.

---

## 3. Additional properties Proven

| Property | Why it matters |
| --- | --- |
| Duplicate scene id throws | Last-write-wins would be a heisenbug depending on import order |
| Registry ordering is deterministic | Import order is not stable enough to navigate by |
| Invalid scenes rejected (id casing, empty title/summary/capability) | A scene without a named capability breaks the link between subsystem and verification |
| Adding a scene requires only registration | Asserted directly: register, then it appears in the groups |
| Settings survive absent storage | Node has none, and neither do some private-browsing modes |
| Settings survive corrupt contents | A tool that will not start because it cannot parse a checkbox is worse than one that forgets |
| Settings keep only known keys | A stale or hostile store must not inject fields |
| Metrics bound their memory | 1,000 samples into a 240 window stays at 240 |
| Metrics report mean, p95, max | The last frame is noise; the worst is the dropped one |
| Every mutation goes through the command log | Asserted replayable — only true because nothing bypassed it |

---

## 4. Measured

```
load a 10-row scene                0.045 ms
load a 200-row scene               0.359 ms
dispose and load another           0.320 ms
frame only                         0.0007 ms
diagnostics read                   0.226 ms
metrics snapshot                   0.019 ms
metrics record one frame           0.00004 ms
seek to an exact frame and render  0.029 ms
list and sort 40 scenes            0.016 ms
```

**One measurement corrected a design.** A diagnostics read costs ~300× a frame.
Sampling overlays per frame would have made the tool the thing that drops frames.
The 10 Hz interval was a guess and is now Proven adequate: **~0.2% CPU**.

`diagnostics()` is O(scene) — `sessionHash()` canonicalises every variable,
collections included. Acceptable at 10 Hz, and stated rather than hidden.

---

## 5. Limits

| Claim | Status | What would establish it |
| --- | --- | --- |
| Encoded screenshot bytes are identical across runs | **Unknown** | A browser suite calling `toDataURL` twice. The engine state behind them is Proven identical |
| The React shell renders correctly | **Unknown** | A DOM test. Deliberately not written: the layer has no logic beyond lifecycle, and testing it would test React |
| Overlays are readable and useful in practice | **Assumed** | Use. The numbers are Proven correct; whether the layout serves an engineer under pressure is a judgement no test makes |
| Overhead holds on slower hardware | **Assumed** | Runs elsewhere. Ratios should hold; absolutes are one machine's |
| No leak across hundreds of switches | **Derived** | Twenty are Proven, with exact zero-resource assertions. A leak that appears only after two hundred would have to be sublinear |

---

## 6. An API gap found and fixed

`SceneHost.lastReport` returned a `ProjectionReport` never exported from
`@bracketx/engine-host`, so no consumer could type its own code against a value
the engine hands it. Fixed in the engine rather than worked around.

Recorded here because it is evidence for the showcase's existence: invisible from
inside the engine where those types are always in scope, and found within an hour
of something real consuming them.

---

## 7. Assessment

Phase 1 does what a foundation should: it makes the next twenty scenes cheap, it
is verifiable without a browser, and it already improved the thing it consumes.

The strongest single result is not a number — it is that the showcase's own tests
never construct a `SceneHost` directly, never reach past an exported surface, and
still verify frame timing, projection counts, command outcomes, output
statistics, and determinism. If the public API were insufficient, that suite
could not exist.

**Verdict: VERIFIED.** Foundation complete; the six Phase 7 scenes can be built
on it.
