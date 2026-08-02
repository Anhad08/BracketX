# Implementation Report — Phase 3B, the Text Engine

**Date:** 2026-08-03 · **Branch:** `phase-2-engine`
**Brief:** make text a first-class scene node that automatically participates in
variables, timeline, animation, states, collections, templates, outputs,
preview, live and marketplace — with no special editor workflow.
**Companions:** [TEXT_ENGINE_ARCHITECTURE.md](./TEXT_ENGINE_ARCHITECTURE.md) ·
[TEXT_ENGINE_VERIFICATION.md](./TEXT_ENGINE_VERIFICATION.md) ·
[IF-004](./IMPLEMENTATION_FINDING_IF-004.md)

---

## 1. Against the brief

| Asked for | Delivered | |
| --- | --- | --- |
| Text a first-class scene node | `#applyText` beside `#applyRect`; text is a mesh | ✅ |
| Variables | Content and colour bind; a score change re-lays-out exactly one node | ✅ |
| Timeline | An ordinary track animates position **and `font.size`** — the latter changes the layout | ✅ |
| Animation | Same tracks, same sampler, no new machinery | ✅ |
| States | A state override hides and restores it | ✅ |
| Collections | One text node per row, keyed identity preserved across reorder | ✅ |
| Templates | `promoteToTemplate` was never told about text | ✅ |
| Outputs | Two outputs, one mirror, one layout | ✅ |
| Preview / Live | Two hosts on one document are **byte-identical**, including a `shrink` result | ✅ |
| Marketplace | A template with text is a SCENE_FORMAT document; nothing new | ✅ |
| **No special editor workflow** | ~40 lines of Studio change, none of it a new workflow | ✅ |
| T2 · MSDF quality | Passed for Latin/Arabic/Hebrew/Thai. **CJK untested** | ⚠️ |
| T3 · adopt vs re-implement | **Re-implement**, on four independent grounds | ✅ |
| T4 · pre-warm declaration | `world.textPrewarm`, scene-level, additive | ✅ |

**Deliberately not done:** Thai/Khmer/Lao/Burmese *wrapping* (IF-004), CJK
quality measurement, and Worker execution of MSDF generation. §5 covers each.

---

## 2. What changed

```
 packages/engine-text/src/font.ts        NEW   metrics, cmap, outlines
 packages/engine-text/src/segment.ts     NEW   UAX #24, #9, #14
 packages/engine-text/src/shape.ts       NEW   HarfBuzz + a run cache
 packages/engine-text/src/layout.ts      NEW   lines, alignment, fit
 packages/engine-text/src/msdf.ts        NEW   multi-channel distance fields
 packages/engine-text/src/atlas.ts       NEW   skyline, LRU, pinning
 packages/engine-text/src/engine.ts      NEW   the orchestrator
 packages/engine-text/src/ranges.ts      NEW   pre-warm range expansion (T4)
 packages/engine-text/fixtures/fonts/    NEW   4 OFL fonts, 264KB
 packages/engine-text/src/text.test.ts   NEW   43 assertions
 packages/engine-text/src/text.bench.ts  NEW   16 benchmarks
 packages/engine-reconciler/…/text-provider.ts  NEW  the port
 packages/engine-reconciler/…/projection.ts     +    #applyText / #releaseText
 packages/engine-host/src/text.ts        NEW   the adapter
 packages/engine-host/src/text.test.ts   NEW   21 participation assertions
 packages/engine-render-three/…/translate.ts    FIX  real MSDF shader; DataTexture
 packages/engine-render-three/…/three-backend.ts FIX updateTexture honours region
 packages/engine-scene/src/types.ts      +     world.textPrewarm (T4)
 apps/studio/…                           +     1 preset line, 1 inspector row,
                                               1 tool, font loading
 apps/studio/e2e/text.spec.ts            NEW   5 browser tests
 tools/engine-layers.mjs                 +     engine-host may know engine-text
```

**Verification:** 1,095 headless tests + 15 browser tests + 40 benchmarks.
Workspace: 35/35 tasks green.

---

## 3. The three decisions

### T3 — re-implement. Decided on evidence, not recollection.

