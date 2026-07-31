# BracketX Engine Architecture

**Status:** Canonical · **Authored:** 2026-07-30 · **Owner:** @Pixelborne
**Supersedes as top-level technical document:** [ARCHITECTURE.md](./ARCHITECTURE.md)
(which remains authoritative for the *platform* — auth, tenancy, persistence, deployment)

> BracketX is a real-time 3D broadcast and event production engine. Tournament
> management, sports, podcasts, conferences, and corporate events are
> **applications built on the engine**, not the engine's purpose.
>
> This document defines the engine's layers and the boundaries between them.
> Every subsystem document ([RFC-003](./RFC-003-rendering-architecture-3d.md),
> [SCENE_FORMAT.md](./SCENE_FORMAT.md)) refines a layer named here.

---

## 1. What "the engine is the product" does and does not mean

It means: the scene graph, runtime, variable system, timeline, and live control
are the durable asset. Applications are configurations and UIs over them.

It does **not** mean we write a renderer. §6 argues that at length. The industry
precedent is decisive — Pixotope, Zero Density, and disguise all build broadcast
production systems **on top of Unreal** rather than writing rasterizers. The
renderer is table stakes; the production layer is the moat.

It also does **not** mean we build the engine first and applications later. See
§13.

## 2. Layers

Strictly one-directional. A lower layer never imports from a higher one.

```
┌──────────────────────────────────────────────────────────────┐
│ APPLICATIONS      Tournament · Sports · Podcast · Conference │
│                   Corporate · Live Production                 │
├──────────────────────────────────────────────────────────────┤
│ APPLICATION SDK   Component packs · Templates · Panels        │  ← plugin boundary
├──────────────────────────────────────────────────────────────┤
│ PRODUCTION        Show state · Rundown · Cues · Live control   │
│                   Operator surface · AI director               │
├──────────────────────────────────────────────────────────────┤
│ ENGINE CORE       Scene graph · Runtime · Variables            │
│                   Timeline · Animation · Picking               │
├──────────────────────────────────────────────────────────────┤
│ RENDER            Camera · Render graph · Materials · Text     │
├──────────────────────────────────────────────────────────────┤
│ PLATFORM          GPU backend · Assets · Clock · Output        │
└──────────────────────────────────────────────────────────────┘
```

**The line that matters most is between PRODUCTION and ENGINE CORE.** The engine
knows about scenes, time, and values. It does not know what a match, a speaker,
or an episode is. The moment "bracket" appears in engine code, the engine has
stopped being an engine.

## 3. Scene Graph

The core abstraction. A single hierarchical 3D scene, defined by
[SCENE_FORMAT.md](./SCENE_FORMAT.md).

- **One graph, 3D throughout.** 2D content is not a separate system — it is
  geometry on a plane viewed through an orthographic camera. This is the whole
  reason 3D-first is correct: a 3D graph renders 2D nearly for free, while a 2D
  graph can never become 3D.
- **Nodes are transforms with attachments.** A node has a place in space; what
  it *is* comes from attached components (mesh, text, camera, light).
