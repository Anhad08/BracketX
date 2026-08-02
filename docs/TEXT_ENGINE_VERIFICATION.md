# Text Engine — Verification

**Date:** 2026-08-03
**Headless:** `engine-text/src/text.test.ts` (43) ·
`engine-host/src/text.test.ts` (21) · workspace total **1,095 passing**
**Browser:** `apps/studio/e2e/text.spec.ts` (5, Chromium + SwiftShader)
**Benchmarks:** `engine-text/src/text.bench.ts` (16)

---

## 1. The failure mode this suite is built around

**Text that appears is not text that is correct.** Every hard bug in this
subsystem still renders something:

| Bug | What you see |
| --- | --- |
| Shaping silently off | Arabic in isolated forms. Looks like a bad font. |
| Bidi missing | A Hebrew name backwards. Looks like bad data. |
| Wrong cmap | A `.notdef` box. Looks like a missing glyph. |
| Float-accumulated advances | A word 2px wider on one target than another. |
| Atlas slot never reserved | Every glyph is the same letter. Looks like a cache bug. |

So almost nothing here asserts "text appeared". Each assertion is chosen to fail
under a specific plausible wrong implementation, and each carries a comment
saying which.

**Fonts are vendored, not read from the system.** The T1 spike read
`C:/Windows/Fonts` and *skipped* when a font was missing — a test that passes by
not running, which is why its Thai assertion was vacuous (§4). The four OFL
fonts under `packages/engine-text/fixtures/fonts` (264KB) make a golden layout a
real golden layout.

---

## 2. The pipeline

| Claim | Asserted by | Fails if |
| --- | --- | --- |
| Metrics and outlines come from one parser | `upem` 2048, integer advances, an outline with >3 commands | A second parser disagreed about the cmap |
| The fallback chain resolves in declared order | Latin→Inter, Arabic→Noto Arabic, Hebrew→Noto Hebrew, Thai→Noto Thai | Fallback were discovered from the platform |
| **An exhausted chain yields a visible `.notdef`** | Korean against a Latin-only stack → glyph **0**, and `missing()` reports both codepoints | A silent substitution — worse on air, because nobody catches it |
| Itemization keeps `2-1` in one run | The Latin run contains `"2-1"` | Common characters split runs, losing digit kerning |
| Bidi resolves mixed direction | Level of the leading Arabic is **odd**; some level is even | An Arabic name rendered left to right |
| Rule L2 reorders runs, not characters | `[0,1,1,0]` → the two level-1 runs swap, the level-0 runs do not | Reversing inside a run would scatter its shaped glyphs |
| **Shaping is more than a cmap lookup** | Arabic in context ≠ the same letters shaped in isolation | `setDirection` given a string makes `hb_shape` bail SILENTLY, returning codepoints with zero advances |
| Advances are integers in font units | Every `xAdvance` and the run width are integers | Float accumulation drifts, and differently per target |
| The shaping cache is worth what it claims | 8 identical labels → 1 miss, 7 hits; two different scores → 3 misses | An earlier version of this comment claimed sub-word caching; itemization merges a Latin phrase into ONE run, so it does not. Corrected rather than left flattering |

---

## 3. Layout and fit

| Claim | Asserted by |
| --- | --- |
| **Deterministic** | Two fresh shapers produce byte-identical layouts |
| **Golden layout** | Eleven exact glyph positions to four decimals, plus: the same letter is the same glyph id at both its occurrences |
| Wrap fits the box | **Every** line ≤ the box width, not just the widest |
| A trailing space does not wrap a line | A line ending in a space is measured without it |
| `shrink` is on a quantised grid | Result × 4 is an integer; a fresh shaper reaches the same size |
| **Text never grows to fill a box** | "Li" in a large box stays at the authored 48 |
| `shrink` reports rather than shrinking past its floor | Impossible box at `minSize: 24` → `truncated`, size ≥ 24 |
| Truncation is one ellipsis, at a cluster boundary, inside the box | Exactly one U+2026; width recomputed after trimming |
| `overflow` overflows only when asked | `overflowed` true, `truncated` false, one line |
| Height caps lines even with no `maxLines` | A short box yields ≤ 2 lines |
| The layout cache key excludes alignment | Two specs differing only in `align` share a key |

### The truncation width bug

The first implementation returned the **pre-trim** width after appending the
ellipsis, so a layout claimed to overflow a box it now fitted — a wrong number
that a fit decision is made on. Caught by asserting `width <= box.width` rather
than merely that an ellipsis existed.

---

## 4. Thai, honestly

> *finds NO breaks inside Thai, which is the annex's own limit*

`linebreak` returns exactly **one** opportunity for an 18-character Thai string,
at the end. That is correct UAX #14 behaviour — the annex leaves Thai, Khmer,
Lao and Burmese to dictionary segmentation and does not define it.

**The T1 spike asserted `thaiBreaks.length >= 1` and passed on that end-of-string
break.** The assertion could not have failed for any input. It read as proof that
Thai line breaking worked.