I fetched `troika-three-text`'s package metadata and README rather than relying
on what I remembered. Four findings, each disqualifying on its own:

1. **`three` is a peer dependency** and the export is a Three mesh.
   `engine-text` is `engine-core` and may not import three. Putting it in
   `engine-render-three` instead would move **layout** — line breaks, fit
   results, engine state a show depends on — into a backend. That is the C1
   reversal undone.
2. **SDF, not MSDF.** TEXT_ENGINE §4 requires multi-channel and argues why.
3. **`webgl-sdf-generator` needs a WebGL context.** Unusable headless.
4. **No documented eviction or pinning guarantee.** §5 requires both.

We *did* adopt the parts of troika's stack that are backend-neutral — `bidi-js`
is by troika's own author.

### T2 — MSDF quality: passed, with a stated gap.

Verified by reconstructing the field rather than by looking at it: the median
must read inside at a stem's centre, outside at the padded corner, and a letter
O's counter must read outside — which fails immediately if the winding rule or
the edge colouring is wrong. Cost measured at 32/48/64px.

**CJK was not tested.** A CJK font is 2.4MB and too heavy to vendor as a fixture,
and harfbuzzjs does not expose its subsetter. CJK contour counts are several
times Latin's, so generation cost and small-size quality are **Unknown**. Stated
as a gap rather than an answered question.

### T4 — pre-warm belongs on the scene.

`world.textPrewarm: { ranges?, characters? }`. Not on the font asset, because a
font is shared and a scene is not: the same Noto Sans serves a Latin scoreboard
and a Korean one, and a set declared on the asset is wrong for every scene but
one. Declared by name (`"hangul"`), not by codepoint. Optional with a default, so
§13 rule 4 makes it additive — no version bump.

---

## 4. Nine bugs, five of them pre-existing

The most useful part of this phase. None was found by using the software.

| | Bug | Found by |
| --- | --- | --- |
| 1 | **The atlas never reserved its slots.** `find` located a position; `place` was never called. Every glyph was written to (1,1) | The eviction test could not force an eviction |
| 2 | **Pinning did nothing.** `#evict` cleared pinned slots too | The pinned-glyph test |
| 3 | Truncation reported the pre-trim width | Asserting the width fits |
| 4 | **Every dotted binding was dead** *(pre-existing)* | A text node bound to `player.name` that would not update |
| 5 | **Collection instances re-resolved without their scope** *(pre-existing)* | A reordered row losing its words |
| 6 | **`createTexture` used `Texture`, not `DataTexture`** *(pre-existing)* | The browser |
| 7 | **`updateTexture` ignored its region** *(pre-existing)* | The browser |
| 8 | **The inspector's `"text"` field kind was never implemented** *(pre-existing)* | The browser |
| 9 | A benchmark reporting a novel glyph as *cheaper* than a cached one | Disbelieving the number |

Four worth your attention.

**#1 would have shipped as "the font is broken".** Every string would have
rendered as one repeated character. It is the exact class this phase's test
strategy was built around — text that appears but is wrong.

**#4 — every dotted binding was dead.** `{ $var: "team.accent" }` records its
dependency under `team`, because a dotted binding is a *path*. A live command
sets the flat key `team.accent`, and looking that up found nobody. The node
resolved once at build and **never updated again**. Dotted is the documented
idiomatic form and appears throughout the codebase. Nothing caught it because the
tests using `team.accent` assert an attachment did *not* change — trivially true
when the invalidation never fires.

**#5 — collection rows were repainted white.** `#flush` re-applied dirty nodes
with the document-level variable source, so a row's `{ $var: "row.color" }` came
back `undefined` and fell back to `#FFFFFF`. And stayed. A showcase test was
passing *because* of this — it asserted a backend write that only occurred
because of the erroneous repaint.

**#6 and #7 — the texture path had never run.** Nothing in the engine produced a
texture until the glyph atlas did. Both dormant since Phase 2.5e, both invisible
to `MockMirrorBackend`, which has no driver to reject anything.

