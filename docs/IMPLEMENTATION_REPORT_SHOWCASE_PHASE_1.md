# Implementation Report — Showcase Phase 1

**Date:** 2026-08-02 · **App:** `apps/showcase`
**Companions:** [SHOWCASE_GUIDE.md](./SHOWCASE_GUIDE.md) · [SHOWCASE_VERIFICATION.md](./SHOWCASE_VERIFICATION.md)

---

## 1. What was built

The showcase foundation. No scenes yet, by instruction — the shell is the
subsystem, and it is treated like every other one: production quality,
benchmarked, verified, extensible.

| Piece | Responsibility |
| --- | --- |
| `registry.ts` | Scene registration, validation, deterministic ordering |
| `engine/session.ts` | `ShowcaseSession` — load, command, step, diagnose, dispose |
| `engine/metrics.ts` | Fixed-window rolling frame statistics |
| `engine/screenshot.ts` | Deterministic capture |
| `settings.ts` | Persistent developer preferences |
| `ui/viewport.tsx` | Canvas mount and lifecycle |
| `ui/overlays.tsx` | Developer and performance panels |
| `App.tsx` | Shell, hash routing, navigation |

Vite rather than Next.js: it needs instant startup and no server, and keeping it
framework-light is itself a check — the engine must work as a plain client-side
library with nothing helping it.

---

## 2. The showcase found an API gap immediately

`SceneHost.lastReport` returns a `ProjectionReport`, and every projection method
returns one, but the type was never exported from `@bracketx/engine-host`. No
consumer could type its own code against a value the engine hands it.

Fixed in the engine — `ProjectionReport`, `MirrorBackend`, and `VariableSource`
are now re-exported — rather than worked around in the showcase.

This is the entire argument for building a first consumer. The gap was invisible
from inside the engine, where those types are always in scope, and appeared
within an hour of something real trying to use them.

---

## 3. One engine addition: frame timings

The performance overlay needed per-phase timing, and the engine reported *what*
happened each frame but not *how long* it took.

`FrameResult` gains `timings: { total, runtime, animation, render }`, and
`SceneHost.lastTimings` exposes the most recent. Measured with a monotonic clock
kept deliberately separate from the runtime clock: one measures how long the
engine took (a property of the machine), the other measures show time (a property
of the production). Conflating them is how a slow frame becomes a dropped frame
of content.

Always collected rather than opt-in. Six clock reads against a 16.67 ms budget,
and an engine that can only be measured when someone remembers to enable
measurement is one whose production behaviour is a mystery. "Observable" is an
engineering standard here, not a debug feature.

`render` is **submission** time. What the GPU then does is not visible from this
side of the boundary — `RENDER_BACKEND_VERIFICATION §7` still holds.

---

## 4. Decisions worth defending

### `ShowcaseSession` is a class, not a hook

Everything worth verifying lives in a plain class taking any `MirrorBackend`, so
the whole application is testable against `MockMirrorBackend` — no browser, no
canvas, no GL. All 33 tests run headlessly in milliseconds.

A test that needs a browser to check that a displayed number matches an engine
number is a test that will eventually be skipped.

### Controls receive `send`, never a host

A control holding a `SceneHost` could bypass the command path. Proving that path
sufficient is half the reason this app exists, so the control context exposes
exactly one mutation: `send(command)`.

If a control cannot be expressed as a command, that is an engine finding.

### Overlays read, never compute

Every number is taken from a public API and shown unmodified. A panel with its
own idea of the node count will eventually disagree with the engine, and the
panel is what gets believed.

`diagnostics()` also takes **one coherent snapshot** rather than reading fields
lazily, so the panel can never show a frame number from one moment beside a node
count from another. A display that tears is worse than none.

### Registration is the only step to add a scene

No shell edit, no navigation entry, no switch statement. Each of those is a place
a contributor must find, and a subsystem whose showcase is hard to add is one
that quietly ships without one.

### Sorting is deterministic

Registration order is import order, which is not stable enough to navigate by.
Group, then order, then title gives the same sidebar on every machine.

### A duplicate id throws

Last-write-wins would make two scenes sharing an id a heisenbug that depends on
import order.

---

## 5. Measured

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

**The measurement that changed a design.** A diagnostics read costs 0.226 ms
against a 0.0007 ms frame — roughly 300×. Sampling overlays per frame would have
made the tool the thing that drops frames, and the measurements would then be
measuring the measurement.

The 10 Hz sampling interval was a guess when written and is now validated:
0.226 ms × 10 = **~0.2% CPU**, and faster than an eye reads a changing number.

`diagnostics()` is O(scene) because `sessionHash()` canonicalises every variable,
including collections. That is acceptable at 10 Hz and is stated rather than
hidden — the hash is one of the most valuable diagnostics, since it is what makes
determinism verifiable by eye.

Recording a frame is 0.04 µs: the metrics ring subtracts the overwritten value
rather than re-summing, because an overlay updating over a 240-sample window
would otherwise do 14,400 additions a second to display one number.

---

## 6. What Phase 1 deliberately does not do

**No scenes.** By instruction. The empty registry is a real state the shell
handles — the sidebar says so rather than crashing, which is exactly what the
contributor adding the first scene will see.

**No visual regression tooling.** Capture produces stable bytes; deciding whether
two sets of bytes are acceptably similar is a separate problem with its own
failure modes, and building it now would mean designing a comparison policy
before a single baseline exists.

**No React-layer tests.** The React layer has no logic beyond lifecycle, and
testing lifecycle through a DOM would test React rather than BracketX. Everything
underneath is covered headlessly.

---

## 7. Assessment

The foundation behaves like the rest of the engine work: it found a real gap in
the thing it consumes within an hour, one design decision was corrected by
measurement rather than argument, and the parts that matter are verifiable
without a browser.

The bar for the next phase is now concrete. A capability is not complete until it
has automated tests, benchmarks, and a showcase scene — and adding that third
thing costs one file and one import.