Phase 3B breaks anyway — at a cluster boundary, because overflowing paints over
the graphic beneath — and **reports it**:

> *breaks Thai with no opportunity, and says so* — every line fits the box,
> `brokeWithoutOpportunity` is true, and English text sets it **false**.

Full analysis in [IF-004](./IMPLEMENTATION_FINDING_IF-004.md).

---

## 5. MSDF and the atlas

| Claim | Asserted by | Fails if |
| --- | --- | --- |
| **The field reconstructs through the median** | Stem centre reads inside (>127), padded corners read outside | The only assertion that shows the field is *correct* rather than non-empty |
| A counter stays hollow | The middle of "O" reads outside | Even-odd winding, or an unclosed contour — the glyph would render as a filled blob |
| A space produces no field | `generateMsdf` returns null | Reserving atlas space for every whitespace glyph |
| The field is padded by the distance range | Field width > ink width | A clipped ramp hard-edges the glyph |
| Sizes bucket to powers of √2 | 48 and 50 share a bucket; 0, −5 and NaN all give 1 | Without it a scale animation regenerates every glyph every frame |
| **Eviction happens, and is normal** | 52 glyphs into a 64² page → evictions > 0, pages ≤ 2 |
| **A pinned glyph is never evicted** | Pin "A", add 51 more, force eviction — "A" is still there |
| Pins are counted | Two pins, one unpin → still pinned; unpinning past zero does not go negative |
| Dirty regions are reported once | One region, then none |

### Two real bugs here

**The atlas never reserved its slots.** `find` located a position and `place` was
never called, so the skyline stayed flat and **every glyph was written to (1,1)**,
overwriting the last. A whole string would have rendered as one repeated
character, and the atlas reported itself as never full. Caught because the
eviction test could not force an eviction — 52 glyphs were all stacked in one
corner.

**Pinning did nothing.** `#evict` cleared *all* slots including pinned ones; the
comment claimed survivors were kept and the code did not. Now survivors' texels
are copied out before the pages reset and blitted back — regenerating them would
mean re-running MSDF for the whole on-air set at the exact moment the atlas is
already under pressure.

---

## 6. Participation — the phase's actual claim

> *text automatically participates in variables, the timeline, animation, states,
> collections, templates, outputs, preview and live — with no special workflow.*

Twenty-one assertions in `engine-host/src/text.test.ts`, structured to mirror
`hybrid.test.ts`, which asked the same question of 3D meshes.

| System | Asserted by |
| --- | --- |
| **It is a mesh** | An `msdf-text` mesh attaches; exactly one texture and one geometry |
| No provider wired | The node survives, nothing attaches — a scene with no words must not pay for HarfBuzz |
| A font that never loaded | The node survives |
| **Lifetime** | Every geometry, material and texture destroyed equals created |
| **Variables** | Content bound to `{ $var }` re-lays-out live |
| Precision | A score change produces **exactly one** new layout, not a scene reflow |
| Colour | Recolour updates the material **in place** — zero geometries created |
| **Timeline** | An ordinary track animates position AND `font.size` — the latter changes the *layout*, not just the transform |
| Batch alignment | The mesh child's world matrix tracks its parent's exactly under animation |
| **States** | A state override hides and restores it |
| **Collections** | One text node per row, each with its own content; three distinct layouts |
| Identity | A reorder preserves the mirror handle **and** the text batches |
| Cleanup | A removed row's text resources are freed |
| **Outputs** | Two outputs, one mirror, one layout |
| **Preview/Live** | Two hosts loading the same document are **byte-identical**, including a `shrink` result |
| Layout is engine state | `truncated` is reachable through the provider — a pre-flight can see it |
| One pipeline | World-space and screen-space differ by exactly the scale factor, same size, same batching |
| RTL end to end | An Arabic name from a bound variable; replacing it with a Latin name live works through the same node |
| **Pre-warm (T4)** | A declared `latin` range rasterises >60 glyphs; overlapping ranges deduplicate; Hangul caps at 2,350 |

---

## 7. In a browser

Five tests. They exist because a headless suite proves the code paths are right
and cannot prove a gesture reaches them — the lesson Phase 3A paid for twice.
Text has two extra ways to be correct and invisible: the fonts may not be served,
and the shader may not compile. **Both happened.**

| Claim | Ends on |
| --- | --- |
| The fonts are served and parse | A 200 with >10KB of body, and **zero console errors** |
| The Text tool creates a node the engine draws | History depth +1, the inspector shows a text component, no shader error |
| Editing content re-lays-out through the engine | The value round-trips and undo restores it |
| A preset animates text with the rectangle's code | Two keyframes in the ordinary timeline editor |
| Text goes to air through the ordinary Take path | Tally OFF → ON AIR; a later Preview edit still does not reach air |

---

## 8. What the suite caught

**Nine bugs. Five of them pre-existing, and none found by using the software.**