That last point is the general lesson, and it is the same one Phase 3A produced:
**a mock backend proves the contract, a browser proves the driver accepts it.**
Three of the nine were found only because a browser looked.

---

## 5. Where I went past, or short of, the brief

**Short: Thai does not wrap correctly, and cannot.** UAX #14 provides no break
opportunities inside Thai, Khmer, Lao or Burmese — the annex leaves them to
dictionary segmentation and does not define it. The T1 spike's Thai assertion
(`breaks.length >= 1`) passed on a break at the *end* of the string and was
vacuous. The engine now breaks at a cluster boundary anyway — overflowing would
paint over the graphic beneath — and **reports that it did**, so a pre-flight can
warn. Full analysis and options in IF-004.

I explicitly refused `Intl.Segmenter`, which would fix it in one line: it is a
platform text service, its results differ between Chrome, CEF, a cloud renderer
and the native runtime, and that is precisely the C1 reversal. IF-004 §6 turns
that into a standing rule covering `Intl.*` and locale-sensitive `String`
methods — none of which appear in `engine-text`, verified.

**Past: I replaced the Three backend's MSDF placeholder.** It had stood since
Phase 2.5e, sampling the distance field as a colour map — text would have
rendered as three-channel noise. Implementing the real shader was not in the
brief's wording but was unavoidably implied by "first-class".

**Past: two pre-existing engine bugs (#4, #5).** Both blocked "text participates
in variables/collections", so fixing them was in scope. Both are worth knowing
about independently of text.

---

## 6. Studio needed ~40 lines, as predicted

Phase 3A's generic-node audit said a future TextNode would cost "two table rows,
not a phase". It held:

- `colourPath`: **one line** — text fades because `color` is where its colour is.
- `COMPONENT_FIELDS`: **one row** — six properties, declaratively.
- `COMPONENT_CHOICES`: one entry. `TOOLBOX` + `makeNode`: one entry, one case.

Keyframing, presets, alignment, grouping, layer order, templates,
Preview/Program and undo all worked on text the day it existed, unchanged. The
timeline editor keyframes a text node because a track is `(target, path)` and it
never asks what a node is.

The honest exception is **font loading** (~90 lines): fonts are assets, the
engine loads binaries, and somebody has to fetch them. That is new capability,
not an editor-architecture change — and the audit did not predict it because
Phase 3A had no assets at all.

---

## 7. Cost

**A leaderboard of twenty names lays out in 0.145ms against TEXT_ENGINE §7's 2ms
budget — 14× inside it.** That is the number the phase had to produce.

| | Mean |
| --- | --- |
| One name, warm shaper | 0.0090 ms |
| Wrapped sentence | 0.0263 ms |
| RTL with bidi | 0.0208 ms |
| `shrink`, eight iterations | 0.1383 ms |
| **Twenty names** | **0.1447 ms** |
| MSDF, one glyph at 48px | 2.04 ms *(off-frame, P2)* |
| Pre-warm a Latin set | 257 ms *(load-time)* |

---

## 8. What this does not close

- **CJK is unmeasured.** Quality and cost both Unknown.
- **Nobody has compared rendered glyphs to a reference image.** The browser tests
  assert no shader error and no console error; perceptual quality is Assumed.
- **MSDF runs synchronously**, not in a Worker. Pre-warm makes it load-time, so
  this is latency rather than correctness — but §4 asked for a Worker.
- **Cross-target determinism stays Unknown** until a second runtime exists. Same
  limit the T1 spike recorded.
- **The 3D viewport.** Still outstanding, and now the last engine piece. It is
  the only way to confirm on screen that a directional light illuminates a face,
  and that world-space text on an angled surface looks right.

---

## 9. Recommendation

**3D viewport next.** It is now the sole outstanding engine capability, it has
been deferred twice, and two things currently rest on headless assertions alone:
ADR-013 amendment 1's lighting, and world-space text. Both are cheap to confirm
once there is somewhere to look.

**Then Phase 3C — the official graphics library.** All six templates are
unblocked: a lower third has words now.

ICU4X word segmentation when a Thai, Khmer, Lao or Burmese broadcaster is a real
customer, sized as its own work with the bundle cost accepted deliberately.
