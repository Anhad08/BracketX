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
| `.spine` | **a 3px hairline across the TOP of the whole app** — see §11 |
| `.rail` | primary navigation |
| `.stage` | transport row, then the well |
| `.dock` | **ONE** dock, on the right |

**Studio today has three docks (left, right, bottom). The prototype has one.**
Layers and Content live in the same dock, stacked, with Content always first.

*(An earlier reading of this file called the spine a navigation column. It is
not. It is the tally — see §11.)*

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

## 7. The dock body — four groups, in this order

```
[expert]  Layers
          Content          Name · Role · Logo
          Look             Colour · Entrance
[expert]  Motion · generated   Definition · Frames
          ─────────────────────────────────────
          foot hint
```

**"Motion · generated"** is the Golden Rule made literal: the expert panel
shows the DEFINITION that the two beginner choices (Colour, Entrance) produced.
Not a separate motion system — the same one, revealed.

The foot states the bargain in one line, and it differs by level:

- beginner — *"Everything else is decided for you. **⌥E** to see how."*
- expert — *"Layers, motion and frames. **⌥E** to hide."*

**⌥E toggles expert.** One key, both directions.

Frames, not seconds: `frames: 12`. Motion is measured in frames because
broadcast is.

## 8. The data, by name

**Templates** — three, each with real sample content, not lorem:

| id | Name | Description | Sample |
|---|---|---|---|
| `lower` | Lower third | Name and role over a picture | Amara Okonkwo · Chief Correspondent · Lagos |
| `strap` | Breaking strap | A headline across the frame | Markets close at record high · Business |
| `sponsor` | Sponsor bar | A partner mark with a line | Match Day · In partnership with |

**Colours are named by ROLE, never by hex:**

`Brand blue` `Brand gold` `Brand teal` `Brand claret` `Neutral`

**Logos:** `None` `BBS` `MD` `Sport`

**Entrances:** `rise` `wipe` `slide`

**Formats** — the primary, and the four the confidence strip carries:

```js
PRIMARY = { id:"1080", nm:"1080p50", w:1920 }
FORMATS = [ 2160p50 (16/9), 720p50 (16/9), 9:16 (1080), 4:3 (1440) ]
```

The prototype leaves a note beside these worth reproducing verbatim:

> *The primary is checked on exactly the same terms as the secondaries. It was
> not, briefly, and the result was a clipped name on the main canvas with no
> warning anywhere — the precise failure the confidence strip exists to stop.*

## 9. Air has THREE states, not two

```js
S.air = "off"   //  off · cued · live
```

**off → cued → live.** Studio has on-air and off-air. The prototype cues
first, which is what the `Cue (␣)` key is for and why it renders `.armed`.

## 11. The spine IS the tally

```css
.spine { position:absolute; inset:0 0 auto 0; height:3px; z-index:30;
         background:rgba(255,255,255,.05);
         transition:background .5s var(--weight), box-shadow .5s var(--weight); }
.app.live .spine { background:linear-gradient(180deg,#ff8078,var(--live) 50%,#a81d16);
                   box-shadow:0 0 16px rgba(255,59,48,.85), 0 0 48px rgba(255,59,48,.3); }
.app.live .spine.igniting { animation:ignite .09s var(--weight); }
```

**A three-pixel hairline across the top of the entire application.** Nearly
invisible off air; a glowing red bar when live, with a 90ms `ignite` flash at
the moment of the take.

This is the most important single thing on the screen and it costs three
pixels. You cannot be on air and not know it, from any distance, without
reading anything. Studio has a text tally in a corner.

## 12. The keyboard, and one rule worth quoting

```js
// ⏎ takes, unconditionally, even from a focused field. A show outranks a form.
if (e.key === "Enter") { e.preventDefault(); take(); return; }
if (e.altKey && e.key === "e") { toggleExpert(); return; }
if (typing) return;
if (e.key === " ") cue();
if (e.key === "Escape" && S.air === "cued") S.air = "off";
```

| Key | Does | While typing |
|---|---|---|
| `⏎` | **Take** | **yes — a show outranks a form** |
| `⌥E` | toggle expert | yes |
| `␣` | Cue | no |
| `Esc` | un-cue | no |

**Take is reversible by taking again** — live → off. And an air timer counts
elapsed seconds into the transport while live.

## 13. Entrances are real animation specs

```js
STYLES = [
  { id:"rise",  nm:"Rise + fade", f:12, ease:"glide", note:"translate up, opacity 0→1" },
  { id:"wipe",  nm:"Wipe",        f:10, ease:"glide", note:"reveal along the long axis" },
  { id:"slide", nm:"Slide",       f:14, ease:"glide", note:"translate from the frame edge" },
  { id:"scale", nm:"Scale",       f:11, ease:"press", note:"0.94 → 1 with opacity" },
  { id:"hold",  nm:"None",        f:0,  ease:"press", note:"present from frame 0" },
]
```

Each carries its own **frame count** and **easing**, and a note in plain words.
That note is what "Motion · generated" shows the expert.

## 14. First run, and coaching

The start screen asks one question:

> ### What are you making?
> Pick one. You can change everything afterwards.

Then the three templates. That is the Canva test, verbatim, as a screen.

`coach(html, ms)` shows a dismissible hint that auto-hides after 5s; once
dismissed, `S.coached` silences coaching for the session. Take fires one:
*"On air. …"*

## 15. Overflow is MEASURED, not guessed

