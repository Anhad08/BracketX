# Streamatrix — the mark

Everything in this folder is generated. Nothing here was drawn by hand, and
nothing here should be edited by hand — change
[`tools/brand/streamatrix-mark.mjs`](../../tools/brand/streamatrix-mark.mjs)
and regenerate, or the next run will overwrite you.

```bash
node tools/brand/streamatrix-mark.mjs   # SVGs
node tools/brand/render.mjs             # PNGs + favicon.ico
node tools/brand/proof.mjs              # png/_proof.png — every variant, both grounds
node tools/brand/favicon-proof.mjs      # png/_favicon-proof.png — the small end, magnified
```

## How the S is built

A five-stroke angular spine, point-symmetric about the origin: **bar → descender
→ diagonal → descender → bar**. The top bar joins the middle on the *left*, the
middle joins the bottom on the *right*. That alternation is the whole letter — an
E joins everything on the left, and a shallow diagonal reads as a third
horizontal bar and turns the S back into one. `G.mid` is the number that governs
it and is the most sensitive value in the file.

The stroke is modulated along the spine: light through the bars (`Wbar`), heavy
through the diagonal (`Wmid`). The only reason that modulation exists is the play
button — the diagonal has to be thick enough to carry it with a dot of clearance
on each side, while the bars stay light enough to keep the counters open. Keep
the two within reach of each other, though: too far apart and the letter reads as
a heavy diagonal with two thin rails attached rather than as one stroke.

**The bars are not straight.** Each is a circular arc of sagitta `G.bow`, about
2% of its own length, bulging away from the centre. A long horizontal reads as
sagging when it is actually dead level, so the bow is first an optical
correction; and because the arc's ends are tilted, the bar arrives at the
descender already turning, which is what makes the S read as a ribbon rather than
as parts welded at right angles.

`G.bowLift` decides how the sagitta is split between crown and chord. It matters
more than it sounds: the bar's low end is the ceiling of the counter, so bowing
symmetrically about the old bar line pinches the counter shut by half the
sagitta. Carrying the curve upward instead spends the bow on overall height —
imperceptible — rather than on the one gap in the letter that has none to spare.

Every corner is round. Each stroke is a capsule, so the terminals end in caps and
the outer corners round at the stroke radius for free. The inner corners are the
ones that have to be bought: the five capsules are joined with a **smooth union**
of radius `G.fillet`, which is most of the difference between a jointed letter
that reads as hard and one that reads as drawn. It is not free — the fillet eats
into the counters from both sides, so it is paid for out of `bar`.

The play button is an equilateral triangle, carved from the diagonal, centred
across the band rather than on the spine (the triangle is taller than it is wide
and the band is tilted, so its support is lopsided) and nudged right, because a
right-pointing triangle reads as sitting left when it is centred geometrically.
Its corner radius is deliberately small: an equilateral triangle's inradius is
only 0.289 of its height, so rounding costs far more area here than intuition
suggests.

Signed distance to that spine is computed in closed form, and the LED matrix
samples that field rather than tracing a raster. The combine is two-stage, and
the stages are not interchangeable: **within** a stroke the sub-segments of a
curved bar join with a plain minimum, because they are near-collinear links of
one curve and smoothing between them would swell the bar by `k/4` along its whole
length; **between** strokes the smooth union applies, at that corner's own fillet. The vector silhouette is
**contoured from the same field** by marching squares — hand-offsetting each
flank cannot express round caps, smooth-union fillets and a carved triangle all
at once, so the outline is traced from the field instead. Silhouette and matrix
therefore agree by construction, not by maintenance.

## Colour

Hue is **angular about the mark's centre** — one full spectrum wrapped around the
letter. Magenta at the top left, red at the top right, amber down the right
flank, green at the bottom right, cyan across the bottom, blue back up the left.
`HUE_OFFSET` is what pins the wheel to the letterform; it alone decides which
colour lands on which stroke. The core desaturates and lifts toward white.

Every LED is then **luminance-balanced**: at a fixed HSL lightness, blue reads as
a hole and yellow as a flare, which would stop the spectrum from holding together
as one lit surface. Each hue is solved onto a common luminance and blended back
part-way, so the spectrum still breathes.

## Motion

