# RFC-003 — Rendering Architecture for a Real-Time 3D Production Engine

**Status:** Accepted · **Authored:** 2026-07-30 · **Owner:** @Pixelborne
**Supersedes:** [RFC-001](./RFC-001-rendering-architecture.md) (retained for decision history)

> RFC-001 answered "what renders 2D broadcast graphics in a browser" and
> answered it correctly for that question. The product definition changed:
> BracketX is a real-time 3D production engine. Canvas2D cannot express a
> perspective camera, a depth buffer, lighting, or meshes, so its conclusion is
> void. The reasoning that survives is carried forward and marked.

---

## 1. Decision

1. **WebGPU-first, WebGL2 fallback**, both behind one backend abstraction.
2. **Adopt an existing WebGPU-capable 3D engine as the rasterizer.** We do not
   write meshes, materials, lighting, or GPU resource management.
3. **Camera is a scene node**, not a viewport parameter.
4. ~~**Text is dual-path**~~ — **REVERSED, see §7.** Text is a **single owned
   pipeline**: our font parsing, HarfBuzz-WASM shaping, our SDF rasterizer, our
   dynamic atlas. No platform text engine on any target. Still the single
   largest technical risk in the 3D direction.
5. **OBS browser source is one output target, not the architectural
   constraint.** It gets the WebGL2 path.

## 2. Is 3D-first actually right?

Yes — and for one reason that is worth stating precisely, because the usual
justification ("we might want 3D later") is weak.

**A 3D engine renders 2D as a nearly free special case: an orthographic camera
and quads on a plane. A 2D engine can never become 3D.** The asymmetry is total.
Even if 90% of broadcast content is lower-thirds and scoreboards — and it is —
the foundation choice is decided by the 10% that cannot be retrofitted.

The industry confirms it: Vizrt, Ross XPression, and Chyron are all 3D engines
rendering mostly-2D content.

**What it costs, honestly:**

| Cost | Severity |
|---|---|
| Text quality becomes hard (§7) | **High** — this is the real one |
| Asset pipeline expands to models, materials, environments | High |
| Requires real-time 3D specialists, who are scarce | High |
| Every subsystem carries 3D concepts even for 2D work | Medium |
| Larger runtime, longer cold start | Medium |

