# Showcase Guide

**Status:** Phase 1 complete · **App:** `apps/showcase`

The permanent visual verification suite for the BracketX engine. Not a demo —
engineering infrastructure that grows with every subsystem.

---

## Run it

```bash
pnpm --filter showcase dev      # http://localhost:5180
pnpm --filter showcase test     # headless verification
pnpm --filter showcase bench    # overhead measurements
```

No database, no auth, no server. It opens and runs.

---

## The rule

> **The showcase consumes only public engine APIs.**

If a showcase cannot express something, that is an **API design finding**, not a
reason to reach into internals. Phase 1 found one already: `SceneHost.lastReport`
returned a `ProjectionReport` that was never exported, so no consumer could type
its own code. Fixed in the engine, not worked around here.

This is the point of the showcase existing at all. It is the first real consumer,
and a first consumer's job is to find the gaps that speculation cannot.

---

## Adding a scene

**Registration is the only step.** No shell edit, no navigation entry, no switch
statement. Every one of those is a place a contributor has to find, and a
subsystem whose showcase is hard to add is one that quietly ships without one.

Create `src/scenes/<capability>.ts`:

```ts
import { registerScene } from "../registry";

registerScene({
  id: "live-variables",          // URL slug, stable forever
  title: "Live Variables",
  group: "Production",           // sidebar grouping
  order: 10,                     // sort within the group
  summary: "Text, number, colour, and boolean updated live.",
  capability: "Live Control · variable.set",

  build: () => makeMyDocument(),        // deterministic; called on every load

  onLoad: [{ type: "clip.play", clipId: "anm_in" }],
  screenshotFrame: 60,                  // frame a capture pauses at

  controls: ({ send, variables }) => (
    <button onClick={() => send({ type: "variable.set", key: "score", value: 1 })}>
      Score
    </button>
  ),
});
```

Then add one line to `src/scenes/index.ts`:

```ts
import "./live-variables";
```

### The contract

| Field | Why it is required |
| --- | --- |
| `id` | Lowercase slug. It is the URL — links to a showcase should not rot. |
| `capability` | Names the engine capability this proves. The link between a subsystem and its verification, and why a capability without a showcase is visible. |
| `build(parameters?)` | Must be **deterministic**: the same parameters must always produce the same document. Called on every load, so a scene that differs between loads is a bug the workbench surfaces rather than caches away — and a non-deterministic build makes every replay verification meaningless. |
| `parameters` | Optional build axes (node count, hierarchy depth) the stress laboratory can drive. Declared as data, so the laboratory drives whatever a scene offers without knowing about any scene. Document shape cannot be changed by a command — that is the RFC-002 §4.3 boundary — so these go through a rebuild. |
| `keywords` | Optional extra search terms for the command palette. |
| `controls` | Receives `send`, **not a host**. A control that could reach the host could bypass the command path — and proving that path sufficient is half the reason this app exists. |

---

## Architecture

```
registry.ts        scene registration and ordering
settings.ts        persistent developer preferences
engine/
  session.ts       ShowcaseSession — the whole thing, headlessly testable
  metrics.ts       rolling frame statistics
  screenshot.ts    deterministic capture
  history.ts       per-frame samples, percentiles, spikes, baselines
ui/
  viewport.tsx     canvas mount and lifecycle
  palette.tsx      command palette and the generated keyboard reference
tools/
  model.ts         every tool's data, labelled SAMPLED or INVOKED
  scene-index.ts   authored-document index, cached on document identity
  alerts.ts        the findings rules
  diff.ts          snapshot and recording comparison
  search.ts        fuzzy matching
  palette.ts       actions and the keymap — one list, two surfaces
  stress.ts        the stress laboratory
  recorder.ts      session recording and replay verification
  overlays.tsx     developer and performance panels
App.tsx            shell, routing, navigation
```

### Why `ShowcaseSession` is a class, not a hook

Everything worth verifying lives in a plain class that accepts any
`MirrorBackend`. That makes the entire application testable against
`MockMirrorBackend` — no browser, no canvas, no GL.

A test that needs a browser to check that a displayed number matches an engine
number is a test that will eventually be skipped. All 33 Phase 1 tests run
headlessly in milliseconds.

The React layer is a thin adapter with no logic beyond lifecycle.

---

## Overlays

**Developer** — frame, runtime time, session hash, runtime hash, node count,
animated nodes, clips, dirty nodes, backend writes, outputs with per-output
render/skip/miss counts, and the last eight commands with their outcomes.

**Performance** — fps, frame-budget share, and mean · p95 · max for total,
runtime, animation, and render, plus backend writes and dirty nodes.

Two decisions worth knowing:

**Every number is read from the engine and shown unmodified.** The overlay
computes nothing the engine already knows. A panel with its own idea of the node
count will eventually disagree with the engine — and the panel is what gets
believed.

**Overlays sample at 10 Hz, not per frame.** Measured: a diagnostics read costs
0.226 ms against a 0.0007 ms frame. Sampling per frame would make the tool the
thing that drops frames, and the measurements would then be measuring the
measurement.

**mean · p95 · max, not "last".** Frame times are noisy and the last frame is
whichever one happened to render. The worst frame in recent memory is the
dropped one, and that is what matters on air.

---

## Screenshots

```ts
const shot = captureScreenshot(session, canvas, { frame: 300 });
```

Deterministic by construction:

1. The clock is **paused** and **sought** to an exact frame. A running clock
   advances between the seek and the read, so "frame 300" becomes 301 on a slow
   machine.
2. The frame renders **synchronously after the seek**, in the same task. Waiting
   for the next animation frame reintroduces the race.
3. The drawing buffer is preserved — `createCanvasBackend` already sets it.

Names are `scene@000300.png`. **No timestamp**, no run id: a name that changes
every run cannot be a baseline, and adding the date is the most common way that
happens.

Visual regression tooling is deliberately **not** built. This produces stable
bytes; deciding whether two sets of bytes are acceptably similar is a separate
problem with its own failure modes.

---

## The rule going forward

> A capability is not complete until it has **automated tests**, **benchmarks**,
> and **a showcase scene**.

The showcase is how an architectural claim becomes something a person can watch.