Not blur, and not speed lines. Every row sheds lit pixels to its *left* and
nothing trails forward — motion runs one way, which is what separates a signal
from a mirror-image decoration. Streak length varies per row and most rows shed
nothing at all (`trail.rowGate`), so the result is a handful of distinct streams
rather than one soft smear off the side of the letter.

The panel itself stays perfectly on-lattice. Only what has **left** the panel
disperses: shed particles drift off the grid by `trail.scatter`, growing with
distance travelled, and run smaller than the LEDs they came from. Pixels in
flight are not still on the grid they came from — and rows of them landing in
perfect columns is the one thing that makes a transmission read as wallpaper.

## Dot grading

Four tiers, all falling out of one signed distance:

| Where | Size |
| --- | --- |
| Deep inside the letter | `rMax` — full |
| Through the transition band (`fillIn`) | medium, on a smoothstep |
| The last ring at the edge (`fillOut`) | `rMin` — small, with `dither` breaking it up |
| Motion trails | smaller again (`trail.taper`), fading to specks |

Bloom is one blur of the matrix, applied twice at two radii via `<use>` — the dot
data exists once in the file. Never add a per-dot filter. Both radii are tied to
`M.pitch`, so the glow keeps its proportion if the panel density changes.

## Files

| Deliverable | File | Use |
| --- | --- | --- |
| Master SVG · dark version | `streamatrix-mark.svg` | **Primary.** Full matrix, OLED bloom. Bloom only makes sense against a dark ground, so the master *is* the dark version. |
| Light version | `streamatrix-mark-light.svg` | Same matrix, bloom removed. **Light grounds and print** — on white a bloom greys the paper instead of lighting it. |
| Monochrome black | `streamatrix-mark-black.svg` | Single colour, light grounds. |
| Monochrome white | `streamatrix-mark-white.svg` | Single colour, dark grounds. |
| Editable vector | `streamatrix-mark-solid.svg` | Pure geometry, no matrix. Masks, stencils, embroidery, cutting, and any edit to the letterform itself. |
| App icon | `streamatrix-icon.svg` | 512 tile, rounded rect + spectrum rim. PNGs at 1024/512/256/180/128. |
| Favicon | `streamatrix-favicon*.svg`, `favicon.ico` | The matrix, hinted per size — see Sizing. ICO packs 16/32/48/64. |
| — | `png/` | Rasterised through Chromium, so filters match what a browser shows. |

### Sizing

The favicon **is** the matrix, hinted per size. It is not the master mark scaled
down — that turns to mush, because a dot pitch fine enough to draw the S at full
size is finer than a pixel at 16px.

Instead every ICO entry has its own pitch, chosen so the letter stands a fixed
number of LEDs tall whatever the pixel size. The panel gets coarser as the icon
gets smaller, exactly the way a real LED wall does when you walk away from it.
Dots also run fatter and the edge dither is off: at this pitch every site is
load-bearing, and a missing dot is a missing chunk of letter.

| Size | Rows | LEDs | Source |
| --- | --- | --- | --- |
| 16 | 8 | 48 | `streamatrix-favicon-16.svg` |
| 32 | 11 | 76 | `streamatrix-favicon-32.svg` |
| 48 | 13 | 110 | `streamatrix-favicon-48.svg` |
| 64 | 15 | 147 | `streamatrix-favicon.svg` |
| 128 | 19 | 222 | `streamatrix-favicon-128.svg` |
| 128 and up | — | 834 | `streamatrix-icon.svg` — full-density matrix |
| 512, print | — | 834 | master SVG, any size; it is resolution-free |

`favicon.ico` packs the 16/32/48/64 PNGs, each rendered from its own hinted SVG.
**Never render one favicon size from another size's SVG** — the hinting is the
whole point. `streamatrix-favicon-solid.svg` keeps the flat-geometry version for
stamping, embroidery and one-colour use.

At 8 rows the 16px mark is at the floor of legibility; below that the S stops
being an S. Judge any change to `FAVICON_HINT` with
`node tools/brand/favicon-proof.mjs`, which renders the ladder at true size on
both grounds and magnified 6×. Guessing at this scale does not work.

## Not included

No wordmark or lockup. The "STREAMATRIX" logotype in the reference is a custom
geometric face; setting it in a substitute would change the identity more than
anything in the mark does, and drawing it is a separate piece of work. The mark
here is built to sit alongside that logotype once it exists.
