# Studio: a production system, and a UI that serves beginners and experts

**Date:** 2026-08-13
**Status:** approved design, ready for planning
**Supersedes:** nothing. Amends the Production section of `STUDIO_PRODUCT_ARCHITECTURE.md`.

---

## 1 · The problem

Two problems arrived together, and the second turned out to contain the first.

**The interface reads as an engineer's tool.** Measured against the product's own
Design OS (Volume One, C1–C10), the Design screen fails several checks outright:
type sizes below the six-step scale (which is what truncated an easing label to
`easir`), no single primary action, undesigned empty and error states. The stage —
the graphic, the only object anyone cares about — is the smallest element on
screen. Meanwhile `Depth` (`beginner` / `expert`) exists in `workspace.ts` and is
unreachable from the UI, so neither audience gets what it was built for.

**Production is not a production system.** `ProgramBus` holds one preview session
and one program session, and `take()` is `program.open(document)` — it *replaces*
whatever was on air. A lower third and a ticker cannot be out at the same time.
There is no rundown: what comes next lives in the operator's head. There are no
numbered keys and no panic. `production.tsx` is a scrolling page whose monitors
sit below the fold, under the live-data and check blocks.

The second problem is the larger one, and it is a **capability** problem, not a
layout one. Conformance check C8 — *no control exists for a capability the engine
lacks* — means the engine work leads and the interface follows.

---

## 2 · Scope and decomposition

The redesign covers every section. That is too large for one implementation plan,
so it decomposes into five sub-projects, each with its own plan and its own
verification. This document specifies P0–P2 to implementable depth and sketches
P3–P4, which will get their own spec cycles.

| | Sub-project | Depends on |
|---|---|---|
| **P0** | Foundation — the level mechanism, conformance primitives | — |
| **P1** | Channels — `ProgramBus` becomes multi-layer | P0 |
| **P2** | The production desk — rundown, hotkeys, fixed layout | P1 |
| **P3** | Design section — stage, docks, summoned timeline | P0 |
| **P4** | Catalogue (Home, Templates, Marketplace, Assets), then edges (Outputs, Settings) | P0 |

Production precedes Design deliberately. Design's problems are conformance
problems with known fixes; Production's are missing capability, and capability
takes longer to be wrong about.

---

## 3 · P0 — Foundation

### 3.1 The level mechanism

Two workspaces, named for the **task** rather than the person. Nobody wants to be
labelled a beginner by their own tool.

`Depth` keeps its type name and its two values (`beginner` | `expert`) in
`workspace.ts`. Only its expression changes:

| Section | Left position | Right position |
|---|---|---|
| Design | **Fill in** | **Build** |
| Production | **Air** | **Desk** |
| Catalogue, edges | *no switch* | — |

Three rules make it work:

1. **Visible.** A segmented control in the header, beside the document name, in
   the same screen position in every section. The current failure is not that the
   levels are wrong — it is that they are unreachable.
2. **The right position is a superset.** Switching never removes a control that
   was in use, and shared controls do not move. In Design the content fields keep
   the same x and the same width in both positions; the stage narrows to make room
   for the layers column. Fields that jump make a switch feel unsafe to press.
3. **Reversible in one key**, both directions. `⌥E`, already bound.

**Known risk, accepted:** a switch whose labels change per section is a switch the
operator re-reads. The alternative is one neutral pair (*Simple* / *Full*) used
product-wide, at the cost of the task-naming. Ship the section-specific labels;
revisit if it confuses anyone.

### 3.2 Conformance primitives

Shared components and tokens that make C1–C10 the default rather than an act of
discipline: a control set (button, field, chip, segmented control) at the six type
sizes with their bound tracking, spacing drawn only from the nine steps, and a
designed set of section states (loading, empty, error, offline).

**C1 and C2 become a test, not a memo.** A Playwright pass walks computed styles
across every section and fails on any `padding`, `margin`, `gap`, `font-size` or
`letter-spacing` outside the scale. A design system that cannot fail a review is
decoration — Volume One says so; this is what saying so costs.

---

## 4 · P1 — Channels

### 4.1 The model

`ProgramBus` stops owning one program session and starts owning several. Each
channel is a full `StudioSession` with its own host, mirror and clock — the same
argument `program.ts` already makes for separating Preview from Program, applied
one level further. One runtime cannot be at two frames, and two graphics on air
are at two frames.

```ts
export type ChannelId = "background" | "lower" | "upper" | "overlay";

/** Compositing order, bottom to top. Fixed, so stacking is never ambiguous. */
export const CHANNELS: readonly ChannelId[] = [
  "background", "lower", "upper", "overlay",
];
```

Four, named by broadcast role rather than numbered, because an operator says "kill
the ticker" and not "kill layer three".

### 4.2 The bus

