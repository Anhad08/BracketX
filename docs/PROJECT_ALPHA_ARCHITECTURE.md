# BracketX — Production Operating System

**Status:** Reframing · **Date:** 2026-08-01
**Companion to:** [ENGINE_ARCHITECTURE.md](./ENGINE_ARCHITECTURE.md) (unchanged) · [PROJECT_ALPHA_REVIEW.md](./PROJECT_ALPHA_REVIEW.md)

---

## 1. What BracketX is

> **A deterministic real-time engine for producing live visual output, and a set
> of applications built on it.**

Not a broadcast graphics platform. Not a tournament platform. Those are the
first two *applications*.

The distinction is testable, not rhetorical: **the engine contains no word that
belongs to a domain.** No match, no bracket, no lower third, no scoreboard, no
on-air. If one appears in engine code, the engine has stopped being an engine.

## 2. The layers

```
┌────────────────────────────────────────────────────────────┐
│ APPLICATIONS   Tournament · Sports · Corporate · Education  │
│                Government · Concerts · Virtual Production   │
│                — domain logic, workflows, vocabulary        │
├────────────────────────────────────────────────────────────┤
│ CONTENT PACKS  Templates · component definitions · tokens   │  ← data, not code
│                (broadcast pack, tournament pack, …)         │
├────────────────────────────────────────────────────────────┤
│ SEAM           Variables · Cues · Templates · Events        │  ← §13, unchanged
│                · Control · Data Sources · Outputs           │     three added
├────────────────────────────────────────────────────────────┤
│ ENGINE         Scene Graph · Runtime · Reconciler           │
│                Text · Animation · Timeline · Layout         │
│                Collections · Assets · Authoring API         │
├────────────────────────────────────────────────────────────┤
│ BACKENDS       MirrorBackend → Three.js / WebGPU / …        │  ← frozen boundary
└────────────────────────────────────────────────────────────┘
```

The seam is the whole architecture. Applications reach the engine through it and
nowhere else. Everything above it is replaceable without touching the engine;
everything below it is replaceable without touching applications.

## 3. The seven capabilities

| # | Capability | What it means | Status |
| --- | --- | --- | --- |
| 1 | **Scenes** | A deterministic, immutable document describing what exists | Built |
| 2 | **Time** | One clock; one timeline; animation and sequencing read it | Clock built |
| 3 | **Values** | Variables, bindings, design tokens — one name-to-value resolver | Built |
| 4 | **Composition** | Templates, nesting, collections, layout | Partly built |
| 5 | **Rendering** | Scene → frames, backend-neutral | Built, verified in pixels |
| 6 | **Outputs** | Frames → somewhere: canvas, texture, file, stream | Abstraction needed |
| 7 | **Control** | Remote, reconnect-safe, low-latency operation with telemetry | Phase 6 |

Everything a production application does is a composition of these seven. If a
requested feature is not expressible as one, it is application logic.

## 4. What the engine must never know

- What a match, a lesson, a session, a set, or an agenda item is
- That output goes to a broadcast pipeline rather than a projector or a texture
- That a graphic has an "in" and an "out"
- What a browser is, below the host layer
- Which data provider a value came from
- What the user's workflow looks like

## 5. Why this is credible

The engine has already refused four convenient additions at its boundary rather
than widen it — `setMeshScale`, `setSize`, an early resource release, and a
platform text engine. Each refusal cost implementation effort and each preserved
substitutability. A boundary that never refuses anything is decoration.

Three further pieces of evidence: `MirrorBackend` has two independent
implementations that produce byte-identical mirrors; the render backend is
enforced by a checker that fails CI on a single leaked type name; and Phase 2.6
proved the whole chain to real pixels.

## 6. The governing risk

From [ENGINE_ARCHITECTURE §13](./ENGINE_ARCHITECTURE.md), unchanged and still
the most important paragraph in the project:

> Build the engine **through** the first application, not before it. Generality
> is earned by having two real consumers, not by anticipating eight.

Project Alpha therefore generalises **abstractions and names now**, and
**implementations only on demand**. One new capability is being built —
Collections — because the roadmap already contains four features that cannot
exist without it.

## 7. How a domain object is expressed

A worked example, to make the seam concrete.

**A bracket** is not an engine concept. It is:

```
collection (matches)                    ← engine: Collections
  └ template instance per match         ← engine: Templates
      ├ text bound to teamName          ← engine: Values + Text
      ├ rect styled by token            ← engine: Values
      └ state: pending | live | done    ← engine: named states
  layout: tree, anchored                ← engine: Layout
  data from tournament provider         ← seam: Data Sources
  advanced by operator or rule          ← seam: Control / Sequencing
```

Seven engine capabilities and two seam calls. **Zero engine code that knows what
a bracket is.** The tournament application supplies the data shape and the
vocabulary; the content pack supplies the template.

The same decomposition produces a scoreboard, a leaderboard, a conference
agenda, a set list, and a shot list — which is the test of whether the
abstraction is real.
