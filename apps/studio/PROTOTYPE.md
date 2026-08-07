# The UI prototype, as it actually is

Extracted from `streamatrix-prototype.html` — the working prototype, not a
description of it. Written down here because the running app drifted from the
artifact repeatedly, and every time it did the cause was the same: building
from memory of the volumes instead of from the specimen.

**This file is the acceptance reference.** Where Studio and this disagree,
Studio is wrong.

---

## 1. The shell is four columns, not three docks

```
.app  =  .spine │ .rail │ .stage │ .dock
```

| | |
|---|---|
| `.spine` | narrow leftmost strip |
| `.rail` | primary navigation |
| `.stage` | transport row, then the well |
| `.dock` | **ONE** dock, on the right |

**Studio today has three docks (left, right, bottom). The prototype has one.**
Layers and Content live in the same dock, stacked, with Content always first.

## 2. The rail is four destinations

```
Design · Assets · Data · Brand      (spacer)      Outputs
```

Studio today has eight (Home, Design, Production, Templates, Marketplace,
Assets, Outputs, Settings). The prototype's rail is the working set of a
person making a graphic — not a site map.

## 3. Two levels, not three depths

A single class on the root:

```css
.expert-only  { display: none; }
.app.expert .expert-only { display: block; }
.beginner-only { display: block; }
.app.expert .beginner-only { display: none; }
```

**Beginner and Expert. Two.** Studio has beginner / designer / advanced.

`expert-only` covers: the Layers navigator, the layer count, and the In / Hold
/ Out / Timeline controls in the transport.

## 4. The transport carries Cue and Take

One row at the top of the stage:

```
[air lamp]  ▶ Play (SPC)   [expert: In  Hold  Out  Timeline ⌥T]
            ⟶ spacer ⟶     clock   2.4 ms   Cue (␣)   Take (⏎)
```

- An **air lamp** at the head of the row.
- A **cost readout in milliseconds** beside the clock.
- **Cue** is `.armed`; **Take** is `.key` — the one primary key on the screen.
- Keyboard: **Space = Cue**, **Enter = Take**.

**Studio put Cue/Take in a Program row and then in a Production section.** The
prototype has them on the stage, beside the graphic they act on.

## 5. The confidence strip

```css
.conf-strip { width: 92px; flex: none; flex-direction: column; gap: 6px; }
@media (max-width: 900px) { .conf-strip { display: none; } }
```

Down the right-hand side of the well, one tile per **delivery format**, each
with that format's `aspect-ratio`, each rendering the graphic, and each showing
a **warning lamp when the text overflows in that format**:

```js
renderConf() {
  FORMATS.map(f => { const bad = overflows(f.w); ... })
}
```

That is what "confidence" means here: not a status line — **you see your
graphic in every format you will deliver it in, at once, and the one that
breaks tells you so itself.** Studio has never had this.

## 6. The canvas states what it is

Overlays on the frame itself:

- top-left: `1920 × 1080 · 50p`
- bottom-right: the selected object's size

## 7. The dock header

```
Content        (spacer)        [on air lock note]   [expert: layer count]
```

The header names the panel, and states when the document is locked because it
is on air.

---

## What Studio must change

1. **Four columns, one dock.** Collapse left/right/bottom into a single right
   dock with Content first and Layers above it under `expert`.
2. **Rail down to Design · Assets · Data · Brand · Outputs.**
3. **Two levels, not three.** Beginner and Expert.
4. **Cue and Take return to the stage transport**, with Space and Enter, an air
   lamp, and the millisecond cost readout.
5. **Build the confidence strip.** `OutputSet` already carries width, height,
   cadence, layerMask and alpha; `preflight()` already reports overflow per
   node. Both halves exist and have never been joined.
6. **Canvas overlays** for format and selection size.

## What is already right

The 2D/3D switch and its flight, the axis gizmo, the ground grid, the nine
voices, the material treatment, the palette, and the undo model. None of those
contradict the prototype — they are additions the prototype does not cover.
