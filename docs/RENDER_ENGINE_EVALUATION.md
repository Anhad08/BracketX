# Render Engine Evaluation — Adopt vs Build

**Status:** Recommendation · **Authored:** 2026-07-30 · **Owner:** @Pixelborne
**Gate:** final architectural decision before Phase 2
**Companions:** [ENGINE_ARCHITECTURE.md](./ENGINE_ARCHITECTURE.md) · [RFC-003](./RFC-003-rendering-architecture-3d.md)

---

## 1. Recommendation

# Adopt Three.js.

Rasterization, materials, lighting, and GPU resource management are delegated to
Three.js (`WebGPURenderer` with automatic WebGL2 fallback). BracketX owns the
scene document, the runtime, the render graph above the renderer, and — this is
not a footnote — **the entire text system**.

No hedge, and the confidence is uneven by design: **high** on adopt-over-build,
**moderate** on Three-over-Babylon. §9 defines exactly what would reverse the
second, and §11 defines the empirical tests that must run before Phase 2 spends
real money on it.

## 2. Three challenges to the evaluation brief

You asked to be challenged. Three things in the brief are wrong or incomplete.

### 2.1 "Ignore ecosystem size" — right in general, wrong in one specific way

Star counts and tutorial volume are noise. Agreed, and ignored.

But **the existence of a proven solution to your single hardest problem is
architectural evidence, not popularity**. `troika-three-text` is not "ecosystem"
— it is a working implementation of dynamic, on-the-fly SDF atlas generation
with bidirectional layout and Unicode fallback, which is precisely the problem
that decides whether broadcast text works for a global esports audience. That it
exists on one engine and not the other is a fact about *risk*, not about
*mindshare*.

Discarding it as ecosystem noise would have led to the wrong answer.

### 2.2 The criteria omit the one that matters most over ten years

Every listed criterion asks *what can the engine do*. For a company whose
product **is** the engine layer, the more important question is the inverse:

> **How much of this engine will we be actively bypassing?**

Every subsystem the substrate provides that we are also building is either dead
weight or a coupling risk. We are building our own animation system, our own
scene serialization, our own variable and timeline systems, our own text, and
our own render graph. An engine that provides opinionated versions of those is
not more valuable to us — it is *less*.

This inverted criterion is added as §6 and it is load-bearing in the decision.

### 2.3 "Adopt vs build" is a false binary at the layer that matters most

Neither engine ships broadcast-grade text. We will **build** text regardless of
which we adopt. So the honest recommendation is not "adopt" — it is:

> **Adopt for geometry, materials, lighting, and GPU resource management.
> Build the text system, the render graph, and the runtime.**

Treating this as a single adopt/build switch would hide the largest piece of
engineering in Phases 3–5.

## 3. Candidates

| Candidate | Status |
|---|---|
| **Three.js** | Evaluated — recommended |
| **Babylon.js** | Evaluated — strong, and genuinely better on two criteria |
| PlayCanvas | Excluded: engine and editor are coupled in a way that fights our owning the scene graph; smaller independent-runtime story |
| wgpu / Rust via WASM | This *is* "build our own" with extra steps. Covered in §8 |
| Filament, Unreal Pixel Streaming | Excluded: not browser-native runtimes; Pixel Streaming makes rendering a server dependency, which contradicts browser-as-runtime |

## 4. Rendering

| | Three.js | Babylon.js |
|---|---|---|
| WebGPU status | `WebGPURenderer` production-ready since r171; stable track through 2026 | Mature; 9.0 adds clustered and volumetric lighting on WebGPU |
| WebGL2 fallback | **Automatic, same code path** | Graceful, with feature fallbacks |
| Shader portability | **TSL compiles one source to WGSL and GLSL** | Node Material Editor; separate WebGPU paths in places |
| Render graph | Node-based post pipeline; MRT; `outputNode` hot-swappable | **Frame Graph v1 (9.0) — full DAG, visual editor, ~40% GPU memory savings** |
| Offscreen targets | Render targets, MRT | Render targets, MRT, managed by Frame Graph |
| Transparent output | `alpha: true`, clear alpha 0 — well-trodden | Supported |
| Multi-pass | Manual composition | Declarative via Frame Graph |

**Babylon wins render-graph flexibility outright.** Its Frame Graph is a real
DAG with automatic resource aliasing and a visual editor, shipped as a v1
feature in 9.0. Three.js has nothing equivalent at that level of formality.

