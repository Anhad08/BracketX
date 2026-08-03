# IF-006 — The RTGFX Asset System is right, and it is eight subsystems

**Date:** 2026-08-03 · **Raised by:** the RTGFX Asset System milestone
**Status:** **PROCEEDING ON THE FOUNDATION. FOUR SUBSYSTEMS REFUSED.**
**Decision required:** the order the remaining four are funded, and one
disagreement with the brief (§6).

---

## 1. Why this Finding exists

The brief says, twice, in its own words:

> If a feature cannot be implemented to production quality, stop and raise a
> Finding rather than introducing a temporary implementation.

> Do not build temporary implementations. Do not build placeholder systems. Do
> not build "good enough" versions that will later require replacement.

Taken seriously, those two sentences are incompatible with delivering the whole
brief in one milestone — and taking them seriously is the point. This Finding
says which parts can be built permanently now, which cannot, and why, so the
answer is a schedule rather than a shallow version of everything.

**The architecture in this milestone is designed for all of it.** What is
deferred is deferred behind ports that already exist, not behind a rewrite.

---

## 2. What the brief asks for, sized honestly

| Subsystem | Verdict | Why |
| --- | --- | --- |
| **Asset identity, registry, references, residency** | ✅ **Build now** | This is the permanent core. Everything else plugs into it |
| **Local + cloud-shaped storage** | ✅ **Build now** | A port with a local implementation. Cloud implements the same port |
| **Codec architecture** | ✅ **Build now** | PNG today; JPEG/WebP/AVIF/SVG/glTF are registrations, not surgery |
| **Mipmaps & filtering quality** | ✅ **Build now** | Needs an ADR-013 amendment. Raised as Amendment 2, not worked around |
| **User import → asset → on air** | ✅ **Build now** | The capability a broadcaster actually asked for |
| **JPEG / WebP** | ⚠️ **Deferred, unblocked** | Decoders, not architecture. A week each, behind the codec port |
| **SVG** | ❌ **Refused today** | §3 |
| **Video** | ❌ **Refused today** | §4 |
| **Audio** | ❌ **Refused today** | §5 |
| **3D / glTF / PBR / HDRI** | ❌ **Refused today** | §5 |
| **Cloud sync, versioning, conflicts** | ❌ **Refused today** | §7 |

---

## 3. SVG is not a decoder, and calling it one is the trap

The brief asks for paths, groups, fills, strokes, gradients, clip paths, masks,
symbols, patterns, text, viewBox and responsive scaling, with **"no raster
fallback unless explicitly chosen."**

That last clause is the whole problem, and it is correct. It means SVG cannot be
implemented as "decode to pixels at some size", because a vector asset that
rasterises at one size is a raster asset with extra steps — it degrades exactly
where the brief says it must not.

Real vector support is one of two things, and they are different engines:

1. **Tessellation to geometry.** Path flattening, stroke expansion with joins
   and caps, and a fill rule — which means a polygon triangulator handling
   self-intersection and holes. Gradients become vertex attributes or a
   generated texture. Masks and clip paths become stencil work, which the
   frozen `MirrorBackend` has no concept of.
2. **Signed-distance rendering per path**, which is the MSDF argument again and
   handles strokes and gradients poorly.

Either is comparable in size to the entire text engine — and the text engine
took a phase. Neither can be reached by extending the image codec, which is
precisely why shipping "SVG support" that rasterises at import would be the
throwaway code the brief forbids.

There is also a `MirrorBackend` question underneath it: clip paths and masks
need stencil or a render target per mask, and that is an ADR-013 conversation,
not an implementation detail.

**Recommendation:** SVG is its own milestone, after the 3D viewport, and it
starts with the tessellate-vs-distance-field decision written down as an ADR.

---

## 4. Video is a clock problem, not a format problem

SCENE_FORMAT has video as **Reserved** with the note "needs the native runtime",
and that note is the finding in miniature.

The brief asks for frame accuracy, timeline synchronisation, seeking, playback
rate and future alpha video. Every one of those is about **whose clock wins**.
The engine has a deterministic frame clock; a decoder has a presentation
timestamp; they do not agree, and reconciling them is the subsystem:

- `HTMLVideoElement` is the easy answer and is not frame-accurate. It does not
  exist on two of four targets, seeking is approximate, and `currentTime` is not
  a frame index. A scoreboard cutting to a replay one frame early is a visible
  broadcast error.
- `WebCodecs` is frame-accurate and is the right long-term answer, but it is a
  demuxer away from usable — MP4 and MOV need container parsing before a single
  frame reaches a decoder — and its availability differs across our targets.
- Alpha video is a fourth channel most containers cannot carry, so it is a
  codec-and-container decision (VP9/VP8 alpha, HEVC with alpha, or a
  side-by-side matte convention) that determines what a designer may export.

Determinism is non-negotiable per the brief. A video subsystem that cannot state
which frame it will show at frame N does not meet that bar, and one that can is a
phase of work.

**Recommendation:** video follows the same shape text did — a Finding-led design
phase that picks the clock model first, then a `VideoProvider` port.

---

## 5. Audio and 3D are each a phase, for shorter reasons

**Audio** has no engine at all today: no mixer, no output device abstraction, no
sample clock. The brief asks for waveform generation, cue points, trim, fade and
timeline synchronisation — a timeline-synchronised mixer is a subsystem, and
"decode an MP3" is the smallest part of it. There is also no `MirrorBackend`
concept for it, correctly, because audio is not a render concern.

**3D / glTF** is closer than it looks and still not close. `meshRenderer` renders
generated primitives; the asset-backed path attaches nothing. glTF brings a
parser, buffer views, accessors, skinning, animation channels, PBR materials
with five texture slots, and a node hierarchy that must map onto ours. The
`MirrorBackend` has one material kind for lighting today. Most of this is
render-adapter work behind an ADR conversation about PBR.

Both are real, both are wanted, and neither is a corner of an asset milestone.

---

## 6. One disagreement with the brief, stated plainly

The brief lists an Asset Browser with ~20 categories including **Videos, Audio,
3D, Materials**.

Phase 3A settled a rule that this milestone should not quietly break: **a tool
exists only when the engine can draw what its name says.** IF-005 applied it
again — "an Assets panel with empty Images / Video / Audio tabs… a tab that is
always empty teaches a user to distrust the panel."

Shipping those categories now would be a placeholder system, which the same
brief forbids in its opening lines. The two instructions genuinely conflict and
I have resolved it toward the stronger one: **the browser ships the categories
that are real, and names the rest as coming, in one line, rather than mocking
them.**

If the intent was the opposite — visible categories as a roadmap signal to
customers — that is a reasonable product call and I will take it, but it should
be made deliberately rather than by me inferring it.

---

## 7. Cloud: designed for, not pretended

"Never design the asset system assuming only local storage" is a design
constraint this milestone can and does honour: storage is a **port**, assets are
**content-addressed**, and records carry origin and version fields, so a cloud
store is another implementation rather than a migration.

What is not built is synchronisation, because the platform junction does not
exist yet: `packages/auth`, `packages/db` and `packages/core` are real and
Studio imports none of them. Sync, conflict resolution, team libraries and
entitlements all sit on the far side of that junction. Building a sync engine
against no account model would be the definition of code that needs replacing.

**Recommendation:** the Studio↔platform junction is its own milestone and it
gates every cloud item in this brief.

---

## 8. What this milestone therefore delivers

The permanent core, complete:

- **Content-addressed identity.** An asset IS its bytes. Dedup is a consequence,
  not a feature.
- **`AssetStore` port** with local and in-memory implementations. Cloud is a
  third.
- **`AssetCodec` registry.** Formats are registrations. Adding JPEG touches no
  projection code.
- **Reference counting and residency** with a real budget and refusal semantics.
- **Usage, dependency and health tracking** — broken references, unused assets,
  duplicates — computed over documents rather than guessed.
- **Mipmaps**, via ADR-013 Amendment 2, because the brief asks for correct
  mipmapping and getting it required reopening the boundary.
- **User import**, so a broadcaster's own logo goes on air.

Everything refused above plugs into that core without changing it. That is the
claim this milestone is making, and the reason it is worth making carefully.