| | Bug | Found by |
| --- | --- | --- |
| 1 | **Atlas never reserved slots** — every glyph written to (1,1) | The eviction test could not force an eviction |
| 2 | **Pinning did nothing** — `#evict` cleared pinned slots too | The pinned-glyph test |
| 3 | Truncation reported the pre-trim width | Asserting the width fits, not that an ellipsis exists |
| 4 | **Dotted-key invalidation never fired** *(pre-existing)* | A text node bound to `player.name` that would not update |
| 5 | **Collection instances re-resolved without their scope** *(pre-existing)* | A reordered row losing its words |
| 6 | **`createTexture` used `Texture`, not `DataTexture`** *(pre-existing)* | The browser — `texSubImage2D` overload rejected |
| 7 | **`updateTexture` ignored its region** *(pre-existing)* | The browser |
| 8 | **The inspector's `"text"` field kind was never implemented** *(pre-existing)* | The browser — a string rendered as `0` |
| 9 | A benchmark that reported a novel glyph as *cheaper* than a cached one | Reading the number and disbelieving it |

Four deserve drawing out.

**#4 — every dotted binding was dead.** `{ $var: "team.accent" }` records its
dependency under `team` (a dotted binding is a *path*), but a live command sets
the flat key `team.accent`, and looking that up found nobody. The node resolved
once at build and **never updated again**. Dotted is the documented idiomatic
form. Nothing caught it because the tests that use `team.accent` assert an
attachment did *not* change — trivially true when the invalidation never fires.

**#5 — collection rows resolved against the wrong variable source.** `#flush`
re-applied dirty nodes with the document-level source, so a row's
`{ $var: "row.color" }` came back `undefined` and the row was repainted **white**
— and stayed white. A showcase test was passing *because* of this: it asserted a
backend write that only happened because of the erroneous repaint. Corrected to
patch a field the scene actually renders.

**#6 and #7 — the texture path had never been exercised.** Nothing in the engine
produced a texture until the glyph atlas did. A plain `Texture` holding raw data
looks right and uploads wrong, and `updateTexture` ignored its region and wrote a
glyph-sized buffer to offset zero of a 2048² page. Both dormant since Phase 2.5e;
both invisible to `MockMirrorBackend`, which has no driver to reject anything.

**#9 is a lesson about benchmarks, not code.** The first version measured
Cyrillic against a Latin-only subset, so every "miss" resolved to `.notdef`,
generated nothing, and reported a novel glyph as cheaper than a cached one. The
second rebuilt the engine per iteration and measured construction — 145ms for a
2ms event. The benchmark was **removed** and the cost stated as the composition
of two measured parts. A number that says the opposite of the truth is worse than
no number.

---

## 9. Cost

| | Mean | p99 |
| --- | --- | --- |
| **Layout — P1, 2ms scene budget** | | |
| a name, cold shaper | 0.0235 ms | 0.103 |
| a name, warm shaper | **0.0090 ms** | 0.046 |
| a wrapped sentence | 0.0263 ms | 0.136 |
| right-to-left with bidi | 0.0208 ms | 0.108 |
| shrink, eight iterations | 0.1383 ms | 0.735 |
| **twenty names — one leaderboard** | **0.1447 ms** | 0.675 |
| **Shaping** | | |
| cached run | 0.0007 ms | 0.003 |
| uncached run | 0.0133 ms | 0.048 |
| **Rasterisation — P2, off-frame** | | |
| one glyph at 32px | 1.03 ms | 2.09 |
| one glyph at 48px | 2.04 ms | 4.12 |
| one glyph at 64px | 3.02 ms | 5.61 |
| **Atlas** | | |
| pack one glyph | 0.078 ms | 1.25 |
| look one up | 0.0002 ms | 0.0006 |
| **End to end** | | |
| render a pre-warmed name | 0.0102 ms | 0.050 |
| pre-warm a Latin set (52 glyphs) | 257 ms | — |

**A leaderboard of twenty names lays out in 0.14ms against a 2ms budget — 14×
inside it.** That is the number this phase had to produce.

The live-text miss is deliberately not benchmarked end to end (§8 #9). It costs
one layout plus one MSDF generation per novel glyph: **0.010 + 2.04 ms at 48px**.
That is why §7 puts atlas generation in scheduler class P2 and §5 makes pre-warm
the on-air path.

---

## 10. What is not verified

| | Why |
| --- | --- |
| **CJK quality and cost** | A CJK font is 2.4MB, too heavy to vendor. Contour counts are several times Latin's, so generation cost and small-size quality are **Unknown** — not Proven, not Disproven |
| Thai/Khmer wrapping correctness | Cannot be, without a dictionary. IF-004 |
| Cross-target determinism | Same-process repetition and a golden layout are asserted. Chrome vs CEF vs a cloud renderer vs the native runtime stays **Unknown** until a second runtime exists — the same limit the T1 spike recorded |
| **How text actually looks** | The browser tests assert no shader error and no console error. **Nobody has compared rendered glyphs against a reference image.** Perceptual quality is Assumed |
| Worker execution | MSDF runs synchronously. Pre-warm makes it load-time, so this is latency, not correctness |
| Text on an angled 3D surface | Supported by construction; unlooked-at, because there is still no 3D viewport |