```ts
export interface Channel {
  readonly id: ChannelId;
  readonly session: StudioSession;
  readonly canvas: HTMLCanvasElement;   // transparent; composited by z-order
  readonly state: ProgramState;         // off-air | cued | on-air | holding
  readonly playing: string | null;
  readonly cueStale: boolean;
  readonly pending: boolean;
}

export class ProgramBus {
  readonly preview: StudioSession;

  /** Builds the channel's session on first use. */
  channel(id: ChannelId): Channel;
  /** Channels with frames going out, in compositing order. */
  get live(): readonly ChannelId[];
  /** True when ANY channel is on air. Drives the tally and audio ducking. */
  get onAir(): boolean;

  cue(id: ChannelId): TakeResult;
  uncue(id: ChannelId): TakeResult;
  take(id: ChannelId, mode?: TakeMode): TakeResult;
  hold(id: ChannelId): void;
  continue(id: ChannelId): TakeResult;
  clear(id: ChannelId): void;
  clearAll(): void;
}
```

**Lazily constructed.** A channel's session is not built until something is taken
to it. An operator running one lower third pays for one session. Channels are
never torn down within a run — rebuilding a mirror mid-show is exactly the cost
the split exists to avoid.

**No default channel.** Every call names its target. A defaulting API is how
everything quietly lands on one layer and the feature appears not to work.

**Show-level state stays on the bus.** `takes`, `firstAiredAt`, `wentOffAt` and
`elapsed()` are properties of the transmission, not of a layer: a show that put
thirty-four graphics out across four channels ran from its first take to going off
air. `clearAll()` stamps `wentOffAt`; `clear(id)` does not.

**Per-channel invariants**, each carried over from the single-channel bus and now
scoped to a layer: cue is refused while that channel is on air; a take consumes
its own cue; `#airedHash` is not cleared by `clear`, so `pending` does not become
true merely because a layer emptied.

### 4.3 Compositing

Each channel renders to its own transparent canvas. The Program monitor stacks
them in `CHANNELS` order. This is real compositing rather than a preview trick —
the same stack is what a future output encoder consumes.

**Context budget:** four channels + preview + the hover player = six WebGL
contexts, against a browser ceiling near sixteen. The codebase has already met
that ceiling once (the Marketplace hover player exists because forty contexts do
not work), so the budget is stated here rather than discovered later.

### 4.4 Migration

Call sites that today say `bus.take()` — the palette commands in `App.tsx`, the
program row, `Monitors` — name a channel instead. Palette commands target the
selected rundown item's channel, falling back to `"lower"` when nothing is
selected. `Nav`'s tally reads `bus.onAir`, whose meaning is unchanged: any channel
live, a cued channel not counted.

---

## 5 · P2 — The production desk

### 5.1 The rundown

A rundown is an ordered list of items; an item is a graphic, plus tonight's
values, plus where it goes.

```ts
export interface RundownItem {
  readonly id: string;
  readonly name: string;
  readonly source:
    | { readonly kind: "template"; readonly templateId: string }
    | { readonly kind: "document"; readonly json: string };
  readonly channel: ChannelId;
  /** Tonight's values. Overrides, never document edits. */
  readonly data: Readonly<Record<string, string | number>>;
  /** 1–9, or null. */
  readonly hotkey: number | null;
}

export interface Rundown {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly items: readonly RundownItem[];
}
```

It lives in `apps/studio/src/studio/rundown.ts` as its own saveable document, and
**not** in the scene format. `program.ts` already refuses to put `role:
"entrance"` in the format on the grounds that the engine would have to understand
a product concept forever; a rundown is a larger version of the same noun and gets
the same answer.

Persisted under `streamatrix.studio.rundown.v1`, sanitised on load in the manner
`workspace.ts` establishes — a stale or hostile store falls back to an empty
rundown rather than throwing. Saveable to disk through the existing
`createStorage` seam, so a show is portable.

### 5.2 Item state is derived

```ts
export type ItemState = "ready" | "cued" | "live" | "done";
```

Computed from channel state plus the set of item ids that have reached air this
run (held on the bus beside `#takes`). **Never stored on the item.** Two answers
to "what is on air" is how the wrong one comes to be believed — the same argument
that keeps live variable values in the runtime instead of a second store.

### 5.3 Hotkeys

Registered in `commands.ts` alongside every other command, so they appear in the
palette and the keyboard reference:

| Command | Binding |
|---|---|
| `air.cueItem.1` … `.9` | `1`–`9` |
| `air.takeNext` | `Ctrl/⌘+Enter` |
| `air.clearAll` | `Shift+Esc` |

**Active only in the Production section at the Desk level**, and never while a
text field has focus. `1`–`9` are ordinary characters everywhere else, and a
binding that swallows typing is worse than no binding.

