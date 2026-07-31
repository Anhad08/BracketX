# BracketX Text Engine

**Status:** Phase 2 design · **Authored:** 2026-07-30 · **Owner:** @Pixelborne
**Closes:** [FINAL_REVIEW C1](./ARCHITECTURE_FINAL_REVIEW.md#c1--text-pipeline-breaks-determinism--critical--reverses-a-documented-decision) ·
supersedes [RFC-003 §7](./RFC-003-rendering-architecture-3d.md#7-text--the-largest-technical-risk)
**Constrained by:** [ADR-013](./ARCHITECTURE.md#adr-013)

> Scored **4/10 at the highest weight (15%)** in the architecture review — the
> most under-resourced subsystem relative to its importance. Broadcast graphics
> are ~80% text; this is not a supporting system, it is the product's primary
> content path.
>
> Consumes the budgets, eviction rules, and clock from
> [ENGINE_RUNTIME.md](./ENGINE_RUNTIME.md).

---

## 1. The rule that shapes everything

> **No platform text engine, on any target, at any stage.**

Not Canvas2D `fillText`, not the browser's shaper, not system font fallback.
Every stage from font binary to geometry ships with us and produces byte-identical
layout in Chrome, OBS's CEF, a headless cloud renderer, and the native runtime.

This is the C1 reversal. The previous dual-path design delegated screen-space
text to Canvas2D and complex-script shaping to "the platform shaper", which meant
**the same scene laid out differently depending on where it rendered** — and
text layout (line breaks, fit results, glyph advances) is engine state, not
pixels. A cloud render could break a name to two lines where the operator's
preview showed one.

Owning the pipeline is also **simpler** than the design it replaces: one path
instead of two, and one class of cross-target bug eliminated rather than managed.

## 2. Pipeline

Eight stages. Each is deterministic and each is ours.

```
  font binary (WOFF2 / TTF / OTF)
      │
  1.  parse            outlines, metrics, cmap, GSUB/GPOS
      │
  2.  itemize          split by script, direction, font, style
      │
  3.  bidi             UAX #9 — resolve visual order
      │
  4.  shape            HarfBuzz (WASM) per run → positioned glyph ids
      │
  5.  break            UAX #14 — line break opportunities
      │
  6.  layout           lines, alignment, baselines
      │
  7.  fit              wrap / shrink / truncate / overflow
      │
  8.  rasterize        MSDF per glyph → dynamic atlas
      │
      └──▶ geometry (quads + atlas UVs) ──▶ render adapter
```

### "Just use HarfBuzz" hides most of the work

A common and expensive misconception: **HarfBuzz shapes, and does nothing
else.** It does not resolve bidirectional order, find line breaks, segment
graphemes, or itemize by script. Those are stages 2, 3, and 5, and each is a
Unicode annex we must implement or vendor:

| Stage | Standard | Why it cannot be skipped |
|---|---|---|
| Itemization | UAX #24 script property | Shaping requires one script per run |
| Bidi | **UAX #9** | Arabic and Hebrew names render in the wrong order without it |
| Line breaking | **UAX #14** | Thai and Khmer have no spaces; splitting on `" "` produces nonsense |
| Segmentation | UAX #29 | Grapheme clusters — emoji, combining marks, Devanagari |

Budgeting "HarfBuzz integration" and discovering these later is the specific way
this subsystem overruns.

## 3. Fonts

### Loading

Fonts are declared assets ([SCENE_FORMAT §11](./SCENE_FORMAT.md#11-assets)),
loaded as binaries and parsed by us. **No `FontFace`, no `document.fonts`** —
those are browser APIs that do not exist on two of our four targets.

**The first frame is not painted until every font a scene references has parsed.**
A font resolving mid-broadcast reflows every graphic using it.

### Fallback chains

A missing glyph must resolve deterministically, so the chain is **declared, not
discovered**:

```
font: { assetId: "ast_inter", fallback: ["ast_noto_cjk", "ast_noto_arabic"] }
```

Resolution: first font in the chain whose `cmap` contains the codepoint. Nothing
in the chain → **visible `.notdef`**, never a silent substitution. A wrong glyph
that looks plausible is worse on air than a box that is obviously wrong.

> **This adds an optional `fallback` property to
> [SCENE_FORMAT §7.2](./SCENE_FORMAT.md#72-text).** Per that document's §13
> rule 4, adding an optional property with a defined default is **not** a
> breaking change and requires no version bump. The freeze is not reopened —
> the forward-compatibility rules written earlier are what make this additive.

## 4. Rasterization — MSDF

**MSDF, not SDF.** Multi-channel signed distance fields preserve sharp corners
and thin stems that single-channel SDF rounds off, and broadcast typography is
full of both.

Cost: 3 channels instead of 1, so a 2048² page is ~12MB rather than ~4MB.
Accepted — quality is the product, and one page holds a large working set.

**Generated on demand from parsed outlines**, never pre-baked. Pre-baked atlases
require knowing every glyph in advance, which is impossible for a global esports
audience. This was the decisive finding in
[RENDER_ENGINE_EVALUATION §5](./RENDER_ENGINE_EVALUATION.md#5-text--the-deciding-criterion).

Generation runs in a Worker. Per
[ENGINE_RUNTIME §2.2](./ENGINE_RUNTIME.md#22-chunking-because-javascript-cannot-preempt),
it may not run on the frame thread.

## 5. Atlas management

| Property | Design |
|---|---|
| Page size | 2048², multiple pages |
| Packing | Skyline, per page |
| Key | `(fontId, glyphId, sizeBucket)` — sizes bucket to powers of √2 so a scale animation does not regenerate every frame |
| Eviction | LRU per page |
| **Pinning** | **Glyphs used by an on-air output are never evicted** — [ENGINE_RUNTIME §4.4](./ENGINE_RUNTIME.md#44-on-air-resources-are-pinned) |
| Pre-warm | At scene load, before air |

### Pre-warm is what makes live text safe

At scene load, rasterize: every glyph in static text, every glyph in variable
*default* values, and a declared per-scene character set (e.g. "Latin +
Hangul"). Before the scene can go on air.

Live text still hits novel glyphs — an unexpected name — so eviction and
on-demand generation must work. But pre-warm converts the common case from a
mid-show spike into load-time cost, which is the only acceptable place for it.

### CJK

Dynamic growth is mandatory, not an optimisation. A Korean or Japanese player
name is routine, and a 2048² page holds only a few hundred CJK glyphs at
broadcast sizes. Eviction under pressure is therefore a **normal operating
mode**, not an error path, and must be tested as one.

## 6. Layout and fit

### Fit-to-box

Required on every text node ([SCENE_FORMAT §7.2](./SCENE_FORMAT.md#72-text))
because broadcast text has unpredictable length — a name may be 3 characters or
30 in the same slot.

| Mode | Behaviour |
|---|---|
| `wrap` | Break at UAX #14 opportunities, up to `maxLines` |
| `shrink` | Reduce size toward `minSize` until it fits |
| `truncate` | Clip, appending an ellipsis at a grapheme boundary |
| `overflow` | Draw beyond the box; the author accepts it |

### `shrink` must be deterministic

Naive "loop until it fits" is not reproducible — floating-point differences
between targets produce different final sizes, which is exactly the class of bug
C1 existed to eliminate.

**Specified algorithm:** binary search over the size range, **fixed at 8
iterations**, sizes quantised to 0.25pt, result always the largest tested size
that fits. Fixed iteration count and quantisation make the outcome identical
everywhere regardless of float behaviour.

### Screen-space and world-space

**One pipeline, two geometry outputs** — not two pipelines. Stages 1–8 are
identical; only the final quad generation differs:

| | Screen-space | World-space |
|---|---|---|
| Units | Pixels, pixel-snapped | Metres |
| Camera | Orthographic | Any |
| Size bucket | Known at layout | Derived from distance |

This single-pipeline property is what the C1 reversal bought, and it is why the
design is smaller than its predecessor despite doing more.

## 7. Performance

| Concern | Design |
|---|---|
| Layout cache | Keyed by `(content, fontStack, size, box, fitMode)`; invalidated on variable change |
| Shaping | Worker; results transferred, not copied |
| Scheduler class | Layout **P1**; atlas generation **P2** — safe because pre-warm covers the on-air path |
| Live updates | A score changing re-runs layout for one node, not the scene |
| Budget | Text layout must not exceed **2ms** per frame across all visible nodes |

## 8. Determinism requirements

Testable, and tested:

1. Same `(string, font stack, size, box, fit mode)` → identical glyph positions
   on every target, to the last decimal.
2. `shrink` produces the same size on every target.
3. Advances come from font metrics in fixed-point, never accumulated floats.
4. Bidi and line-break results depend only on the Unicode data version, which
   ships pinned with us.

Verified by golden-layout tests: a fixture set of Latin, Arabic, Hebrew, Thai,
Hangul, and CJK strings, asserting exact glyph positions against a committed
snapshot.

## 9. Risks

| Risk | P | Impact | Mitigation |
|---|---|---|---|
| Underestimated — the Unicode annexes are the hidden work (§2) | **High** | **Severe** | Prototype stages 2–5 first, before anything else in Phase 3 |
| MSDF quality floor at small sizes | Medium | Moderate | Broadcast text is large; set a documented minimum |
| Atlas thrash on CJK-heavy shows | Medium | Severe | Pre-warm; test eviction as a normal mode |
| HarfBuzz WASM bundle size and cold-start | Medium | Low | Lazy-load; pre-warm is already load-time |
| Vendoring Unicode data ages | Low | Low | Pin version; treat updates as a deliberate change — they alter layout |

## 10. Build vs vendor

| Stage | Decision |
|---|---|
| Font parsing | **Vendor** (opentype.js / Typr class of library) — well-solved, tedious, low-risk |
| Bidi (UAX #9) | **Vendor** — a correct implementation exists; writing one is a research project |
| Line breaking (UAX #14) | **Vendor** |
| Shaping | **Vendor** HarfBuzz WASM — nothing else is credible |
| MSDF generation | **Build** — needs to run in our Worker against our atlas |
| Atlas management | **Build** — pinning and eviction are BracketX-specific ([§5](#5-atlas-management)) |
| Layout, fit, caching | **Build** — this is where broadcast behaviour lives |

`troika-three-text` remains the reference implementation for stages 1–8 and
should be read closely before building. Whether it is adopted as a dependency or
studied and re-implemented is a Phase 3 call once its atlas pinning and
determinism properties have been examined against §5 and §8.

## 11. Open items

| # | Item | Owner | Due |
|---|---|---|---|
| T1 | Prototype stages 2–5 (itemize → bidi → shape → break) before committing Phase 3 | Engineering | Phase 3 wk 1 |
| T2 | MSDF quality trial at 24–96pt including thin faces and CJK | Engineering | Phase 3 |
| T3 | Adopt vs re-implement troika, judged on atlas pinning and determinism | Engineering | Phase 3 |
| T4 | Per-scene pre-warm character-set declaration — format addition or asset metadata? | Engineering | Phase 3 |
| T5 | Minimum on-air font size, documented as a product constraint | Product | Phase 7 |
