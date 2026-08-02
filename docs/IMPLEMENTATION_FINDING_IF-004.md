# IF-004 — UAX #14 does not break Thai, Khmer, Lao or Burmese

**Date:** 2026-08-03 · **Raised by:** Phase 3B, the text engine
**Status:** **NOT BLOCKING.** Mitigated, reported at runtime, and recorded here.
**Decision required:** whether to fund a dictionary segmenter, and when.

---

## 1. What TEXT_ENGINE assumes

§2 lists the stages "just use HarfBuzz" forgets, and says of line breaking:

> | Line breaking | **UAX #14** | Thai and Khmer have no spaces; splitting on
> | `" "` produces nonsense |

§10 then resolves it: **Line breaking (UAX #14) — Vendor.**

The implication is that vendoring a UAX #14 implementation solves Thai. It does
not, and the annex says so itself: UAX #14 §8 explicitly leaves scripts without
inter-word spaces to *dictionary-based* segmentation, which the annex does not
define and no conformant implementation provides.

## 2. Measured

`linebreak@1.1.0` is a correct UAX #14 implementation. Asked for the break
opportunities in an eighteen-character Thai string:

```
thai     len=18  breaks= [18]
khmer    len=21  breaks= [21]
english  len=34  breaks= [11,18,25,34]
japanese len=6   breaks= [1,2,3,4,5,6]
```

- **Latin** breaks at words. ✅
- **CJK** breaks between ideographs, which is correct for Japanese. ✅
- **Thai and Khmer** return exactly one opportunity — **at the end of the
  string**, which is not a wrap opportunity at all.

So a Thai name in a `wrap` box has no legal place to break.

### The T1 spike did not catch this

The spike asserted:

```ts
expect(thaiBreaks.length).toBeGreaterThanOrEqual(1);
```

That passed on the end-of-string break. The assertion was **vacuous** — it could
not have failed for any input, and it read as proof that Thai line breaking
worked. It is the same shape as the lighting assertions IF-003 §6 flagged, and
the same lesson: an assertion that cannot fail is decoration.

## 3. What Phase 3B does about it

Two things, neither of which is pretending.

**It breaks anyway, at a cluster boundary.** The alternative is overflowing the
box, which on air paints over whatever is beneath it. A linguistically wrong
break is bad; a graphic drawn over another graphic is worse. The cut respects
grapheme clusters, so no combining mark is ever separated from its base.

**It reports that it did.** `TextLayout.brokeWithoutOpportunity` is true
whenever a line was cut with no UAX #14 opportunity available, and it reaches
the projector's `TextDraw`. A pre-flight can warn; a designer does not discover
it live. English text sets it false, asserted.

Both are covered:

> *finds NO breaks inside Thai, which is the annex's own limit* — asserts the
> exact shape of the gap, so it is a recorded fact rather than a surprise.
>
> *breaks Thai with no opportunity, and says so* — asserts that every line fits
> the box AND that the flag is raised, and that English does not raise it.

## 4. What it would take to fix properly

A dictionary segmenter. The realistic options:

| Option | Cost | Notes |
| --- | --- | --- |
| Vendor a Thai dictionary (e.g. the ICU/LibThai word list) | ~200KB per language, plus a trie matcher | Correct. Per-language cost, and the dictionary ages |
| ICU4X `WordSegmenter` via WASM | A second WASM binary beside HarfBuzz | Correct and covers Thai, Khmer, Lao and Burmese at once. Bundle cost is real |
| `Intl.Segmenter` | Free | **Refused.** It is a PLATFORM text service: results differ between Chrome, CEF, a cloud renderer and the native runtime. That is precisely the C1 reversal, and taking it back for one script would reintroduce the exact class of bug the whole engine is shaped to prevent |

The third is worth naming explicitly because it is the obvious shortcut and it
is available in every browser we target. It is still wrong: a Thai name breaking
in one place in the operator's preview and another in the cloud render is the
failure C1 exists to eliminate, and it would be invisible until a Thai show.

## 5. Recommendation

**Do not fund it yet, and do not ship Thai-language templates until it is.**

The engine draws Thai correctly today — shaping, bidi, fitting and rasterisation
all work; the verification suite renders Thai through the whole pipeline. What
it cannot do is *wrap* Thai at a linguistically correct point.

That matters for a paragraph. It matters far less for a name in a lower third,
which is a single unbreakable unit anyway and which `shrink` handles without any
line breaking at all. Most broadcast text is the second case.

**My order:** ICU4X `WordSegmenter` when a Thai, Khmer, Lao or Burmese
broadcaster is a real customer, sized as its own piece of work with the bundle
cost accepted deliberately. Until then, the flag is on and the limitation is
written down.

---

## 6. A second, smaller finding

While measuring the above: **`Intl.Segmenter` is not the only platform text
service that could creep in.** `String.prototype.normalize`, `toLocaleUpperCase`
and `Intl.Collator` are all ICU-backed and all vary by runtime. None is used by
`engine-text` today. Worth stating as a rule rather than discovering later:

> No `Intl.*`, no locale-sensitive `String` method, anywhere in the text
> pipeline. TEXT_ENGINE §1 says no platform text engine; these are the platform
> text engine wearing a different name.