The first and third are the ones that can actually derail this. §7 addresses the
first. The third is a hiring problem, not an architecture problem, and it means
[the roadmap's estimates need redoing](./ROADMAP.md).

## 3. WebGPU vs WebGL2 vs hybrid

| | WebGL2 | WebGPU | Hybrid |
|---|---|---|---|
| Availability, browsers | Universal | Broad by 2026 | Universal |
| Availability, OBS CEF | Yes | **Unverified** | Yes |
| Compute shaders | No | Yes | Where available |
| Render-graph friendliness | Poor (global state) | Good (explicit) | Two paths |
| Driver overhead | High | Low | — |
| 10-year outlook | Legacy | **The standard** | Transitional |
| Cost | Baseline | Baseline | Baseline + adapter |

**WebGPU is the correct 10-year target.** It is the standard, it exposes compute
(needed for particles, simulation, and GPU picking done well), and its explicit
resource model suits a render graph. WebGL2's global-state model fights every
production-grade rendering technique.

**WebGL2 remains necessary** because of OBS. This is not "hybrid" in the sense
of mixing APIs in one frame — that would be two renderers and two sets of bugs.
It is one abstraction with two backends, one of which is feature-reduced.

### Feature-tiering, not feature-parity

A single abstraction over two GPU APIs of unequal capability fails if it targets
the intersection. Instead, capability is **tiered**, and the scene format
declares what a scene requires:

| Tier | Requires | Content |
|---|---|---|
| **Baseline** | WebGL2 | Meshes, PBR materials, text, alpha output, camera animation |
| **Advanced** | WebGPU | Compute particles, GPU picking, heavy post, simulation |

A Baseline scene renders identically on both. An Advanced scene declares it and
degrades visibly and predictably — never silently — on WebGL2.

This keeps the OBS constraint from dragging the whole engine down to 2016
capability, which is what targeting the intersection would do.

## 4. Adopt vs build the rasterizer

**The most consequential recommendation in this RFC, and the one most likely to
be resisted, because "the engine is the product" sounds like it implies writing
one.**

### Recommendation: adopt

Use an existing WebGPU-capable engine (Three.js `WebGPURenderer` or Babylon.js)
as the rasterization substrate. Our scene graph remains the source of truth; the
adopted engine holds a derived representation.

### Why

**The industry has already answered this.** Pixotope, Zero Density, and disguise
are broadcast production companies competing at the highest end of virtual
studio work. All three build **on top of Unreal Engine**. None writes a
rasterizer. Their product is the production layer — tracking integration,
keying, control surfaces, workflow — exactly the layer
[ENGINE_ARCHITECTURE §2](./ENGINE_ARCHITECTURE.md#2-layers) identifies as ours.

**The renderer is not the differentiator.** Nobody chooses a production system
because its PBR implementation is better. They choose it because it does not
fail on air, the operator workflow is fast, and it integrates with their data.

**The cost of building is measured in years.** Meshes, materials, lighting,
shadows, skinning, instancing, GPU memory management, WebGPU/WebGL2 parity, and
a shader system — before a single frame of product value. For a team that must
also build a production layer, an editor, a control surface, and a live
transport.

**The 10-year test cuts the same way.** In ten years, a hand-written 2026
WebGPU renderer is a maintenance liability maintained by whoever remains.
Three.js and Babylon will have absorbed a decade of browser evolution.

### What "adopt" does not mean

- **Not** exposing the engine's types through our API. It sits behind our
  backend interface. Swapping it is a contained project, not a rewrite.
- **Not** letting it own the scene. Our document is authoritative; its object
  graph is a cache that can be rebuilt from scratch at any frame.
- **Not** accepting its text rendering. §7 is ours regardless.

### When building would be right

If profiling proves the adopted engine cannot meet §9's frame budget and the
cause is architectural rather than our usage. That is a finding, not an
assumption — and none of the alternatives are fast enough to justify starting
there.

**Spike required before Phase 2** (E1 in ENGINE_ARCHITECTURE): evaluate both
candidates specifically on transparent output, render-graph/pass control, text
integration, and WebGPU maturity. Those four decide it; general popularity does
not.

## 5. Camera as a first-class concept

Cameras are scene nodes with animatable properties, parented like any other node
([ENGINE_ARCHITECTURE §5](./ENGINE_ARCHITECTURE.md#5-camera-system)). The
renderer receives a camera node reference per output, never a global "view".

This matters structurally because a production engine renders **the same scene
through different cameras simultaneously** — programme and preview, or a video
wall and a broadcast feed. A camera stored as renderer state rather than scene
state makes that a special case instead of the default.

## 6. Render graph

Passes are declared and composed rather than hard-coded:

```
shadow → opaque → transparent → post → alpha-composite → output
```

Required because the engine must support: multiple simultaneous outputs with
different cameras, offscreen targets for texture-mapped screens inside a scene
(a video wall in a virtual set), the GPU picking pass (editor only), and
post-effect chains that vary per scene.

**Alpha compositing is an explicit pass with a defined blend convention.**
Premultiplied alpha throughout, converted at output only if a target requires
straight alpha. Getting this wrong produces dark fringes on every edge over
video — a defect that looks like a design problem and is actually a maths one.

## 7. Text — the largest technical risk

> ## ⚠️ THIS SECTION IS REVERSED — DO NOT IMPLEMENT FROM IT
>
> **Superseded 2026-07-30 by
> [ARCHITECTURE_FINAL_REVIEW C1/R1](./ARCHITECTURE_FINAL_REVIEW.md#c1--text-pipeline-breaks-determinism--critical--reverses-a-documented-decision).**
>
> The dual-path design below routes screen-space text through Canvas2D and
> complex-script shaping through "the platform shaper". **Both depend on the
> host platform's text engine, which differs across our four runtime targets** —
> Chrome, OBS's CEF, a headless cloud renderer, and the native runtime. The same
> scene therefore *lays out* differently depending on where it renders, which
> breaks the state-determinism guarantee in
> [ENGINE_ARCHITECTURE §4](./ENGINE_ARCHITECTURE.md#4-runtime). Text layout —
> line breaks, fit-to-box results, glyph advances — is engine state, not pixels.
>
> **Replacement: a single owned pipeline, no platform text engine anywhere.**
>
> ```
> font binary (WOFF2/TTF)
>    → our parser (outlines, metrics, GPOS/GSUB)
>    → HarfBuzz (WASM) shaping — one version, shipped with us
>    → our SDF/MSDF rasterizer → dynamic atlas
>    → geometry + atlas texture → render adapter
> ```
>
> This is *simpler* than what it replaces — one pipeline instead of two, one
> selection rule fewer, one class of cross-target bug eliminated. Cost: no
> platform hinting at small sizes, which is acceptable because broadcast text is
> large and transparent output already forces grayscale AA.
>
> The material below is retained only for the analysis that survives: the
> transparency/AA argument, the CJK dynamic-atlas requirement, and font loading
> as a determinism problem.


**Carried forward from [RFC-001 §4](./RFC-001-rendering-architecture.md#4-text-rendering-strategy),
still true:** our output is transparent, so subpixel antialiasing is impossible
for everyone. Every approach uses grayscale AA. No option has a quality
advantage from that direction.

**What changed:** Canvas2D gave us the platform's text engine for free.
GPU-first gives that up, and broadcast graphics are ~80% text. This is where
3D-first genuinely hurts.

### Dual-path

Neither approach alone is sufficient, so both are architecture, not fallback:

| Path | Used for | Mechanism | Trade-off |
|---|---|---|---|
| **Raster** | Screen-space 2D text — lower-thirds, scoreboards, tickers | Rendered via Canvas2D into a texture, drawn as a quad | Perfect native quality, full script support; re-rasterises on size change; unsuitable for 3D placement |
| **MSDF** | World-space and 3D text, animated scaling | Multi-channel signed-distance atlas | Scales and rotates crisply; struggles with very small text, thin faces, and large glyph sets |

**Selection is automatic, not authored.** Screen-space, unscaled text takes the
raster path; anything transformed in 3D or scaled over time takes MSDF. Authors
do not choose a rendering technique — an author-facing decision here would be a
leaked implementation detail.

### CJK and complex scripts

MSDF atlases assume a bounded glyph set. CJK has thousands; esports is global.
**Dynamic atlas allocation with LRU eviction** is required, not optional, and it
is the specific thing likely to be discovered too late. Arabic and Indic
shaping must go through the platform shaper (raster path) or HarfBuzz — MSDF
alone does not solve shaping, only rasterization.

### Fonts remain a determinism problem

Carried forward unchanged: fonts are declared assets, loaded and awaited before
the first painted frame, with a defined visible failure rather than silent
substitution.

## 8. OBS compatibility — reframed

RFC-001 treated OBS's embedded CEF as the defining constraint. **Under the
production-OS vision that is no longer correct**, and continuing to treat it so
would cap the engine at the capability of the weakest embedding of a browser
inside a free streaming tool.

Correct framing: **OBS browser source is one output target among several**
([ENGINE_ARCHITECTURE §12](./ENGINE_ARCHITECTURE.md#12-live-output)), and the
least capable. It gets the Baseline tier over WebGL2.

But it is also how the first hundred users arrive, so it is not optional:
Baseline must be genuinely good, not a degraded courtesy. The verification task
from RFC-001 stands — probe real OBS versions in Phase 3 week 1 — with the
result now determining which *tier* OBS gets, not which architecture we build.

## 9. Performance

| Metric | Target |
|---|---|
| Frame budget @ 60fps | 16.6ms; **< 10ms** engine + render, leaving encoder headroom |
| Dropped frames, 60-minute run @ 1080p60 | **Zero** |
| VRAM, typical broadcast scene | Budgeted and enforced, with eviction |
| Memory growth over 60 minutes | Flat |
| Cold load to first frame | < 2s for a typical scene |

Measured on mid-range hardware with an encoder running concurrently. The frame
harness is built in Phase 3 week 1, before the renderer — a bar established
after the fact is a bar that moves.

## 10. Cloud rendering

Server-side rendering ([Phase 15](./ROADMAP.md#phase-15--cloud-platform)) is
served by this architecture, with one caveat that must be stated now.

Headless WebGPU on a server GPU runs the same engine core, driven by a frame
counter instead of `requestAnimationFrame`. That works because the runtime is a
pure function of `(document, variables, time)`
([ENGINE_ARCHITECTURE §4](./ENGINE_ARCHITECTURE.md#4-runtime)).

**The caveat:** cloud output will not be pixel-identical to a local preview,
because different GPUs rasterize differently. Cloud rendering must be sold and
specified as *state*-equivalent, never *pixel*-equivalent. Promising the latter
is a support burden that cannot be discharged.

## 11. What this RFC does not decide

- Which engine to adopt — spike E1, before Phase 2
- Scene schema — [SCENE_FORMAT.md](./SCENE_FORMAT.md)
- Edit and history model — [RFC-002](./RFC-002-scene-document-model.md), unchanged
- Native runtime for SDI/NDI — [ENGINE_ARCHITECTURE §12](./ENGINE_ARCHITECTURE.md#12-live-output)

## 12. Open items

| # | Item | Owner | Due |
|---|---|---|---|
| R5 | Adopt-vs-build spike on the four criteria in §4 | Engineering | Before Phase 2 |
| R6 | Probe WebGPU across real OBS versions; determines OBS's tier | Engineering | Phase 3 wk 1 |
| R7 | MSDF quality trial at broadcast sizes, including CJK atlas eviction | Engineering | Phase 3 |
| R8 | Confirm premultiplied-alpha convention end-to-end through OBS | Engineering | Phase 3 |
| R9 | Frame-drop harness, built before the renderer | Engineering | Phase 3 wk 1 |
