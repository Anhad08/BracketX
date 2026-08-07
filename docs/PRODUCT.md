# Streamatrix — Product

**Status:** Repaired against the founder record · **Last updated:** 2026-08-07
**Owner:** @Pixelborne

> **The product was renamed BracketX to Streamatrix.** The sections below were
> authored 2026-07-30, before the Streamatrix Product Vision (2026-08-03), and
> still say "BracketX" in places. They are repaired in place, never replaced.

---

## 0. Source of truth, and the order of authority

The approved specification is **vendored in this repository** at
[`docs/design-os/`](./design-os/). It previously existed only as claude.ai
artifacts, which meant every context compaction severed the implementation from
the product. That was the single root cause of the drift documented on
2026-08-07.

| Authority | Where |
|---|---|
| 1 · The founder's words | session transcripts (`~/.claude/projects/...`) |
| 2 · Founder-approved decisions | this file, and the volumes |
| 3 · Design OS volumes | `docs/design-os/volume-*.html` |
| 4 · Blueprint | `docs/design-os/blueprint.html` |
| 5 · Implementation | `apps/`, `packages/` |

**If the implementation disagrees with the founder, the implementation is
wrong. If documentation disagrees with the founder, the documentation is
wrong.** No document in this repository outranks the founder, including this
one.

Vendored artifacts, with the claude.ai artifact each came from:

| File | Artifact | Title |
|---|---|---|
| `design-os/volume-one.html` | `da877ce5` | Design OS — Volume One |
| `design-os/volume-two.html` | `5f376485` | Design OS — Volume Two |
| `design-os/volume-three.html` | `f90480f0` | Design OS — Volume Three (Sound) |
| `design-os/volume-four.html` | `a73e2468` | Design OS — Volume Four (Invention) |
| `design-os/volume-five.html` | `f2b70a1e` | Design OS — Volume Five (Workspace Intelligence) |
| `design-os/blueprint.html` | `ac8228e9` | Studio — Final Blueprint |
| `design-os/studio-specification.html` | `357f489f` | Studio — Specification |
| `design-os/studio-prototype.html` | `1a764642` | Studio — Prototype |
| `design-os/ui-prototype.html` | `ff8427d8` | Studio — UI Prototype |

**Volumes Six, Seven and Eight are not yet vendored.** They exist as artifacts
`d63dd462`, `69c6335a` and `fa64294b`. They must be vendored before anything
may rely on them, and that is the first task of the next session.

**These artifacts conflict with one another on the Studio layout.** The
conflict is unresolved and reserved for the founder — see "Unresolved
conflicts" in [`apps/studio/PROTOTYPE.md`](../apps/studio/PROTOTYPE.md).

---

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

---

## 12. Approved modules — RESTORED

Recorded from the founder's own briefs. Present here because this document
previously omitted most of them, and an omitted module is one that quietly
stops being built. **None of these may be removed.**

**Product surfaces.** Productions · Studio · Production (on-air) · Marketplace
· Assets · Data · Brand · Outputs · Templates · Settings · Master Console ·
Replay · Scoring · Team System · Broadcast Control · Remote · Networking ·
Plugins · AI.

**RTGFX — the graphics ecosystem inside Streamatrix.** Theme Packs · Motion
Packs · Transition Packs · Broadcast Packages · Graphics Components · Virtual
Sets · Scoreboards · Leaderboards · Lower Third Collections · Tickers · News ·
Sports · Esports · Corporate · Weather · Election · Sponsor · Intro · Outro ·
Camera Packs · Lighting Presets · Future AI Packs · Future Community Packs.

> "Every RTGFX package must be production-ready."
> "One package should support hundreds of productions without requiring
> redesign."

**Every graphic must be customizable across:** Text · Fonts · Logos · Team
Branding · Images · Videos · Colors · Materials · Lighting · Camera Angles ·
Motion · Timing · Variables · Data Sources · Layout · States · Effects.

**Asset types (permanent architecture).** Images (PNG/JPEG/WebP/AVIF, alpha,
colour profiles) · Vector (SVG, no raster fallback unless explicitly chosen) ·
Video (MP4/MOV/WebM, alpha video, frame accuracy, timeline sync) · Audio
(WAV/MP3/AAC/OGG, waveform, cue points) · Fonts (TTF/OTF/WOFF/WOFF2, variable,
fallback chains) · 3D (glTF/GLB, PBR, instancing) · Materials (full PBR channel
set) · HDR/Environment (HDRI, skyboxes, reflection probes).

