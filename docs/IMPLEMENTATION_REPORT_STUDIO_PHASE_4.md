# Implementation Report — Phase 4, Studio as a product

**Date:** 2026-08-03 · **Branch:** `phase-2-engine`
**Brief:** transform the engineering workbench into a world-class broadcast
studio. The engine is our technology; the Studio is our product.
**Companions:** [STUDIO_PRODUCT_ARCHITECTURE.md](./STUDIO_PRODUCT_ARCHITECTURE.md) ·
[IF-005](./IMPLEMENTATION_FINDING_IF-005.md)

---

## 1. Against the brief

| Asked for | Delivered | |
| --- | --- | --- |
| Stop exposing engine concepts | 20-term rule, enforced against the rendered DOM in every section **and** every editor tab | ✅ |
| Developer Mode | A discoverable switch in Settings. Nothing deleted | ✅ |
| New application structure | 8 sections, product vocabulary throughout | ✅ |
| Home screen | Start, Recent, Your templates, Learn | ✅ |
| Layer system with real names | Background, Accent Bar, Name, Role — asserted, no `nod_` ids | ✅ |
| Contextual inspector | Phase 3A/3B; de-jargoned here | ✅ |
| Timeline as first-class | Phase 3A. Keyframes, easing, markers, retiming, zoom | ⚠️ No curve editor |
| Marketplace inside Studio | 7 packs, instant install, no manual importing | ✅ |
| Free tier | 3 themes + 3 motion + 1 broadcast package, pre-installed | ✅ |
| Assets browser | Fonts, colours, motion — the categories that exist | ⚠️ 7 of 11 blocked (IF-005) |
| Preview / Program separation | Phase 3A; the tally now also lives on the rail | ✅ |
| Visual language | Spacing scale, one motion curve, generous space, reduced-motion | ✅ |
| Do not weaken the engine | Zero engine changes. Browsing now costs **zero** rendering | ✅ |
| **30 seconds to air** | **5 of 6 steps.** Replacing a logo is impossible | ⚠️ IF-005 |

---

## 2. What changed

```
 apps/studio/src/studio/shell.ts      NEW  the IA, and the no-jargon rule
 apps/studio/src/studio/packs.ts      NEW  3 themes, 3 motion packs, 3 templates
 apps/studio/src/ui/nav.tsx           NEW  the rail, with an on-air tally
 apps/studio/src/ui/home.tsx          NEW  the dashboard
 apps/studio/src/ui/sections.tsx      NEW  Marketplace, Templates, Assets,
                                           Outputs, Settings
 apps/studio/src/ui/developer.tsx     NEW  the engine, behind the switch
 apps/studio/src/shell.css            NEW  the product visual language
 apps/studio/src/product.test.ts      NEW  20 assertions
 apps/studio/e2e/product.spec.ts      NEW  6 browser tests
 apps/studio/src/studio/workspace.ts  +    section, developerMode, packs; v2
 apps/studio/src/App.tsx              ~    section router; contextual titlebar
 apps/studio/src/ui/panels.tsx        ~    de-jargoned
```

**Verification:** 145 headless (Studio) + 21 browser + workspace 35/35 green.
**Engine changes: none.**

---

## 3. Four things found by building it

**The properties panel had been leaking "mirror" since Phase 1.** *"read from
the mirror, so layout and animation are included"* — shipped, in the product, for
three phases. The first version of my own leak test missed it too, because it
only checked the browsing sections and not the editor, which is where a designer
spends the day. Extending it to the editor is what caught it.

**The rail's on-air tally was stale.** `App` subscribed to the document store and
to the session, but not to the program bus — so the tally was correct once and
then frozen. That is the same class of staleness Phase 3A found in the frame
counter, in a place where being wrong is much worse: an operator reading OFF
while a graphic is live.

**Templates opened with their layers collapsed.** Root-only expansion meant a
first-time user saw one collapsed layer and had to know to expand it before they
could find the text they came to edit — a documentation step inside a workflow
that is supposed to need none. Now everything expands, up to a 60-node cap so an
imported scene is not unrolled.

**A template's text is data, not a layer property** — and the inspector said so
in an engine sentence. `content is bound to {"$var":"name"}` tells a broadcaster
nothing about what to do next. It now reads *"Name comes from the **name**
field. Change it in **Data**."* That is not cosmetic: it is the difference
between a dead end and a workflow.

---

## 4. Where I pushed back

**The Assets and Marketplace sections are smaller than the brief asked for.**
Seven of eleven asset categories and four of twelve Marketplace categories need
images, SVG or video, and the engine draws none of them. I raised
[IF-005](./IMPLEMENTATION_FINDING_IF-005.md) before building rather than after,
and shipped only the categories that work.

Three shortcuts were available and each is refused in the finding: an `<img>`
decoded to a texture (a second image path with different colour management — the
Canvas2D-text argument from IF-003 wearing a hat), a Marketplace with
placeholder thumbnails for uninstallable content, and an Assets panel with empty
tabs. A tab that is always empty teaches a user to distrust the panel it is in.

**One of the six success-criterion steps is impossible.** "Replacing a logo"
needs image support. Rather than quietly dropping it, the browser test asserts
the gap — so a future change cannot appear to close it without actually doing so.

**I did not build dockable panels.** The brief asks for them; the layout is fixed
and resizable instead. Rearrangeable panels are worth doing and they are not the
difference between an IDE and a product — the information architecture and the
vocabulary are, and that is where the time went.

---

## 5. What "do not weaken the engine" meant in practice

Zero engine changes this phase. Two UI decisions actively help:

**Browsing costs zero rendering.** Sections replace the editor rather than
sitting beside it, so `SceneView` unmounts and its animation-frame loop stops.
Asserted in a browser: canvas count is 1 in Design, **0** in the Marketplace, 1
again on return with the graphic intact. Keeping the editor mounted-but-hidden
would have had the engine drawing frames nobody can see.

**Developer Mode reads on render, never polls.** No interval, no subscription, no
per-frame work — the rule the workbench established about diagnostics becoming
the load they measure.

---

## 6. What is not verified

| | |
| --- | --- |
| **"Feels premium"** | Not testable, and nothing pretends otherwise. What is asserted is the vocabulary, the spacing system, the single motion curve, and that nothing animates unprompted |
| Thirty seconds, literally | The workflow is asserted; the stopwatch is not. It is 5 clicks and one text field |
| Anything visual | No screenshot or perceptual comparison exists for any surface, here or in the engine |
| Accessibility | Labels and roles are used throughout and the suite navigates by them, so the basics hold. No audit has been done — no contrast check, no screen-reader pass, no keyboard-only traversal of the new sections |
| Real content quality | Three templates by an engineer, not a broadcast designer. They are structurally right; whether they are *good* is a judgement I am not qualified to make |

That last one is worth saying plainly. The packs prove the mechanism — themes
restyle, motion applies, templates parameterise — and a designer should replace
every one of them before this ships to a customer.

---

## 7. Recommendation

**The 3D viewport, now.** It has been deferred three times and it is the last
outstanding engine capability. Two claims currently rest on headless assertion
alone: ADR-013 amendment 1's lighting, and world-space text. Neither can be
confirmed without somewhere to look, and both are the sort of thing that is
quietly wrong for a year.

**Then the asset pipeline** (images + SVG, ~3–4 weeks). It closes the Assets
browser, four Marketplace categories, and the logo step — after which the
30-second criterion is met in full.

**Then a designer.** The architecture is ready for real content; the content
shipped here is a demonstration that it works, not a claim that it is beautiful.
