# BracketX — Product

**Status:** Draft · **Last updated:** 2026-07-30 · **Owner:** @Pixelborne

> This document describes *what* we are building and *for whom*. It does not
> describe how — see [ARCHITECTURE.md](./ARCHITECTURE.md). It does not describe
> *when* — see [ROADMAP.md](./ROADMAP.md).
>
> Sections marked **[ASSUMED]** were authored during Phase 0 setup and have not
> been validated with users. Treat them as hypotheses to confirm or kill, not as
> settled requirements.

---

## 1. One-line definition

BracketX is an AI-first, browser-first live production platform for broadcast
graphics.

## 2. What that means, precisely

Three claims, each load-bearing:

**Browser-first.** The operator's entire workflow — designing graphics, building
a show, running it live — happens in a browser tab. No installed desktop app, no
GPU workstation requirement, no per-seat licence dongle. Output reaches the
broadcast pipeline through a URL that any standard tool can consume as a video
source.

**Live.** Graphics change during the broadcast, driven by an operator or by
incoming data, and those changes must appear on air within a frame or two.
This is what separates BracketX from a design tool. It is also the single
hardest engineering constraint in the product and the reason the architecture
reserves a dedicated realtime seam.

**AI-first.** AI is a primary authoring surface, not a bolted-on sidebar.
The intended interaction is closer to *"build me a lower-third for this match,
in our brand palette, and bind the score to the live feed"* than to nudging
rectangles by hand. **[ASSUMED]** — the specific capabilities are unproven; see
§7.

## 3. The problem

Live broadcast graphics today force a bad trade:

| Option | What you get | What it costs |
|---|---|---|
| Broadcast-grade tools (Vizrt, Ross, Chyron) | Real capability, real reliability | Six figures, dedicated hardware, trained operators, weeks of setup |
| Streaming tools (OBS scenes, Streamlabs, static overlays) | Free or cheap, fast to start | Manual, fragile, no data binding, no team workflow, no versioning |
| Bespoke web overlays | Exactly what you want | You now employ a web developer permanently |

The gap is the middle: teams who need *real* live graphics — data-bound,
operator-driven, on-brand, reliable — but who do not have a broadcast truck or
an engineering team. That gap is BracketX's market.

## 4. Who it is for

Ordered by how well we think we serve them, best first.

1. **Esports organisations and tournament operators.** Highest-volume, most
   data-hungry, most graphics-per-hour. Brackets, team lineups, player stats,
   score bugs, transitions between matches. Already browser-native in their
   tooling and already comfortable with OBS.
2. **Semi-pro and collegiate sports.** Recurring fixtures, small crews,
   repeatable graphics packages, tight budgets. The template-reuse story lands
   hardest here.
3. **Podcast and talk-show producers.** Lower graphics complexity — name keys,
   topic cards, timers — but high volume and strong brand-consistency needs.
4. **Live events and conferences.** Sessions, speakers, schedules, sponsor
   loops. Bursty usage; may not sustain a subscription. **[ASSUMED]**

**Primary user persona:** the *operator* — one person running graphics during a
live show, often also running audio, scenes, and the stream. They are
technically confident but not a developer. They have no tolerance for a tool
that fails on air.

## 5. Product surfaces

Four surfaces, each arriving in a different phase — see
[ROADMAP.md](./ROADMAP.md).

**Workspace** — the team container. Members, roles, billing, brand assets,
shared templates. One workspace holds many projects.

**Editor** — where graphics and shows are authored. Canvas, layer/scene tree,
inspector, data bindings, AI authoring panel. This is where users spend design
time.

**Control surface** — where a show is *run*. Deliberately not the editor: a
different, calmer, denser interface built for someone under live pressure.
Large targets, keyboard-driven, no destructive actions, no ambiguity about
what is currently on air.

**Render surface** — the output. A URL producing the composited graphics with a
transparent background, consumed as a browser source by OBS/vMix/etc. Has no UI
and must never ship editor code. It has exactly one job: hit frame rate,
deterministically, forever.

## 6. What BracketX is *not*

Explicit non-goals. Each of these is a plausible-sounding feature that would
dilute the product, and naming them now is cheaper than arguing about them
later.

- **Not a video editor.** No timeline-based non-linear editing, no clip
  trimming, no rendering out finished video files.
- **Not a streaming service.** We produce graphics. We do not ingest, encode,
  transcode, or distribute video. OBS, vMix, and their peers already do this
  well and we integrate with them rather than replace them.
- **Not a general design tool.** We are not competing with Figma or Canva on
  freeform design. Our canvas exists to serve live, data-bound broadcast
  graphics.
- **Not an on-prem product.** Browser-first means cloud-hosted. Air-gapped
  broadcast facilities are not our initial market.
- **Not a scoreboard/stats provider.** We bind to data sources; we are not the
  source of truth for match data.

## 7. Open product questions

These are unresolved and each one could change the roadmap. Listed with who
should answer and by when.

| # | Question | Why it matters | Needed by |
|---|---|---|---|
| P1 | What are the top 3 concrete AI capabilities at launch? | "AI-first" is currently a positioning claim, not a spec. Until this is answered we cannot scope the AI work, and it is the differentiator. | [Phase 8](./ROADMAP.md#phase-8--ai-v1) |
| P2 | Which data sources do we bind to first? | Determines the shape of the data-binding layer. Wrong guess = rework of the editor's binding model. | [Phase 10](./ROADMAP.md#phase-10--integrations) |
| **P3** | **Are we a single-operator or multi-operator product at launch?** | **Most urgent question in the product.** It is not a feature decision — it decides the *scene document format*. A single-writer document and an operation-based/CRDT document are different formats, and choosing wrong makes collaborative editing a rewrite of the Scene Engine and the Editor rather than a feature. Tracked as gate **G2**. | [**Phase 2**](./ROADMAP.md#phase-2--scene-engine) — starts in ~8–11 weeks |
| P4 | Template marketplace: launch feature or later? | Affects whether templates need portability, versioning, and licensing metadata from the start. | [Phase 14](./ROADMAP.md#phase-14--marketplace) |
| P5 | Pricing model — per-seat, per-workspace, or usage-based? | Shapes the workspace/membership data model, which we are building in Phase 0. Cheap to keep flexible now, expensive to change after billing ships. | [Phase 9](./ROADMAP.md#phase-9--public-launch) |

## 8. How we will know it works

Deliberately few, deliberately blunt. **[ASSUMED]** — targets are placeholders
until we have real users.

- **Time to first graphic on air** for a new user. Target: under 15 minutes.
  This is the single number that best captures whether "browser-first" is real.
- **Shows run per workspace per month.** Measures whether we became part of the
  recurring workflow or stayed a toy.
- **Render-surface frame drops during live shows.** Must be effectively zero.
  One dropped frame on air costs more trust than ten features earn.
- **Graphics authored via AI vs. manually.** Directly tests the "AI-first"
  thesis. If this stays low, the positioning is wrong.