Plain `Enter` is excluded because commit `af9e138` deliberately returned it to the
focused control; taking it back for air would reintroduce the defect that fix
removed. `Ctrl/⌘+Enter` keeps the operator's expectation that Enter means take
while leaving the unmodified key where it belongs. `Space` is unavailable — it
pans the viewport.

`Shift+Esc` for panic is a judgement: a chord one hand cannot strike accidentally,
executing instantly once struck. Air is not undoable, so the guard belongs in the
gesture, not in a confirmation dialog — C5 forbids delaying a consequential action
behind animation, and a modal is worse than an animation.

### 5.4 The layout

A fixed grid. `overflow: hidden` on the section; regions that can overflow — the
rundown list, the live-data column — scroll internally. Nothing an operator needs
is ever below the fold, which is the specific failure of the current page.

```
┌────┬──────────────┬───────────────────────────┬────────────┐
│    │  RUNDOWN     │   PREVIEW  │   PROGRAM    │  LIVE DATA │
│ R  │ 1 ▸ Lower 3rd│  ┌───────┐ │ ┌──────────┐ │  Name  ▭▭▭ │
│ A  │ 2 ● Score    │  │       │ │ │          │ │  Score ▭▭▭ │
│ I  │ 3 ○ Ticker   │  └───────┘ │ └──────────┘ │            │
│ L  │ 4 ○ Break    │            │              │            │
├────┴──────────────┴────────────┴──────────────┴────────────┤
│ Lower ● Score  [clr]   Upper ○   Overlay ○   [CUE] [TAKE]  │
└────────────────────────────────────────────────────────────┘
```

The **channel strip** along the bottom is one cell per layer, each with its own
clear, so the ticker can be dropped without touching the score. Program is drawn
larger than Preview: they are not equals, and the one going out should look like
it.

Preflight (`preflight`, `contentSurface`) keeps its role, moving from a block in
the scroll to a state on the cued item — an operator wants "this one has a
problem" attached to the thing, not filed under a heading.

### 5.5 The two levels here

- **Air** — one graphic at a time on `lower`, large Cue and Take, no rundown and
  no channel strip. The single-graphic workflow that exists today, made legible.
- **Desk** — everything above.

---

## 6 · P3 — Design section (sketch)

Rebuilt against the same foundation. The stage takes the frame; the bottom dock's
controls come onto the type scale; the right dock's sections (Content, Colour,
Motion, Light, 3D) each gain their own `▸ Advanced` disclosure so *Build* is not
one wall of controls; exactly one primary action. Its own spec.

## 7 · P4 — Catalogue and edges (sketch)

Home, Templates, Marketplace and Assets are four grids implemented four times;
they become one catalogue component with four data sources. Home's current design
is the reference — it is the surface that already works. Outputs and Settings get
the form language and nothing more. Its own spec.

---

## 8 · Verification

**Unit — channels.** Taking to `lower` leaves `upper`'s canonical hash untouched.
Clearing one channel leaves the others live. `onAir` is true while any channel is
live and false when only a cue is armed. `clearAll` stamps `wentOffAt`;
`clear(id)` does not. Cue is refused on a channel already on air.

**Unit — rundown.** Ordering survives a serialize/parse round trip. A corrupt
stored rundown loads as empty rather than throwing. `itemState` returns `live`
only for items whose channel is actually transmitting them.

**E2E — the test that matters.** Cue item 3 by hotkey, take it, and assert *by
pixel readback* that two graphics are on air simultaneously. Everything else in P1
can pass while the feature does not work; this cannot.

**E2E — panic.** `Shift+Esc` from three live channels leaves all four off air and
the tally reading OFF.

**Conformance.** The computed-style pass of §3.2, run over every section.

**Performance.** Four live sessions measured on the low-end device profile through
the existing `studio.bench.ts` harness, before the UI commits to offering four.

---

## 9 · Risks and dependencies

1. **Four mirrors is four mirrors.** If the low-end profile cannot hold four live
   channels at frame budget, the answer is fewer channels offered on that profile
   — not a slower show. The measurement in §8 gates the layout.
2. **A hard dependency is uncommitted.** The render-order fix that multi-layer
   compositing relies on sits in the working tree at
   `packages/engine-render-three/src/three-backend.ts:392`, unmerged, alongside
   leftover debug instrumentation at lines 394–408 that logs on every mesh attach.
   A `console.log` on that path during a four-channel show is a performance defect
   in its own right. This belongs to another session; it must land before P1 can
   be verified.
3. **Scope.** P1 and P2 together are the bulk of this work and considerably larger
   than the request that started it. P3 and P4 should not be planned until P2 is
   in.

## 10 · Out of scope

Multi-channel *output* encoding, remote operator control, multi-machine sync, and
any rundown import from an external playout system. The rundown is a local
document. Nothing here requires a capability the engine does not have, which was
the constraint.
