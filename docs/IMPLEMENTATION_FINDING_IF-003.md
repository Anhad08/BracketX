# IF-003 — Studio Phase 3 cannot meet its own success criterion: there is no text engine

**Date:** 2026-08-02 · **Raised by:** Studio Phase 3, Authoring & Production
**Status:** **BLOCKING for the stated milestone. Six of nine phases are unblocked.**
**Decision required from:** CTO / product owner

---

## 1. The premise that is false

Phase B says:

> *Integrate with the existing HarfBuzz/MSDF pipeline.*
> *Support every language already proven by the engine.*
> *Text becomes a first-class scene node.*

There is no existing pipeline to integrate with.

```
$ wc -l packages/engine-text/src/*.ts
    1  index.ts            <- a package marker. One line.
  370  pipeline.spike.ts   <- the T1 spike
   78  vendor.d.ts
```

```
$ grep -c '"text"' packages/engine-reconciler/src/projection.ts
0
$ grep -rn "msdf-text" packages/*/src/*.ts | grep -v mirror-backend | grep -v translate
(no results)
```

`engine-text` contains a **spike and nothing else**. The projector has no `text`
branch. The `msdf-text` material kind exists in the frozen `MirrorBackend` — the
boundary is ready — and **nothing in the engine produces one**.

### What T1 actually proved, and what it did not

Commit `8154791` is titled *"spike(text): T1 — prove stages 2 to 5 **before
committing** the Text Engine"*. It retired a risk. It did not build a subsystem.

TEXT_ENGINE.md §3 lists eight stages. T1 covered four:

| Stage | | Status |
| --- | --- | --- |
| 1 | Font loading and fallback resolution | Not built |
| 2 | Itemization | ✅ spiked |
| 3 | Bidi | ✅ spiked |
| 4 | Shaping (HarfBuzz WASM) | ✅ spiked |
| 5 | Line breaking | ✅ spiked |
| 6 | Shaping cache | **Not built** |
| 7 | Layout — wrap, fit, align, vertical metrics | **Not built** |
| 8 | **MSDF rasterization and dynamic atlas** | **Not built** |

Stage 8 is the one that puts pixels on screen, and it is the one with three
**open decisions**, not open tasks — TEXT_ENGINE.md §11:

- **T2** — MSDF quality trial at 24–96pt including thin faces and CJK
- **T3** — **adopt vs re-implement troika**, judged on atlas pinning and determinism
- **T4** — per-scene pre-warm character-set declaration: format addition or asset metadata?

T3 in particular is an architecture decision with a format consequence. It is
not something to settle inside a product milestone.

---

## 2. Why this blocks the milestone rather than inconveniencing it

The phase states its own success criterion:

> *someone outside the engineering team can sit down, build a professional
> animated lower third, preview it, send it to Live, and save it as a reusable
> template entirely through Streamatrix Studio.*

**A lower third with no words is not a lower third.** It is a coloured bar. I
said exactly this closing Studio Phase 1 — *"without text nodes a lower third
has no words"* — and it is still the binding constraint.

The same applies to four of the six templates Phase H requires: Minimal Lower
Third, Broadcast Lower Third, Sports Scoreboard, Generic Leaderboard and
Countdown Timer are all **text-first** graphics. A Tournament Bracket without
names is a diagram of empty boxes.

So the milestone is not "mostly achievable with a gap". The gap **is** the
milestone.

---

## 3. The contradiction inside the brief

The final instruction is:

> *Stop building the engine. Start building the product.*

Phase B is the largest single piece of **engine** work remaining in the entire
roadmap. TEXT_ENGINE.md §9 rates the Unicode annexes as *High probability /
Severe impact*, and §2 exists specifically to argue that "just use HarfBuzz"
underestimates it:

> *HarfBuzz shapes, and does nothing else. Budgeting "HarfBuzz integration" and
> discovering these later is the specific way text projects overrun.*