- **Right-handed, Y-up, metres.** glTF and Blender/Maya/C4D convention. See
  [SCENE_FORMAT §4](./SCENE_FORMAT.md#4-coordinate-system).
- **The document is the source of truth**, not the renderer's object graph. The
  renderer holds a derived representation it can rebuild at any time.

## 4. Runtime

Owns the frame. A **pure function of `(document, variables, time)`**.

```
tick(t):
  resolve   variables + bindings   → concrete values
  evaluate  timeline + animation at t → transform/property overrides
  update    world matrices, bounds, visibility
  cull      frustum + layer
  submit    draw list → render layer
```

Every phase is side-effect free with respect to the document. Nothing
accumulates across frames. Rendering time `t` directly must equal arriving at
`t` by playing forward — this is what makes editor scrubbing, deterministic
replay, and offline cloud rendering the same code path.

### On "deterministic" — a necessary correction

The vision lists deterministic runtime as a principle. Stated precisely, because
the imprecise version is a promise we cannot keep:

- **State determinism — guaranteed.** Same document, variables, and `t` produce
  the same scene state and the same draw submissions, on any machine.
- **Pixel determinism — not guaranteed across hardware.** Different GPUs,
  drivers, and floating-point paths produce different pixels. This is true of
  every real-time 3D engine.

Anything that depends on frame-exact identical output (cloud render matching a
local preview byte-for-byte, for instance) must be specified against state
determinism, not pixel equality.

## 5. Camera System

A first-class node type, not a viewport setting.

- **Cameras are scene nodes** — parented, animated, and driven by variables like
  anything else. A camera on a crane rig is a camera node parented to an
  animated node.
- **Perspective and orthographic**, both first-class. Orthographic is not a
  degraded mode; it is how all 2D graphics render.
- **Multiple cameras per scene**, with an active camera per output. A programme
  output and a preview output can view the same scene from different cameras —
  which is the foundation for multi-camera production later.
- **Camera properties are animatable**: position, rotation, FOV, near/far, DOF
  parameters. Broadcast camera moves are the single most common 3D use in the
  industry.
- **Reserved: tracked cameras.** Virtual studio work (FreeD, stYpe, Mo-Sys
  protocols) drives a camera node from external tracking data. The camera node
  is designed so this is an input source, not a new concept.

## 6. Rendering Pipeline

Defined fully in [RFC-003](./RFC-003-rendering-architecture-3d.md). Summary:

- **WebGPU-first, WebGL2 fallback**, behind a backend abstraction.
- **We do not write the rasterizer.** An existing WebGPU-capable 3D engine
  provides meshes, materials, lighting, and GPU resource management. Our render
  layer is a thin adapter from our scene graph to it.
- **Render graph, not a fixed pipeline**: passes are declared, so post-effects,
  multiple outputs, and offscreen render targets compose.
- **Alpha output is a first-class pass**, not an afterthought — broadcast
  composites over live video.
- **Text is dual-path** (§7 of RFC-003) and is the largest technical risk in
  going 3D-first.

## 7. Animation System

- **Time-addressable, not simulated.** Evaluate at any `t`; no integration, no
  physics, no springs. This follows directly from §4's determinism requirement.
- **Tracks bind to property paths** on nodes, so any property is animatable
  without per-type support.
- **States** (`in`, `idle`, `out`, and author-defined) are independently
  triggerable, because live operation cues them individually.
- **Clips are composable** on the timeline (§8), so a scene can layer a camera
  move over a lower-third reveal.
- **Reserved: skeletal animation and morph targets** — needed for character and
  mascot content, defined in the format so adding them is not a migration.

## 8. Timeline

The engine has **one time model**, used by three consumers that would otherwise
each invent their own:

| Consumer | Uses time for |
|---|---|
| Editor | Scrubbing, previewing, authoring keyframes |
| Live runtime | Playing states triggered by an operator or automation |
| Cloud renderer | Producing frame N offline |

A timeline holds **tracks of clips**; a clip references an animation state with
an offset. The live runtime is a timeline driven by cues instead of a playhead —
the same evaluator either way.

**Timecode** (SMPTE) is reserved as an external clock source. Broadcast
synchronisation eventually requires it, and retrofitting a second clock concept
is far harder than accommodating one now.

## 9. Variable System

The single mechanism for every value not fixed at design time. One mechanism,
not three:

| Source | Example |
|---|---|
| Operator input | Typing a score on the control surface |
| Live data | A scores API pushing a goal |
| Template parameters | A component pack exposing "team colour" |
| Application state | Tournament app writing the current match |

- **Typed and declared** per scene, with defaults.
- **Bindings are a property-value form**, so any property becomes bindable
  without per-type support.
- **Variables are the engine/application seam.** The tournament application does
  not manipulate nodes — it writes variables. That is precisely what keeps
  applications from reaching into the engine's internals.
- **Reserved: expressions** (`$expr`) for computed values, and **variable
  scopes** (scene / project / show) for values shared across scenes.

## 10. Input and Picking

- **GPU-based picking** via an ID buffer pass rather than CPU raycasting.
  Correct for instanced, skinned, and shader-displaced geometry, where raycasts
  against source geometry silently disagree with what is on screen.
- **Editor gizmos** (translate, rotate, scale) operate in world, local, or
  screen space and are engine services, not editor-local code — the control
  surface and future AR tooling need the same maths.
- **Picking is an editor concern only.** The render surface ships no picking
  code, per the bundle-isolation rule in
  [ARCHITECTURE.md §6.2](./ARCHITECTURE.md#62-render-surface).

## 11. Asset Pipeline

3D-first substantially expands this. Assets are no longer "images and fonts".

| Kind | Format | Notes |
|---|---|---|
| Models | **glTF 2.0 / GLB** | Industry standard; do not invent a mesh format |
| Textures | KTX2 / Basis, PNG, JPEG | GPU-compressed where possible |
| Materials | glTF PBR | Extended by our own material definitions |
| Environment | HDR / EXR → prefiltered | Image-based lighting |
| Fonts | WOFF2 + generated atlases | See RFC-003 §7 |
| Video | Reserved | Needs a native runtime; §12 |

- **Ingest is a pipeline, not an upload.** Validate → transcode → generate LODs
  and atlases → content-address → store. A raw 200 MB FBX from a designer must
  become something that loads in under a second on air.
- **Content-addressed by hash**, enabling dedupe and detecting substitution.
- **Streaming and budgets.** A production machine has finite VRAM; the engine
  must know an asset's cost and be able to evict.

## 12. Live Output

**The most under-specified part of the vision, and where a browser stops being
enough.**

| Output | Where it runs |
|---|---|
| Browser source (OBS/vMix) | Browser — available today |
| WebRTC / SRT egress | Cloud service |
| **NDI** | **Native runtime required** |
| **SDI / ST 2110** | **Native runtime + hardware** |
| **Genlock, timecode, tally** | **Native runtime + hardware** |

A browser tab cannot access SDI, genlock, or hardware timecode. If BracketX is
genuinely a production OS rather than a graphics overlay tool, **a native
companion runtime is not optional** — it is a reserved architectural component,
named here so it is designed for rather than discovered.

The engine is authored in the browser and *may* render in the browser. Broadcast
output is a separate deployment target running the same engine core.

## 13. Engine / Application separation

Applications may only touch the engine through:

1. **Variables** — write values, read declarations
2. **Cues** — trigger states, transitions, timeline positions
3. **Templates** — instantiate scenes from parameterised definitions
4. **Events** — subscribe to engine state changes

Applications may **not** manipulate the scene graph directly. If the tournament
application needs to build a bracket node tree, that capability belongs in a
component pack behind the SDK, not in the application.

### The strategy risk, stated plainly

"The engine is the product" is architecturally sound and strategically
dangerous. Building a general engine before one application has paying users is
the classic platform trap: eighteen months of abstraction designed for
imagined consumers, with no feedback loop.

**Recommendation: build the engine *through* the first application, not before
it.** Generality is earned by having two real consumers, not by anticipating
eight. Tournament management ships first and is permitted to expose gaps in the
engine; the second application is what proves the seam is real.

Concretely: nothing in the SDK becomes public API until a second consumer needs
it. A plugin API published before it has been used twice is a promise made in
ignorance.

## 14. Plugin Architecture

- **Component packs** — new node types and parameterised templates. The primary
  extension point, and how vertical applications ship their content.
- **Panels** — editor and control-surface UI extensions.
- **Data sources** — adapters that write variables.
- **Sandboxed.** Third-party code must not reach the render surface's frame
  budget or another tenant's session.
- **Not published until proven.** See §13.

## 15. What this document does not decide

- Rendering backend and text strategy — [RFC-003](./RFC-003-rendering-architecture-3d.md)
- Scene schema — [SCENE_FORMAT.md](./SCENE_FORMAT.md)
- Edit and history model — [RFC-002](./RFC-002-scene-document-model.md) (unchanged; still correct)
- Platform concerns: auth, tenancy, persistence, deployment — [ARCHITECTURE.md](./ARCHITECTURE.md)

## 16. Open items

| # | Item | Owner | Due |
|---|---|---|---|
| E1 | Adopt-vs-build spike: Three.js WebGPURenderer vs Babylon.js, judged on text, alpha output, and render-graph control | Engineering | Before Phase 2 |
| E2 | Confirm the first application is tournament management and that it ships before any SDK is public | Product | Now |
| E3 | Native runtime: decide the trigger and target (NDI first?) and whether it is in-house or a partnership | Product | Post-launch |
| E4 | Re-estimate the roadmap for 3D scope and for the specialist hiring it implies (§13 of ROADMAP review) | Product + Eng | Now |
| E5 | Decide whether tracked-camera protocols are a launch differentiator or a later vertical | Product | Phase 6 |