```js
/* Overflow is a real measurement in this prototype: the name is laid out at
   the format's width and compared against title safe. An implementation does
   this in the shaping pass; the arithmetic is the same shape. */
function overflows(fmtWidth) { ... }
```

Studio already has this in `preflight()` reading real shaper output — it has
simply never been run per format.

## 10. The dock header

```
Content        (spacer)        [on air lock note]   [expert: layer count]
```

The header names the panel, and states when the document is locked because it
is on air.

---

## Two decisions, settled by the founder

The prototype and the briefs disagreed in two places. Both are now decided,
and neither is my inference:

**1. Air lives in BOTH places.** Cue and Take return to the stage transport
exactly as the prototype has them — Space, Enter, the armed Cue key, the air
lamp — *and* Production stays as the operator's surface: scene list, preview,
checks, take, for the person who did NOT build the graphic.

One bus, two surfaces. No duplicate logic — Production and the transport both
drive `ProgramBus`, the way the command palette and the context menu both run
the same `StudioCommand`.

**2. The rail is the prototype's five, plus what the product needs.**

```
RAIL                    SECONDARY
Design                  Marketplace
Assets                  Settings
Data
Brand
─────
Outputs
```

Home stops being a destination and becomes the **"What are you making?"**
start screen. Marketplace and Settings leave the main rail — they are places
you visit, not the working set of somebody making a graphic.

---

## The Babylon adapter — how it is to be built

A second `MirrorBackend`, one active per session. **Not** thirty methods
because the interface has thirty.

> Every Babylon commit must unlock a visible user capability.

The first slice is one complete 3D workflow, end to end:

1. Create a 3D scene
2. Place a cube
3. Orbit the camera
4. Move, rotate and scale it
5. Apply a material
6. Add a light
7. Preview it
8. Put it on air

Only once that works does backend coverage expand. Anything the slice does not
need — render targets, texture updates, layer masks beyond the default — waits
for the workflow that needs it.

The bugs the three adapter already paid for must not be repaid:

- a camera's `matrixWorldInverse` when its node moves
- an attachment mesh inheriting its node's layer mask
- resource retain/release balance (`isBalanced()`)
- `snapshot()`, which is what found the checkerboard bug

Both adapters should run the same conformance suite, so Babylon cannot repeat
them.

---

## What Studio must change

1. **Four columns, one dock.** Collapse left/right/bottom into a single right
   dock with Content first and Layers above it under `expert`.
2. **Rail down to Design · Assets · Data · Brand · Outputs.**
3. **Two levels, not three.** Beginner and Expert.
4. **Cue and Take return to the stage transport**, with Space and Enter, an air
   lamp, and the millisecond cost readout.
5. ~~**Build the confidence strip.**~~ **Done** — `185a088`. One tile per
   delivery format, the primary among them, showing the engine's own pixels
   (a secondary format is a window on the frame already drawn) with a lamp per
   format. It found a real bug on its first run: the engine anchors a rect on
   its centre and a text block on its top-left corner, and Studio assumed
   centred for both — so every text layer's handles, hit area and snap edges
   sat half a box-width from the words. `boxAnchorOf` now states the
   convention where it is established.
6. ~~**Canvas overlays** for format and selection size.~~ **Done** — `08bf236`.
7. ~~**Air is three states** — off, cued, live — with Cue on Space and Take on
   Enter, and the Cue key rendered armed.~~ **Done (states)** — `f74ec1f`.
   `off · cued · live` on the bus, the spine, the rail tally, Production and
   the Program row, with the Cue key rendered `.armed`. Cued also reports when
   the graphic was edited after it was armed.

   **Two divergences, both recorded in the code:**

   - **Cue is `C`, not Space.** The prototype's handler cues on Space while
     its own transport labels Play "SPC" — the specimen contradicts itself,
     the way Volume One §4 does about `offair`. Space stays play/pause;
     Studio has a timeline somebody scrubs all day.
   - **Take is still one-directional.** The prototype takes again to go off
     air. Streamatrix has an explicit, named OFF AIR control and an `offair`
     voice, and one key that both starts and kills a transmission is a
     gallery hazard a three-field prototype does not have to think about.

   Still outstanding from this item: **Enter takes, even from a focused
   field** (change 13) — it belongs with the transport row, change 4.
8. **The dock is four groups in a fixed order**: Layers (expert), Content,
   Look, Motion · generated (expert), then a foot line that states the bargain
   and names ⌥E.
9. **Colours are named by role.** Studio shows swatches; the prototype shows
   "Brand blue".
10. **Motion is measured in frames**, and the expert panel shows the generated
    definition rather than a second motion system.
11. **⌥E is the one key** that moves between the two levels.
12. **The spine.** A 3px hairline across the top of the app, red and glowing
    when live, with a 90ms ignite on the take. Three pixels, and you cannot be
    on air without knowing it.
13. **Enter takes, even from a focused field** — a show outranks a form.
    Space cues, Escape un-cues, and taking again goes off air.
14. **Entrances carry frames and easing**, and the expert panel shows the
    generated note.
15. **The start screen asks "What are you making?"** and offers three
    templates with real sample content.
16. **Coaching**: one dismissible hint at the moment it is needed, silenced
    for the session once dismissed.

## What is already right

The 2D/3D switch and its flight, the axis gizmo, the ground grid, the nine
voices, the material treatment, the palette, and the undo model. None of those
contradict the prototype — they are additions the prototype does not cover.