Building it inside a product phase, under a "stop building the engine"
instruction, is the exact failure that document was written to prevent.

**This is not an argument for skipping text.** It is an argument that text is a
phase, not a checkbox inside one — and that calling it "integration" is how it
gets under-budgeted.

---

## 4. What IS unblocked

Six of the nine phases need no engine work at all. I have not started them,
because shipping eight-ninths of a milestone whose success criterion cannot be
met would be worse than stopping to ask.

| Phase | Status | Note |
| --- | --- | --- |
| **A** Creation toolbox | ⚠️ Partial | Rectangle, Group, Camera, Mesh: ready. Circle: an hour. **Text: blocked.** Image/SVG: need the asset pipeline |
| **B** Text system | ❌ **Blocked** | This finding |
| **C** Inspector | ✅ Ready | Context-aware panels; modest value until there are more node types to be contextual about |
| **D** Timeline authoring | ✅ **Ready** | Keyframe CRUD, drag, copy/paste, scale, zoom, scrub, loop. `makeSetDocProp` already makes every one of these an ordinary undoable operation |
| **E** Animation presets | ✅ **Ready, and high value** | Presets compiling to ordinary timeline tracks with no runtime special case is exactly what the timeline model was built for |
| **F** Variables | ✅ Mostly built | Studio Phase 1 shipped create/bind/preview/readers. Override + reset remain |
| **G** Preview → Take → Live | ✅ **Ready, and architecturally interesting** | Two sessions, two outputs, an explicit transition. Nothing engine-side is missing |
| **H** Official templates | ❌ **Blocked** | Five of six are text-first |
| **I** Asset library | ⚠️ Partial | Motion presets and colours: ready. Fonts, images, SVGs: need the asset pipeline |

---

## 5. Recommendation

**Split the milestone. Do not compress text into it.**

### Phase 3a — Authoring workflow (unblocked, ~3–4 weeks)

D, E, G, F-completion, C, and the unblocked half of A and I. The deliverable is
a designer who can build, animate, preview and take-to-air a **shape-and-motion**
graphic — a sting, a sponsor wipe, an animated bar — and save it as a template.

That is a real product increment, it exercises every system the Marketplace will
consume, and it makes the text engine's landing trivial: the day text nodes
exist, every one of those tools already works on them, because none of them
knows what a node is.

### Phase 3b — The text engine (its own phase, with T2/T3/T4 decided first)

Stages 1, 6, 7, 8. T3 (adopt vs re-implement) decided **before** work starts,
because it changes what gets built. Then the text component, the projection, and
Studio's typography inspector.

### Then Phase 3c — Official templates

All six, built in Studio, once text exists.

### The alternative I am not recommending

Ship Phase 3 with a `text` component that rasterises through Canvas2D into a
texture. It would produce words on screen this week. It would also be a second
text implementation with different metrics, no shaping, no bidi, no fallback
chain, and no determinism guarantee — and every template authored against it
would need re-authoring when the real engine landed. That is the
"plausible-looking wrong glyph" failure SCENE_FORMAT §7.2 already refuses, wired
into the product.

---

## 6. One more thing worth deciding now

The viewport-first sequencing agreed after IF-002 is **also** still outstanding:
there is no 3D viewport, and nothing has yet confirmed on screen that a
directional light illuminates a face pointing at it. Every lighting claim in
ADR-013 amendment 1 is a headless assertion about descriptors and handles.

Phase 3a and the 3D viewport do not conflict — the viewport is Studio work and
the authoring tools are Studio work — but they compete for the same weeks, and
the text engine competes with both. Three real pieces of work, one at a time.

**My order:** 3a authoring workflow → text engine → 3D viewport → templates.
Text first among the two engine pieces, because it unblocks five of six official
templates and the entire lower-third success criterion, whereas the viewport
unblocks development speed on a capability nobody is shipping yet.
