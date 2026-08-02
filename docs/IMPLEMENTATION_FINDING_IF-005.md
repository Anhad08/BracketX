# IF-005 — Assets and Marketplace need an asset pipeline that does not exist

**Date:** 2026-08-03 · **Raised by:** Phase 4, Studio as a commercial product
**Status:** **PARTIALLY BLOCKING.** The shell, Home, Developer Mode, content
packs and the 30-second criterion minus one step are all buildable now.
**Decision required:** when to fund the asset pipeline.

---

## 1. What the brief assumes

Two sections of Phase 4 assume asset support:

> **Assets** — Images · SVG · Video · Audio · Models · Fonts · Brand Assets ·
> Textures · Gradients · Materials · Presets
>
> **Marketplace** — Templates · Animation Packs · Transition Packs · Broadcast
> Packages · Brand Packs · Scoreboards · Lower Third Collections · **Stingers** ·
> Widgets · **Icons** · Fonts · **Graphics** — *everything installs instantly*

And the success criterion:

> Within 30 seconds a new user should be capable of: creating a lower third,
> changing colours, **replacing a logo**, editing text, previewing, taking it
> live.

---

## 2. What actually renders

The projector attaches exactly five component types:

```
$ grep -n 'component.type === "' packages/engine-reconciler/src/projection.ts
894:      if (component.type === "camera")       this.#applyCamera(...)
895:      else if (component.type === "rect")    this.#applyRect(...)
896:      else if (component.type === "meshRenderer") this.#applyMesh(...)
897:      else if (component.type === "light")   this.#applyLight(...)
898:      else if (component.type === "text")    this.#applyText(...)
```

`image` and `video` are declared in SCENE_FORMAT §7 and **nothing implements
them**. `meshRenderer` renders generated primitives only; the asset-backed path
(`assetId`, `meshIndex`) attaches nothing, as its own doc comment says.

Against the brief's asset list:

| | Status |
| --- | --- |
| **Fonts** | ✅ Phase 3B. Loaded as binaries, parsed by us |
| **Materials, Gradients** | ⚠️ As colours and design tokens. No gradient component exists |
| **Presets** | ✅ Motion presets, Phase 3A |
| **Images, SVG, Video, Audio, Models, Textures, Brand assets** | ❌ **None.** No loader, no decoder, no cache, no budget accounting |

There is a `TextureHandle` and a `createTexture` on the frozen backend — Phase 3B
uses it for the glyph atlas — so the *boundary* is ready, exactly as it was for
text. What is missing is everything above it: fetching, decoding, colour-space
handling, mipmaps, budget accounting, eviction, and the format work to reference
an image from a node.

---

## 3. What this blocks, precisely

**Blocked:**

- The Assets browser, for seven of its eleven categories.
- Marketplace **Icons, Stingers, Graphics, Brand Packs** — all image or video.
- **"Replacing a logo"** — one of the six steps in the 30-second criterion.
- Any template whose design needs a raster or vector mark.

**Not blocked, and being built in Phase 4:**

- The application shell, information architecture and Home screen.
- Developer Mode, and moving every engine concept behind it.
- **Theme packs** — design tokens are document data (§11.2) and already work.
- **Animation packs** — motion presets compile to ordinary timeline tracks.
- **Template packs, lower thirds, scoreboards** — buildable from `rect`, `text`
  and primitives, which is now enough for a real broadcast graphic.
- Marketplace browsing and installing those three kinds, locally and instantly.
- Five of the six steps in the 30-second criterion.

So the correct reading is: **the product shell is buildable today and the asset
library is not.** That is a much smaller gap than IF-003's, and it does not stop
Phase 4 being worth doing now.

---

## 4. What I am NOT doing about it

Three tempting shortcuts, each refused for the same reason:

**An `<img>` decoded to a canvas and uploaded as a texture.** It would work in a
browser this week. It would also be a second image path with different colour
management from the real one, no budget accounting, no eviction, and no
determinism guarantee — and every template authored against it would need
re-authoring. This is the Canvas2D-text argument from IF-003, wearing a
different hat.

**A Marketplace that ships placeholder thumbnails for content that cannot be
installed.** A store whose items do not work is worse than a store with fewer
items.

**An Assets panel with empty Images / Video / Audio tabs.** A tab that is always
empty teaches a user to distrust the panel. Phase 3A settled this rule for the
toolbox — a tool exists only when the engine can draw what its name says — and
it applies here unchanged.

Instead: the Assets section ships with the categories that are **real** (fonts,
colours, motion, templates), and the absent ones are named as coming, in one
line, rather than mocked.

---

## 5. What the asset pipeline actually needs

Sized honestly, because "add image support" underestimates it the way "just use
HarfBuzz" underestimated text.

| | Work |
| --- | --- |
| Format | `image` component wired; `SceneAsset` gains dimensions and colour space |
| Fetch | Content-addressed by hash, cached, deduplicated across scenes |
| Decode | PNG/JPEG/WebP off the frame thread. **No `HTMLImageElement`** — it does not exist on two of four targets, and its colour management differs per platform. Same rule as TEXT_ENGINE §1 |
| Colour | sRGB → linear on upload, premultiplied per C9. Getting this wrong makes every logo subtly wrong and nobody can say why |
| Mipmaps | Generated by us, or a logo scaled down shimmers on every animated graphic |
| Budget | Textures are the largest GPU consumer in a broadcast scene. ENGINE_RUNTIME §4.4 pinning applies |
| SVG | A separate problem: it is **vector**, so it either rasterises at a size bucket (like MSDF) or tessellates to geometry. That is a design decision, not a loader |
| Video | A different subsystem again — decode cadence, A/V sync, and the frame clock. Already **Reserved** in SCENE_FORMAT §7 |

My estimate: **images and SVG, 3–4 weeks.** Video is its own phase and should
stay reserved.

---

## 6. Recommendation

**Proceed with Phase 4 now, minus assets.** The shell, Home, Developer Mode,
content packs, and the visual language are the bulk of the brief's value and none
of them depends on this.

**Then the 3D viewport** — still the last outstanding *engine* capability, still
deferred twice, and still the only way to confirm lighting and world-space text
on screen.

**Then the asset pipeline (images + SVG)**, which closes the Assets browser, the
remaining Marketplace categories, and the logo step of the 30-second criterion.

Stated plainly so the gap is not discovered later: **until that lands, a
Streamatrix graphic cannot contain a logo.** For a broadcast product that is a
real limitation, and it is the single most important thing left after the
viewport.