**Three.js wins shader portability outright.** TSL writes once and compiles to
both WGSL and GLSL, with automatic WebGL2 fallback on the same code. That maps
directly onto the Baseline/Advanced tiering in
[RFC-003 §3](./RFC-003-rendering-architecture-3d.md#3-webgpu-vs-webgl2-vs-hybrid)
— one shader source, two backends, no parallel maintenance. For a two-backend
product this is worth more than it first appears, because the alternative is
maintaining divergent shader paths for a decade.

## 5. Text — the deciding criterion

You elevated text to first-class. It decides this evaluation.

| | Three.js (`troika-three-text`) | Babylon.js (native MSDF `TextRenderer`) |
|---|---|---|
| Technique | SDF, generated at runtime | MSDF, pre-generated atlas |
| **Glyph atlas** | **Generated on-the-fly per glyph, from the font file** | **Pre-baked via an offline converter** |
| Font parsing | Parses `.ttf`/`.otf`/`.woff` directly | Converter toolchain, offline |
| **CJK** | **Works — atlas grows on demand** | **Structurally problematic — thousands of glyphs must be pre-baked** |
| Bidi / RTL | Yes | Not evidenced |
| Arabic joining | Yes | Not evidenced |
| Unicode fallback fonts | Automatic | Not evidenced |
| Threading | Parsing, SDF generation, layout in a Web Worker | Offline |
| SDF generation | GPU-accelerated, with JS worker fallback | N/A |
| Quality at scale | Crisp; standard-derivative AA | Crisp; MSDF preserves corners better |

**This is the finding that decided the recommendation.**

[RFC-003 §7](./RFC-003-rendering-architecture-3d.md#7-text--the-largest-technical-risk)
identified CJK atlas explosion as "the specific thing likely to be discovered
too late." Pre-baked MSDF atlases assume a bounded glyph set. Esports is global;
a Korean or Japanese player name is not an edge case, it is Tuesday. An engine
whose text story requires knowing every glyph in advance is not viable for this
product without replacing its text system.

Babylon's MSDF renderer is good — MSDF preserves sharp corners better than plain
SDF, and forum reports of artifacts resolving with higher-resolution source
atlases are consistent with a well-understood pre-baked workflow. It is simply
the wrong *shape* of solution for unbounded glyph sets.

**Caveat, stated plainly:** troika is a third-party library with its own
bus-factor risk. Its value here is as much *proof the technique works and a
reference implementation to learn from* as it is a dependency. Per §2.3 we are
building text ourselves regardless; starting from a working dynamic-atlas
implementation rather than a pre-baked one is worth roughly a phase of schedule.

## 6. Surface area we would bypass — the inverted criterion

| Subsystem | We are building it | Three.js provides | Babylon provides |
|---|---|---|---|
| Scene document / serialization | **Yes** | Minimal (`Object3D` tree) | Full scene serialization, `.babylon` format |
| Animation system | **Yes** | Minimal clips/mixer | Full animation system, groups, blending |
| Timeline | **Yes** | None | Partial (animation groups) |
| Variables / data binding | **Yes** | None | None |
| GUI / 2D layer | **Yes** (screen-space) | None | Full GUI system |
| Render graph | **Yes** | Primitives | **Full Frame Graph** |
| Text | **Yes** | None (troika is separate) | Native MSDF |
| Physics, audio, XR, particles | No | Not bundled | Bundled |

Three.js's minimalism is the point. Babylon would have us carrying — and
routing around — a scene serializer, an animation system, and a GUI layer that
directly duplicate what
[ENGINE_ARCHITECTURE §2](./ENGINE_ARCHITECTURE.md#2-layers) defines as *our*
engine core.

The Frame Graph is the sharpest instance of this tension: it is Babylon's best
feature and simultaneously the deepest coupling risk. Adopting it means our
render graph *is* Babylon's, and swapping engines later means reimplementing a
frame graph rather than re-pointing an adapter. **Its strength here is also its
lock-in.**

## 7. Scene integration, camera, picking

**Both** engines are mutable object trees we synchronise into, and **neither**
threatens document ownership. The BracketX document is JSON; it never imports a
renderer type. The renderer's tree is a **rebuildable cache** — discardable and
reconstructible from the document at any frame.

| | Three.js | Babylon.js |
|---|---|---|
| Perspective / orthographic | Both first-class | Both first-class |
| Multiple cameras | `render(scene, camera)` per output — trivial | Multiple cameras with viewports |
| Camera animation | Cameras are `Object3D` — animate like anything | Cameras are nodes |
| Layers | `Object3D.layers` bitmask | Layer masks |
| Viewports | Scissor/viewport per render | Native viewport support |
| CPU picking | `Raycaster`, geometry-based | `scene.pick` |
| **GPU picking** | **Build it** (ID buffer to render target) | Available in newer versions |
| Gizmos | `TransformControls` — usable as reference, not as product | Gizmo manager |

Neither engine's gizmos or picking are production-grade for a broadcast editor,
and both bind to their own object model. **Picking and gizmos are ours**, per
[ENGINE_ARCHITECTURE §10](./ENGINE_ARCHITECTURE.md#10-input-and-picking) — GPU
ID-buffer picking is required anyway, because raycasting source geometry
silently disagrees with the screen for instanced and shader-displaced content.

Babylon shipping GPU picking is a modest schedule saving, not an architectural
advantage.

## 8. Why not build our own

Rejected, with the reasoning stated rather than assumed.

**What building actually means:** a WebGPU and WebGL2 abstraction, PBR
materials, shadow mapping, skinning, instancing, GPU memory and buffer
management, a shader system with cross-backend compilation, culling, and glTF
import. Conservatively **2–4 engineer-years before a single frame of product
value**, for a team that must also build the production layer, editor, control
surface, live transport, and first application.

**It does not buy differentiation.** Nobody selects a production system because
its PBR implementation is better. They select it because it does not fail on
air, the operator workflow is fast, and it binds to their data.

**The precedent is unambiguous.** Pixotope, Zero Density, and disguise compete
at the highest end of virtual production. All three build on Unreal. None writes
a rasterizer.

**The 10-year test cuts against building, not for it.** A hand-written 2026
WebGPU renderer becomes a decade of browser evolution absorbed by whoever
remains on the team. Three.js and Babylon absorb that cost across thousands of
users. "We own it" is only an advantage while someone is funded to own it.

**When building becomes right:** if profiling proves the adopted engine cannot
meet [RFC-003 §9](./RFC-003-rendering-architecture-3d.md#9-performance)'s frame
budget for architectural reasons rather than our usage. That is a finding to be
earned, not a starting assumption — and the incremental path is replacing the
*backend* behind our seam (§10), never rewriting the engine.

## 9. Where Babylon would win — and what would reverse this

Honest scoreboard: **Babylon is better on two criteria** and it is not close on
either.

1. **Frame Graph.** A real DAG with resource aliasing and a visual editor. We
   will build a thinner version of this ourselves on Three.
2. **Babylon Native.** A native host for Babylon content, directly relevant to
   the native runtime reserved in
   [ENGINE_ARCHITECTURE §12](./ENGINE_ARCHITECTURE.md#12-live-output). Three.js
   has no equivalent.

Also in Babylon's favour: stricter semantic versioning and lower breaking-change
churn than Three.js's monthly `r`-releases, and corporate backing that funds
documentation and support.

**This decision reverses if any of the following proves true in the spike:**

- Dynamic-atlas text on Three.js cannot hit broadcast quality at 1080p, **and**
  Babylon's MSDF path can be extended to dynamic atlases more cheaply than
  building ours
- Three.js `WebGPURenderer` shows instability under sustained 60-minute
  broadcast load that Babylon does not
- Composing our render graph on Three's primitives proves to cost more than the
  coupling we would accept by using Babylon's Frame Graph
- The native runtime becomes a launch requirement rather than post-launch, at
  which point Babylon Native's value rises sharply

## 10. Migration strategy — keeping the backend replaceable

Replaceability is achieved by **placing the seam correctly and keeping it thin**,
not by an elaborate abstraction. A perfect wrapper over a renderer costs
performance and velocity and is itself a maintenance burden.

### Coupling policy, by layer

| Layer | Coupling | Rule |
|---|---|---|
| Scene document | **Zero** | Plain JSON. Never imports a renderer type. Enforced by lint. |
| Engine core (runtime, variables, timeline, animation) | **Zero** | Operates on the document; emits a backend-neutral draw list |
| Render adapter | **Total, deliberately** | The only module that imports Three.js |
| Text system | **Minimal** | Emits geometry and atlas textures; substrate-agnostic |
| Editor / applications | **Zero** | Talk to the engine core, never the renderer |

### The seam

The engine core produces a **backend-neutral draw list** — resolved transforms,
material handles, text runs, camera state, pass declarations. The render adapter
translates that into Three.js objects and holds them as a cache keyed by node
id, rebuildable from scratch at any frame.

**Enforced mechanically, not by discipline:** an ESLint rule forbids importing
`three` outside `packages/render-three`, in the same way `server-only` now
prevents the client-bundle leak recorded in
[ADR-008](./ARCHITECTURE.md#adr-008). A rule that is only in a document is not a
rule.

### The cost of switching, sized

The render adapter is estimated at **3–5k lines**. Replacing it — Babylon,
a future engine, or our own — is a **4–8 week project**, not a rewrite, provided
the seam holds. That number is the actual measure of lock-in, and it is the
number to re-check whenever the adapter grows.

**What is deliberately *not* abstracted:** shader authoring. TSL is Three-
specific and wrapping it would forfeit the cross-backend compilation that makes
it valuable. Shaders are accepted as portable-by-rewrite, and there will not be
many.

## 11. This is a paper evaluation — the empirical spike still must run

**Stated plainly: the above is an architectural and literature evaluation, not a
benchmark.** Nothing here was measured. Before Phase 2 commits, these five tests
must run, timeboxed to two weeks:

| # | Test | Pass condition |
|---|---|---|
| T1 | Transparent 1080p60 output through a real OBS browser source, both engines | Correct premultiplied alpha, no edge fringing |
| T2 | Dynamic-atlas text: 200 mixed Latin/CJK/Arabic strings, live-updating | Legible at broadcast sizes; atlas eviction stable; no frame spikes |
| T3 | 60-minute sustained run with an encoder active | Zero dropped frames; flat memory |
| T4 | Multi-pass: two cameras, an offscreen target, a picking pass | Composable without fighting the engine |
| T5 | Rebuild the renderer cache from the document mid-run | No visual discontinuity; proves the cache is genuinely derived |

**T2 is the one that decides it.** If it fails on Three.js, §9's reversal
conditions apply and Babylon deserves a second look.

## 12. Risk assessment

### Technical

| Risk | Severity | Mitigation |
|---|---|---|
| Broadcast-grade text is harder than the literature suggests | **High** | T2 first, before any other Phase 3 work. Text is the product. |
| Three.js `WebGPURenderer` immaturity under sustained load | Medium | T3. WebGL2 path is the fallback; TSL means one shader source either way |
| Our render graph on Three primitives proves insufficient | Medium | T4. Escape hatch is §9's reversal to Babylon's Frame Graph |
| GPU picking must be built | Low | Well-understood technique; editor-only, off the on-air path |

### Vendor

| Risk | Severity | Note |
|---|---|---|
| Three.js has no corporate owner; bus factor on core maintainers | Medium | Also a *benefit*: no single actor can deprioritise it. Diffuse ownership is more durable over ten years than corporate sponsorship, which historically ends on a strategy change |
| `troika-three-text` becomes unmaintained | **Medium-High** | MIT and self-contained; forkable. We own text regardless (§2.3), so this is a schedule risk, not an architectural one |
| Babylon's direction follows Microsoft's priorities | N/A here | Relevant only if §9 reverses the decision |

### Performance

| Risk | Severity | Mitigation |
|---|---|---|
| Cannot hit < 10ms with an encoder competing for GPU | **High** | T3 on mid-range hardware, not a dev machine. Harness built before the renderer |
| Text atlas churn causes frame spikes | Medium | T2; pre-warm atlases at scene load, before air |
| WebGL2 Baseline tier too slow for complex scenes | Medium | Tiering is explicit; scenes declare their tier and warn rather than degrade silently |

### Lock-in

| Risk | Severity | Mitigation |
|---|---|---|
| Renderer types leak into the engine core | **High if unchecked** | Lint-enforced import boundary; §10 |
| TSL shaders are Three-specific | Low, accepted | Few shaders; portable by rewrite |
| Adapter grows past 5k lines and switching cost balloons | Medium | Track adapter size as a tracked metric, reviewed each phase |

### Maintenance

| Risk | Severity | Mitigation |
|---|---|---|
| Three.js `r`-release breaking changes, monthly | **Medium-High, ongoing** | Pin exact versions; upgrade deliberately on a schedule; the adapter concentrates breakage in one module |
| TSL migration as Three moves off raw GLSL | Low | Start TSL-first; we have no legacy GLSL |
| We now own text, picking, gizmos, and the render graph | **High, by choice** | This is the deliberate trade in §2.3. It is the work that makes BracketX a production engine rather than a Three.js wrapper |

## 13. Decision record

Recorded as [ADR-012](./ARCHITECTURE.md#adr-012). Revisit when any §9 condition
is met, or if the render adapter exceeds 5k lines.

## Sources

- [Announcing Babylon.js 9.0](https://blogs.windows.com/windowsdeveloper/2026/03/26/announcing-babylon-js-9-0/)
- [Babylon.js Frame Graph documentation](https://doc.babylonjs.com/features/featuresDeepDive/frameGraph/)
- [Babylon.js MSDF Text documentation](https://doc.babylonjs.com/addons/msdfText/)
- [Babylon.js forum — MSDF Text renderer](https://forum.babylonjs.com/t/msdf-text-renderer/58406)
- [three.js WebGPURenderer docs](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Migrate Three.js to WebGPU (2026)](https://www.utsubo.com/blog/webgpu-threejs-migration-guide)
- [Field Guide to TSL and WebGPU](https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/)
- [troika-three-text](https://github.com/protectwise/troika/tree/main/packages/troika-three-text)
- [three.js WebGPU multiple render targets example](https://threejs.org/examples/webgpu_multiple_rendertargets.html)