**Brand Kits.** "A broadcaster should upload a complete brand package once."
Logo · secondary · monochrome · icon · primary and secondary colours ·
typography · motion presets · theme · sponsor assets · backgrounds ·
watermarks.

**Cloud.** "Cloud is a core feature. Every paid plan includes cloud storage."
Projects · Templates · RTGFX purchases · Assets · Team Libraries · Workspaces ·
User Preferences · Production Settings · offline cache · automatic sync ·
conflict resolution · version history. "Never design the asset system assuming
only local storage."

**Marketplace.** "The Marketplace is the front door." Purchases · installation
· updates · package verification · dependencies · versioning · licensing ·
integrity · metadata · removal. "Every installation should integrate
immediately into Studio. No manual configuration."

## 13. The Golden Rule — RESTORED

> "Every professional feature must have a one-click version. The user presses
> ONE button. The engine performs hundreds of decisions."

| One click | The engine generates |
|---|---|
| Enable 3D | camera · lighting · environment · default material · shadows · perspective |
| Glass | transmission · IOR · reflections · roughness · fresnel |
| Animate | keyframes · easing · timing · tracks |
| Broadcast Ready | preflight · overflow · contracts · output validation · performance checks |
| Responsive | constraints · scaling · anchors |
| Social Outputs | 16:9 · 9:16 · 1:1 · 4:5, with confidence previews |

**Materials are named by outcome, never by parameter** at Beginner and Designer
level: Matte · Glass · Chrome · Plastic · Broadcast · Premium · Soft · Bold.
Advanced reveals the underlying parameters.

**Cameras and lights are infrastructure, not authoring.** "Users should not need
to create a light before seeing a beautiful result."

## 14. Progressive disclosure — RESTORED

> **The number of levels is OQ-2, open, and reserved for the founder.**
> Recorded here as approved on 2026-08-05; a later message asks for two.

| Level | Exposes |
|---|---|
| 1 · Beginner | Name · Subtitle · Logo · Colour · Animation · Take. "Nothing else." |
| 2 · Designer | Layers · Properties · Components · Variables · Motion · Templates · Constraints · Brand Kits · Assets · Scene hierarchy |
| 3 · Advanced | Camera · Lighting · Materials · Curves · Timeline · 3D Controls · Shader Settings · Projection · Performance · Debug |

## 15. The primary user journey — the acceptance test

```
Marketplace -> Install Scene -> Assets -> Drag Scene into Stage
-> Scene instantiated -> Edit -> Preview -> Cue -> Take -> Program
```

> "If this journey is incomplete, nothing else matters."

**Secondary journey:** a hybrid scene — 2D object + 3D object + text + image +
material + animation + preview + take.

## 16. Viewport philosophy — RESTORED, including the founder's revision

The 2026-08-05 doctrine said the Stage stays fundamentally 2D and "Do NOT
convert Streamatrix into Blender." The founder **revised this** on 2026-08-06:

> "this was supposd to be a 3D broadcasting software and not just 2D the main
> motive is 3D"
> "i want blender type viewport for 3d and normal for 2D"
> "2D viewport is supposed to be fixed and not moveable"
> "make the 2D and 3D viewports on the same engine but different ports... so
> that if i switch to 3D mid session it moves all the details with it... and
> same with 2D"

**Recovered position:** one engine, one Scene, **two ports**. The 2D port is
fixed, non-orbitable, and behaves like Canva. The 3D port is Blender-grade. The
08-06 instruction supersedes the 08-05 "never Blender" clause **for the 3D port
only**.

**Depth remains a property, not a mode:** "Any 2D object can become 3D...
Everything remains editable. Nothing becomes a mesh. Nothing leaves the document
model."

## 17. Identity and doctrine — RESTORED

> **Canva simplicity × Spline's invisible complexity × Ross Video reliability**

Explicitly **not**: "Figma for Broadcast", "Spline for Broadcast", "Vizrt made
easier".

- "Every visible engine concept on the beginner surface is a bug. Every
  placeholder is a bug. Every dead button is a bug."
- "If something is not implemented, either implement it or temporarily remove
  it. A smaller product that works is better than a larger product that lies."
- "Search before building. Reuse before creating. Never duplicate engine
  functionality."
- Success is measured by "What can a broadcaster do today that they could not do
  yesterday?" — never by tests, modules, commits or benchmarks.
