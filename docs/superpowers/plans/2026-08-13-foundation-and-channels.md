# Foundation and Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Design OS scale and make the beginner/expert level reachable from the UI (P0), then turn `ProgramBus` from a single-channel bus into four independently-airable channels (P1).

**Architecture:** P0 is additive — two new spacing steps, six type tokens, a per-section label map, and one new control. P1 changes `ProgramBus` from owning one `program` session to owning a lazily-built map of `ChannelId → StudioSession`, each with its own host, mirror and clock. The bus receives a **factory** rather than pre-built sessions, so tests inject `MockMirrorBackend` and `App.tsx` injects real backends.

**Tech Stack:** TypeScript, React 18, Vite, Vitest (unit), Playwright (e2e), Three.js via `@bracketx/engine-render-three`.

## Global Constraints

- **Spacing:** every value is one of nine — `4 8 12 16 24 32 48 64 96` px. No value between them. (Volume One C1)
- **Type:** every size is one of six — `30 20 14 13 11 9` px — each with its bound tracking `-.036 / -.028 / -.018 / -.004 / 0 / .16` em. No local `letter-spacing` overrides. (C2)
- **Semantic hue:** the on-air, attention, cue and health hues appear only where they carry that meaning. (C3)
- **One primary action per surface.** (C4)
- **No control for a capability the engine lacks.** (C8)
- **Nothing loops, nothing pulses.** Motion is only ever a response. (C10, and `shell.css:14`)
- **No engine terms in user-facing strings** with Developer Mode off. The forbidden list is `ENGINE_TERMS` in `apps/studio/src/studio/shell.ts:109`. This bans `mirror`, `backend`, `snapshot`, `mesh`, `handle`, `transaction` and others from every label, command title and panel heading.
- **Branch:** `worktree-production-system-spec`, rebased onto `phase-2-engine`.
- **Unit tests:** `cd apps/studio && npx vitest run <file>`. **All studio tests:** `cd apps/studio && npm test`. **E2E:** `cd apps/studio && npx playwright test <file>`.

## File Structure

| File | Responsibility |
|---|---|
| `apps/studio/src/shell.css` | *Modify.* Completes the spacing scale; adds the six type tokens. |
| `apps/studio/src/conformance.test.ts` | *Create.* Ratchet test: authored CSS may not gain new off-scale values. |
| `apps/studio/src/studio/shell.ts` | *Modify.* Adds per-section level labels + `levelLabels()`. |
| `apps/studio/src/ui/level-switch.tsx` | *Create.* The two-position segmented control. |
| `apps/studio/src/levels.test.ts` | *Create.* Unit tests for the label map. |
| `apps/studio/e2e/levels.spec.ts` | *Create.* E2E: the switch is visible, moves, and persists. |
| `apps/studio/src/studio/channels.ts` | *Create.* `ChannelId`, `CHANNELS`, `ChannelFactory`. |
| `apps/studio/src/studio/program.ts` | *Modify.* `ProgramBus` becomes multi-channel. |
| `apps/studio/src/channels.test.ts` | *Create.* Channel independence, clearAll, show-level state. |
| `apps/studio/src/App.tsx` | *Modify.* Builds the bus with a factory; commands name a channel. |
| `apps/studio/src/ui/monitors.tsx` | *Modify.* Stacks the channel canvases into the Program monitor. |

---

# P0 — Foundation

### Task 1: Complete the scale, and ratchet it

`shell.css` declares seven spacing steps where Volume One specifies nine, and
declares **no type tokens at all** — every font size in the product is a literal.
That is the root cause of the truncated `easir` label. This task adds the missing
tokens and installs a test that stops the problem growing.

**Files:**
- Modify: `apps/studio/src/shell.css:22-28`
- Create: `apps/studio/src/conformance.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties `--s8`, `--s9`, `--t-display`, `--t-title`, `--t-head`, `--t-body`, `--t-small`, `--t-micro`, and their `--k-*` tracking partners. Task 3 consumes `--t-micro`, `--k-micro`, `--s2`, `--s3`.

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/conformance.test.ts`:

```ts
/**
 * C1 and C2, as a ratchet rather than a memo.
 *
 * The stylesheets predate the scale, so this does NOT assert zero violations —
 * it asserts the number never goes up. A design system that cannot fail a
 * review is decoration; one that fails on day one is deleted by the second
 * engineer who hits it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Nine steps. Zero is always legal; so is a 1px hairline. */
const SPACING = new Set([0, 1, 4, 8, 12, 16, 24, 32, 48, 64, 96]);
/** Six sizes. */
const TYPE = new Set([9, 11, 13, 14, 20, 30]);

const SHEETS = ["shell.css", "styles.css"] as const;

function read(name: string): string {
  return readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf8");
}

/** Every `<n>px` in a declaration whose property matches `properties`. */
export function offScale(
  css: string,
  properties: RegExp,
  allowed: ReadonlySet<number>,
): readonly string[] {
  const found: string[] = [];
  // Declarations only — never selectors or at-rules.
  for (const line of css.split("\n")) {
    const declaration = /^\s*([a-z-]+)\s*:\s*([^;]+);/.exec(line);
    if (declaration === null) continue;
    const [, property, value] = declaration;
    if (property === undefined || value === undefined) continue;
    if (!properties.test(property)) continue;
    // A var() reference is by definition on the scale.
    if (value.includes("var(")) continue;
    for (const match of value.matchAll(/(-?\d*\.?\d+)px/g)) {
      const px = Math.abs(Number(match[1]));
      if (!allowed.has(px)) found.push(`${property}: ${match[0]}`);
    }
  }
  return found;
}

describe("Design OS conformance", () => {
  it("C1 — spacing does not drift further off the nine steps", () => {
    const violations = SHEETS.flatMap((sheet) =>
      offScale(read(sheet), /^(padding|margin|gap|row-gap|column-gap)(-|$)/, SPACING),
    );
    // BASELINE. Lower this number when you fix violations; never raise it.
    expect(violations.length).toBeLessThanOrEqual(0);
  });

  it("C2 — type does not drift further off the six sizes", () => {
    const violations = SHEETS.flatMap((sheet) =>
      offScale(read(sheet), /^font-size$/, TYPE),
    );
    // BASELINE. Lower this number when you fix violations; never raise it.
    expect(violations.length).toBeLessThanOrEqual(0);
  });

  it("declares all nine spacing steps and all six type sizes", () => {
    const shell = read("shell.css");
    for (const step of ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8", "--s9"]) {
      expect(shell).toContain(`${step}:`);
    }
    for (const size of ["--t-display", "--t-title", "--t-head", "--t-body", "--t-small", "--t-micro"]) {
      expect(shell).toContain(`${size}:`);
    }
  });
});
```

- [ ] **Step 2: Run it and record the real baseline**

Run: `cd apps/studio && npx vitest run src/conformance.test.ts`

Expected: all three tests FAIL. The first two report a violation count; the third
reports a missing `--s8`.

Now **replace both `0` baselines with the exact counts the run printed.** Read
them from the assertion message (`expected N to be less than or equal to 0`).
These numbers are the debt this task is ring-fencing, not approving.

- [ ] **Step 3: Add the missing tokens**

In `apps/studio/src/shell.css`, replace lines 21–28 (the comment and the seven
steps) with:

```css
  /* Nine steps, 4pt grid. C1: there is no value between them, and "it looked
     better at 15" is a sign the wrong step was chosen. */
  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 24px;
  --s6: 32px;
  --s7: 48px;
  --s8: 64px;
  --s9: 96px;

  /* Six sizes, each with its tracking BOUND to it. C2: tighter as it grows,
     looser as it shrinks — what optical sizing would do for a face that has
     it, which the system face does not. Never override letter-spacing
     locally; take the pair or take neither. */
  --t-display: 30px;  --k-display: -0.036em;
  --t-title:   20px;  --k-title:   -0.028em;
  --t-head:    14px;  --k-head:    -0.018em;
  --t-body:    13px;  --k-body:    -0.004em;
  --t-small:   11px;  --k-small:    0;
  --t-micro:    9px;  --k-micro:    0.16em;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/studio && npx vitest run src/conformance.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run the full studio suite for regressions**

Run: `cd apps/studio && npm test`
Expected: PASS. Adding unused custom properties changes no rendering.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/shell.css apps/studio/src/conformance.test.ts
git commit -m "feat(studio): the scale gains its missing steps, and a ratchet to hold them"
```

---

### Task 2: Per-section level labels

**Files:**
- Modify: `apps/studio/src/studio/shell.ts:41-70`
- Create: `apps/studio/src/levels.test.ts`

**Interfaces:**
- Consumes: `Section`, `SectionSpec`, `SECTIONS` from `studio/shell.ts`; `Depth` from `studio/workspace.ts`.
- Produces: `levelLabels(section: Section): LevelLabels | null` where
  `interface LevelLabels { readonly beginner: string; readonly expert: string }`.
  Task 3 renders from this.

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/levels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SECTIONS, levelLabels } from "./studio/shell";
import { leaksEngineTerm } from "./studio/shell";

describe("level labels", () => {
  it("names the ACT, not the person, in Design", () => {
    expect(levelLabels("design")).toEqual({ beginner: "Fill in", expert: "Build" });
  });

  it("names the ACT, not the person, in Production", () => {
    expect(levelLabels("production")).toEqual({ beginner: "Air", expert: "Desk" });
  });

  it("offers no switch where there is nothing to reveal", () => {
    for (const section of ["home", "templates", "marketplace", "assets", "outputs", "settings"] as const) {
      expect(levelLabels(section)).toBeNull();
    }
  });

  it("never says beginner or expert to a user", () => {
    for (const spec of SECTIONS) {
      const labels = levelLabels(spec.id);
      if (labels === null) continue;
      const words = `${labels.beginner} ${labels.expert}`.toLowerCase();
      expect(words).not.toContain("beginner");
      expect(words).not.toContain("expert");
      expect(words).not.toContain("advanced");
      expect(words).not.toContain("simple");
    }
  });

  it("leaks no engine term", () => {
    for (const spec of SECTIONS) {
      const labels = levelLabels(spec.id);
      if (labels === null) continue;
      expect(leaksEngineTerm(labels.beginner)).toBeNull();
      expect(leaksEngineTerm(labels.expert)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/studio && npx vitest run src/levels.test.ts`
Expected: FAIL — `levelLabels is not a function`.

- [ ] **Step 3: Implement**

In `apps/studio/src/studio/shell.ts`, add to the `SectionSpec` interface (after
the `developer?` field at line 47):

```ts
  /**
   * What the two levels are CALLED here.
   *
   * Named for the act, not the person: nobody wants to be told by their own
   * tool that they are a beginner. A section with nothing to reveal omits
   * this, and shows no switch — an inert control is worse than an absent one.
   */
  readonly levels?: LevelLabels;
```

Above `SectionSpec`, add:

```ts
export interface LevelLabels {
  /** The left position. Fewer controls, one obvious action. */
  readonly beginner: string;
  /** The right position. A SUPERSET — it never removes what was in use. */
  readonly expert: string;
}
```

In the `SECTIONS` array, add `levels` to exactly two entries:

```ts
  { id: "design", label: "Design", hint: "Build and animate a graphic",
    levels: { beginner: "Fill in", expert: "Build" } },
  { id: "production", label: "Production", hint: "Cue your scenes and put them on air",
    levels: { beginner: "Air", expert: "Desk" } },
```

At the end of the file, add:

```ts
/** The two labels for a section, or null where there is no switch. */
export function levelLabels(id: Section): LevelLabels | null {
  return sectionSpec(id).levels ?? null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/studio && npx vitest run src/levels.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck and full suite**

Run: `cd apps/studio && npm run check-types && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/studio/shell.ts apps/studio/src/levels.test.ts
git commit -m "feat(studio): the two levels are named for the act, per section"
```

---

### Task 3: The level switch, reachable at last

**Files:**
- Create: `apps/studio/src/ui/level-switch.tsx`
- Modify: `apps/studio/src/App.tsx:2372`
- Modify: `apps/studio/src/shell.css` (append)
- Create: `apps/studio/e2e/levels.spec.ts`

**Interfaces:**
- Consumes: `levelLabels` and `Section` from Task 2; `Depth` and `Workspace` from `studio/workspace.ts`; the existing `update({ depth })` callback in `App.tsx:834`.
- Produces: `<LevelSwitch section depth onDepth />` and the test ids
  `level-switch`, `level-beginner`, `level-expert`.

- [ ] **Step 1: Write the component**

Create `apps/studio/src/ui/level-switch.tsx`:

```tsx
import { levelLabels } from "../studio/shell";
import type { Section } from "../studio/shell";
import type { Depth } from "../studio/workspace";

/**
 * How much of the product is revealed, as a control a person can find.
 *
 * `Depth` has existed in the workspace since Phase 4 and has never had a
 * surface — which is why neither audience got what it was built for. Two
 * positions, always the same two, always in the same place on screen.
 */
export interface LevelSwitchProps {
  readonly section: Section;
  readonly depth: Depth;
  readonly onDepth: (depth: Depth) => void;
}

export function LevelSwitch({ section, depth, onDepth }: LevelSwitchProps) {
  const labels = levelLabels(section);
  // A section with nothing to reveal shows nothing. An inert switch is worse
  // than an absent one: it invites a press that does not do anything.
  if (labels === null) return null;

  return (
    <div className="level-switch" role="group" aria-label="How much is shown" data-testid="level-switch">
      {(["beginner", "expert"] as const).map((level) => (
        <button
          key={level}
          type="button"
          className={`level-opt ${depth === level ? "on" : ""}`}
          aria-pressed={depth === level}
          data-testid={`level-${level}`}
          onClick={() => onDepth(level)}
        >
          {labels[level]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Style it on the scale**

Append to `apps/studio/src/shell.css`:

```css
/* --------------------------------------------------------------------------
   THE LEVEL SWITCH

   Two positions, never three. On the type scale's micro size, because it is a
   label on an instrument and not a heading. No transition on the moving state:
   a switch that has to finish animating before it reads as switched is a
   switch you press twice.
   -------------------------------------------------------------------------- */
.level-switch {
  display: inline-flex;
  gap: var(--s1);
  padding: var(--s1);
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
}

.level-opt {
  padding: var(--s1) var(--s3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-2);
  font-size: var(--t-micro);
  letter-spacing: var(--k-micro);
  text-transform: uppercase;
  cursor: pointer;
}

.level-opt.on {
  background: var(--accent-bg);
  color: var(--ink);
}
```

These are the real token names, verified in `apps/studio/src/styles.css`:
`--line:47`, `--ink:53`, `--ink-2:54`, `--accent-bg:72`. Introduce no colour
literals — every one of these already flips for the light theme at
`styles.css:268`.

- [ ] **Step 3: Wire it into the shell**

In `apps/studio/src/App.tsx`, import at the top:

```tsx
import { LevelSwitch } from "./ui/level-switch";
```

At line 2372, immediately **after** `<MenuBar commands={commands} />` and
**before** the `{designing ? (` block:

```tsx
        <LevelSwitch
          section={workspace.section}
          depth={workspace.depth}
          onDepth={(depth) => update({ depth })}
        />
```

It sits outside the `designing` conditional deliberately: the rule is that the
switch occupies the same screen position in every section, and it renders
nothing where there is no switch.

- [ ] **Step 4: Write the e2e test**

Create `apps/studio/e2e/levels.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("the level switch is visible in Design, and moves", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-design").click();

  const beginner = page.getByTestId("level-beginner");
  const expert = page.getByTestId("level-expert");

  await expect(beginner).toHaveText(/fill in/i);
  await expect(expert).toHaveText(/build/i);
  // Beginner is the default: the first five minutes decide whether anyone
  // reaches the fifth.
  await expect(beginner).toHaveAttribute("aria-pressed", "true");

  await expert.click();
  await expect(expert).toHaveAttribute("aria-pressed", "true");
  await expect(beginner).toHaveAttribute("aria-pressed", "false");
});

test("the level survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-design").click();
  await page.getByTestId("level-expert").click();

  await page.reload();
  await page.getByTestId("nav-design").click();
  await expect(page.getByTestId("level-expert")).toHaveAttribute("aria-pressed", "true");
});

test("Production names the act it performs", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-production").click();
  await expect(page.getByTestId("level-beginner")).toHaveText(/air/i);
  await expect(page.getByTestId("level-expert")).toHaveText(/desk/i);
});

test("a section with nothing to reveal shows no switch", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-marketplace").click();
  await expect(page.getByTestId("level-switch")).toHaveCount(0);
});
```

- [ ] **Step 5: Run the e2e test**

Run: `cd apps/studio && npx playwright test e2e/levels.spec.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `cd apps/studio && npm run check-types && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/ui/level-switch.tsx apps/studio/src/App.tsx \
        apps/studio/src/shell.css apps/studio/e2e/levels.spec.ts
git commit -m "feat(studio): the level a person is working at becomes a control"
```

---

# P1 — Channels

### Task 4: Channel identity, and a factory that builds sessions lazily

Pure refactor. Behaviour is unchanged and every existing test stays green — the
bus still airs one thing, it just now knows that thing is called `lower`.

**Files:**
- Create: `apps/studio/src/studio/channels.ts`
- Modify: `apps/studio/src/studio/program.ts:111-161`
- Modify: `apps/studio/src/App.tsx:773`
- Modify: `apps/studio/src/authoring.test.ts:147-151`

**Interfaces:**
- Consumes: `StudioSession` from `studio/session.ts`.
- Produces:
  - `type ChannelId = "background" | "lower" | "upper" | "overlay"`
  - `const CHANNELS: readonly ChannelId[]` — in compositing order, bottom first
  - `type ChannelFactory = (id: ChannelId) => StudioSession`
  - `new ProgramBus(preview: StudioSession, make: ChannelFactory)`
  - `bus.channel(id: ChannelId): StudioSession` — builds on first call, then cached

- [ ] **Step 1: Write the failing test**

Create `apps/studio/src/channels.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MockMirrorBackend } from "@bracketx/engine-reconciler";
import { StudioSession } from "./studio/session";
import { newDocument } from "./studio/project";
import { testIdFactory } from "./studio/ids";
import { ProgramBus } from "./studio/program";
import { CHANNELS, type ChannelId } from "./studio/channels";

const ids = testIdFactory();

function harness() {
  const preview = new StudioSession(new MockMirrorBackend(), newDocument("Preview", ids));
  const make = vi.fn((id: ChannelId) =>
    new StudioSession(new MockMirrorBackend(), newDocument(id, ids)),
  );
  return { preview, make, bus: new ProgramBus(preview, make) };
}

describe("channels", () => {
  it("composites bottom to top, and names roles rather than numbers", () => {
    expect(CHANNELS).toEqual(["background", "lower", "upper", "overlay"]);
  });

  it("builds a channel's session on first use and never again", () => {
    const { bus, make } = harness();
    expect(make).not.toHaveBeenCalled();

    const first = bus.channel("lower");
    const second = bus.channel("lower");

    expect(first).toBe(second);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).toHaveBeenCalledWith("lower");
  });

  it("does not build channels nobody has used", () => {
    const { bus, make } = harness();
    bus.channel("lower");
    expect(make).toHaveBeenCalledTimes(1);
    expect(make).not.toHaveBeenCalledWith("overlay");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/studio && npx vitest run src/channels.test.ts`
Expected: FAIL — cannot resolve `./studio/channels`.

- [ ] **Step 3: Create the channel module**

Create `apps/studio/src/studio/channels.ts`:

```ts
/**
 * The layers a show goes out on.
 *
 * ==========================================================================
 * NAMED BY ROLE, NOT NUMBERED
 * ==========================================================================
 * An operator says "kill the ticker", never "kill layer three". Numbering
 * would also make the compositing order a thing to remember rather than a
 * thing to read.
 *
 * Four is a decision, not a limit discovered later: each channel is a full
 * session with its own clock, and the frame budget is measured against this
 * count before the interface offers it.
 */
import type { StudioSession } from "./session";

export type ChannelId = "background" | "lower" | "upper" | "overlay";

/** Compositing order, BOTTOM FIRST. The array order is the z-order. */
export const CHANNELS: readonly ChannelId[] = [
  "background",
  "lower",
  "upper",
  "overlay",
];

/** What a channel is FOR, in the words an operator would use. */
export const CHANNEL_HINTS: Readonly<Record<ChannelId, string>> = {
  background: "Stings and full-frame beds",
  lower: "Name straps and score bugs",
  upper: "Tickers and breaking bands",
  overlay: "Countdowns and clocks",
};

/**
 * Builds a channel's session.
 *
 * Injected rather than constructed here so a test can hand over a mock and the
 * shell can hand over a real canvas. The bus must not know how a session is
 * made — it only knows when one is needed.
 */
export type ChannelFactory = (id: ChannelId) => StudioSession;
```

- [ ] **Step 4: Rewire the bus to hold a map**

In `apps/studio/src/studio/program.ts`, add to the imports:

```ts
import type { ChannelFactory, ChannelId } from "./channels";
```

Replace the `program` field and constructor (lines 112–161) with:

```ts
  readonly preview: StudioSession;

  readonly #make: ChannelFactory;
  readonly #channels = new Map<ChannelId, StudioSession>();

  constructor(preview: StudioSession, make: ChannelFactory) {
    this.preview = preview;
    this.#make = make;
  }

  /**
   * A channel's session, built on first use.
   *
   * Never torn down within a run: rebuilding a mirror mid-show is exactly the
   * cost the preview/program split exists to avoid.
   */
  channel(id: ChannelId): StudioSession {
    const existing = this.#channels.get(id);
    if (existing !== undefined) return existing;
    const built = this.#make(id);
    this.#channels.set(id, built);
    return built;
  }

  /**
   * The layer everything currently routes to.
   *
   * Task 5 removes this. It exists so that introducing channels is a refactor
   * with no behaviour change, reviewable on its own.
   */
  get program(): StudioSession {
    return this.channel("lower");
  }
```

Leave every other method exactly as it is. They all reference `this.program`,
which now resolves through the map.

- [ ] **Step 5: Update the two construction sites**

In `apps/studio/src/App.tsx` at line 773, replace the `new ProgramBus(preview, program)`
call. The `program` session built just above it becomes the factory's product:

```tsx
      setBus(
        new ProgramBus(preview, (id) =>
          new StudioSession(
            createBackend(rendererRef.current, programCanvasRef.current!, programOptions(settings)),
            newDocument(id, ids, new Date().toISOString()),
            {
              ...(text === undefined ? {} : { text }),
              ...(images === undefined ? {} : { images }),
            },
          ),
        ),
      );
```

Delete the now-unused `const program = new StudioSession(...)` block above it
(App.tsx:764–771). Task 8 gives each channel its own canvas; until then they
share `programCanvasRef`, which is correct because only `lower` is ever built.

In `apps/studio/src/authoring.test.ts`, replace the helper at lines 147–151:

```ts
  function bus(): { bus: ProgramBus; preview: StudioSession; program: StudioSession } {
    const preview = session();
    const program = new StudioSession(new MockMirrorBackend(), newDocument("Program", ids));
    const made = new ProgramBus(preview, () => program);
    return { bus: made, preview, program };
  }
```

- [ ] **Step 6: Run the new test and the existing suite**

Run: `cd apps/studio && npx vitest run src/channels.test.ts`
Expected: PASS, 3 tests.

Run: `cd apps/studio && npm run check-types && npm test`
Expected: PASS. **Every pre-existing ProgramBus test must still pass unchanged** —
that is what makes this a refactor.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/studio/channels.ts apps/studio/src/studio/program.ts \
        apps/studio/src/App.tsx apps/studio/src/authoring.test.ts \
        apps/studio/src/channels.test.ts
git commit -m "refactor(studio): the bus holds channels, and builds one when it is asked for"
```

---

### Task 5: Every call names its channel

**Files:**
- Modify: `apps/studio/src/studio/program.ts` (cue, uncue, take, cut, auto, hold, continue, clear)
- Modify: `apps/studio/src/channels.test.ts`
- Modify: `apps/studio/src/authoring.test.ts` (existing bus tests)

**Interfaces:**
- Consumes: `bus.channel(id)` from Task 4.
- Produces: `cue(id)`, `uncue(id)`, `take(id, mode?)`, `cut(id)`, `auto(id)`,
  `hold(id)`, `continue(id)`, `clear(id)`, and per-channel readers
  `stateOf(id)`, `playingOn(id)`, `cueStaleOn(id)`, `pendingOn(id)`.
  Task 6 adds `live`, `onAir`, `clearAll`. Task 7 consumes all of it.

- [ ] **Step 1: Write the failing test**

Append to `apps/studio/src/channels.test.ts`:

```ts
describe("a channel is addressed by name", () => {
  it("refuses to cue a channel that is already on air", () => {
    const { bus } = harness();
    bus.take("lower");
    bus.cue("lower");
    expect(bus.stateOf("lower")).toBe("on-air");
  });

  it("arms and disarms one channel without touching another", () => {
    const { bus } = harness();
    bus.cue("upper");
    expect(bus.stateOf("upper")).toBe("cued");
    expect(bus.stateOf("lower")).toBe("off-air");

    bus.uncue("upper");
    expect(bus.stateOf("upper")).toBe("off-air");
  });

  it("holds and resumes per channel", () => {
    const { bus } = harness();
    bus.take("overlay");
    bus.hold("overlay");
    expect(bus.stateOf("overlay")).toBe("holding");
    bus.continue("overlay");
    expect(bus.stateOf("overlay")).toBe("on-air");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/studio && npx vitest run src/channels.test.ts`
Expected: FAIL — `bus.stateOf is not a function`.

- [ ] **Step 3: Move the per-channel state onto the channel**

In `apps/studio/src/studio/program.ts`, replace the four private single-value
fields (`#state`, `#airedHash`, `#cuedHash`, `#playing`) with one record per
channel. Add above the class:

```ts
interface ChannelState {
  state: ProgramState;
  airedHash: string | null;
  cuedHash: string | null;
  playing: string | null;
}

function freshChannel(): ChannelState {
  return { state: "off-air", airedHash: null, cuedHash: null, playing: null };
}
```

Inside the class, replace those fields with:

```ts
  readonly #state = new Map<ChannelId, ChannelState>();

  #stateOf(id: ChannelId): ChannelState {
    const existing = this.#state.get(id);
    if (existing !== undefined) return existing;
    const made = freshChannel();
    this.#state.set(id, made);
    return made;
  }

  stateOf(id: ChannelId): ProgramState { return this.#stateOf(id).state; }
  playingOn(id: ChannelId): string | null { return this.#stateOf(id).playing; }

  /** True when that channel's Preview differs from what IT last aired. */
  pendingOn(id: ChannelId): boolean {
    return this.#hash(this.preview.document) !== this.#stateOf(id).airedHash;
  }

  /** True when Preview changed after that channel was armed. */
  cueStaleOn(id: ChannelId): boolean {
    const channel = this.#stateOf(id);
    return channel.state === "cued" && this.#hash(this.preview.document) !== channel.cuedHash;
  }
```

Then rewrite each verb to take an id and operate on `this.#stateOf(id)` and
`this.channel(id)` instead of `this.#state` and `this.program`. Every existing
comment and invariant is preserved — only the scope narrows from "the bus" to
"this channel". For example `cue` becomes:

```ts
  cue(id: ChannelId): TakeResult {
    const channel = this.#stateOf(id);
    // Refused while THIS channel is on air: an operator cannot cue over a live
    // layer with one keystroke, because "on air AND armed" has no honest single
    // indicator.
    if (channel.state === "on-air" || channel.state === "holding") {
      return { mode: "take", state: channel.state, played: channel.playing };
    }
    channel.cuedHash = this.#hash(this.preview.document);
    channel.state = "cued";
    return this.#emit({ mode: "take", state: channel.state, played: null });
  }
```

and `take` becomes:

```ts
  take(id: ChannelId, mode: TakeMode = "take"): TakeResult {
    const channel = this.#stateOf(id);
    const session = this.channel(id);
    const document = this.preview.document;
    const bytes = this.#hash(document);
    session.open(JSON.parse(bytes) as SceneDocument);
    channel.airedHash = bytes;
    channel.cuedHash = null;
    channel.state = "on-air";
    channel.playing = null;

    this.#takes += 1;
    if (this.#firstAiredAt === null) this.#firstAiredAt = Date.now();
    this.#wentOffAt = null;

    if (mode === "cut") {
      session.render();
      return this.#emit({ mode, state: channel.state, played: null });
    }

    const entrance = entranceOf(session.document);
    if (entrance !== null) {
      session.play();
      session.playClip(entrance.id);
      channel.playing = entrance.id;
    }
    session.render();
    return this.#emit({ mode, state: channel.state, played: channel.playing });
  }
```

Apply the same narrowing to `uncue`, `cut`, `auto`, `hold`, `continue` and
`clear`, each taking `id: ChannelId` as its first parameter.

Delete the temporary `get program()` accessor added in Task 4.

- [ ] **Step 4: Update the existing bus tests to name a channel**

In `apps/studio/src/authoring.test.ts`, every `bus.take()`, `bus.cue()`,
`bus.clear()`, `bus.hold()`, `bus.continue()` and `bus.cut()` call in the
ProgramBus describe block gains `"lower"` as its first argument. Reads of
`bus.state`, `bus.playing`, `bus.pending` and `bus.cueStale` become
`bus.stateOf("lower")`, `bus.playingOn("lower")`, `bus.pendingOn("lower")` and
`bus.cueStaleOn("lower")`.

Find every site with:

```bash
grep -n "bus\.\(take\|cue\|uncue\|cut\|auto\|hold\|continue\|clear\|state\|playing\|pending\|cueStale\)" apps/studio/src/authoring.test.ts
```

- [ ] **Step 5: Run both suites**

Run: `cd apps/studio && npx vitest run src/channels.test.ts src/authoring.test.ts`
Expected: PASS. The behaviour those older tests assert is unchanged; only the
address is explicit.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/studio/program.ts apps/studio/src/channels.test.ts \
        apps/studio/src/authoring.test.ts
git commit -m "feat(studio): a take names the layer it is going out on"
```

---

### Task 6: Independence, clearAll, and the show's own record

This is the task that delivers the feature. Everything before it was plumbing.

**Files:**
- Modify: `apps/studio/src/studio/program.ts`
- Modify: `apps/studio/src/channels.test.ts`

**Interfaces:**
- Consumes: everything from Task 5.
- Produces: `get live(): readonly ChannelId[]`, `get onAir(): boolean`,
  `clearAll(): void`. Task 7 and Task 8 consume `live`.

- [ ] **Step 1: Write the failing test**

Append to `apps/studio/src/channels.test.ts`:

```ts
describe("channels are independent", () => {
  it("taking to one layer leaves another's aired content untouched", () => {
    const { bus } = harness();

    bus.take("lower");
    // A DIFFERENT session per channel is the thing that makes independence
    // possible — one runtime cannot be at two frames.
    expect(bus.channel("lower")).not.toBe(bus.channel("upper"));

    bus.take("upper");

    // The whole feature, in one assertion: lower is STILL on air.
    expect(bus.stateOf("lower")).toBe("on-air");
    expect(bus.stateOf("upper")).toBe("on-air");
  });

  it("clearing one layer does not disturb another's clock", () => {
    const { bus } = harness();
    bus.take("lower");
    bus.take("upper");
    const lowerSession = bus.channel("lower");

    bus.clear("upper");

    // `clear` calls stop() on ITS session only. A shared runtime would have
    // rewound the lower third to frame zero mid-show.
    expect(lowerSession.disposed).toBe(false);
    expect(bus.stateOf("lower")).toBe("on-air");
  });

  it("reports what is live in compositing order", () => {
    const { bus } = harness();
    bus.take("overlay");
    bus.take("background");
    bus.take("lower");
    expect(bus.live).toEqual(["background", "lower", "overlay"]);
  });

  it("clearing one layer leaves the others live", () => {
    const { bus } = harness();
    bus.take("lower");
    bus.take("upper");

    bus.clear("upper");

    expect(bus.stateOf("upper")).toBe("off-air");
    expect(bus.stateOf("lower")).toBe("on-air");
    expect(bus.onAir).toBe(true);
  });

  it("is on air while ANY channel is live, and not for a mere cue", () => {
    const { bus } = harness();
    expect(bus.onAir).toBe(false);
    bus.cue("lower");
    expect(bus.onAir).toBe(false);
    bus.take("lower");
    expect(bus.onAir).toBe(true);
  });

  it("panic takes every channel off air at once", () => {
    const { bus } = harness();
    bus.take("background");
    bus.take("lower");
    bus.take("upper");

    bus.clearAll();

    expect(bus.live).toEqual([]);
    expect(bus.onAir).toBe(false);
  });

  it("a show runs from its first take to going off air, across channels", () => {
    const { bus } = harness();
    bus.take("lower");
    bus.take("upper");
    expect(bus.takes).toBe(2);

    // Clearing ONE layer has not ended the show.
    bus.clear("upper");
    expect(bus.wentOffAt).toBeNull();

    bus.clearAll();
    expect(bus.wentOffAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/studio && npx vitest run src/channels.test.ts`
Expected: FAIL — `bus.live` is undefined.

- [ ] **Step 3: Implement**

In `apps/studio/src/studio/program.ts`, add:

```ts
  /**
   * Channels with frames actually going out, in compositing order.
   *
   * Read from CHANNELS rather than from the map's insertion order, so the
   * answer is the z-order and not the order somebody happened to take things.
   */
  get live(): readonly ChannelId[] {
    return CHANNELS.filter((id) => {
      const state = this.#state.get(id)?.state;
      return state === "on-air" || state === "holding";
    });
  }

  /**
   * True when ANY channel is transmitting.
   *
   * Not `state !== "off-air"` on any channel: a cued layer is armed and
   * invisible, and counting it would put the red spine across the product for
   * something nobody is watching.
   */
  get onAir(): boolean {
    return this.live.length > 0;
  }

  /**
   * PANIC. Every layer off, in one act.
   *
   * This is what ends a show — `clear(id)` does not, however many layers it is
   * called on, because an operator dropping a ticker has not gone off air.
   */
  clearAll(): void {
    for (const id of CHANNELS) {
      const channel = this.#state.get(id);
      if (channel === undefined) continue;
      this.#channels.get(id)?.stop();
      channel.state = "off-air";
      channel.cuedHash = null;
      channel.playing = null;
    }
    if (this.#firstAiredAt !== null) this.#wentOffAt = Date.now();
    this.#emit({ mode: "cut", state: "off-air", played: null });
  }
```

Import `CHANNELS` at the top:

```ts
import { CHANNELS, type ChannelFactory, type ChannelId } from "./channels";
```

Remove the `wentOffAt` stamping from the per-channel `clear(id)` — clearing one
layer is not the end of a transmission.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/studio && npx vitest run src/channels.test.ts`
Expected: PASS, 13 tests (3 from Task 4, 3 from Task 5, 7 here).

- [ ] **Step 5: Full suite and typecheck**

Run: `cd apps/studio && npm run check-types && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/studio/program.ts apps/studio/src/channels.test.ts
git commit -m "feat(studio): a lower third and a ticker can be out at the same time"
```

---

### Task 7: The shell speaks channels

**Files:**
- Modify: `apps/studio/src/App.tsx:1371-1446` (the Program command block)
- Modify: `apps/studio/src/ui/monitors.tsx:43-52`
- Modify: `apps/studio/src/ui/production.tsx:279-281`

**Interfaces:**
- Consumes: `live`, `onAir`, `stateOf`, `cueStaleOn`, `clearAll` from Task 6.
- Produces: `MonitorsProps` gains `channel: ChannelId`; the command ids
  `air.cue`, `program.take`, `program.cut`, `program.clear` keep their names and
  gain a channel argument internally. New command `program.clearAll`.

- [ ] **Step 1: Update the Program commands**

In `apps/studio/src/App.tsx`, inside the `commands` memo, add above the Program
block:

```tsx
      // Which layer the palette's Program commands address. The rundown
      // selects this in P2; until then the name strap is the honest default,
      // because it is what every one of these commands used to mean.
      const target: ChannelId = "lower";
```

Then update each call: `bus.cue()` → `bus.cue(target)`, `bus.uncue()` →
`bus.uncue(target)`, `bus.take()` → `bus.take(target)`, `bus.cut()` →
`bus.cut(target)`, `bus.continue()` → `bus.continue(target)`, `bus.hold()` →
`bus.hold(target)`, `bus.clear()` → `bus.clear(target)`.

Change the `enabled` guards that read `bus.cued` to `bus.stateOf(target) === "cued"`,
and `bus.pending` to `bus.pendingOn(target)`.

Add one new command after `program.clear`:

```tsx
            {
              id: "program.clearAll",
              title: "Clear everything off air",
              section: "Program" as const,
              hint: "Every layer, at once",
              keywords: ["panic", "kill", "all"],
              enabled: bus.onAir,
              run: () => bus.clearAll(),
            },
```

Import the type at the top of `App.tsx`:

```tsx
import type { ChannelId } from "./studio/channels";
```

- [ ] **Step 2: Fix the Escape ladder**

At `apps/studio/src/App.tsx:370`, the escape claim reads `bus?.cued`. Replace:

```tsx
      claimEscape("air", () => {
        // Any armed layer disarms, top-down: the last thing armed is the first
        // thing an operator means to take back.
        const armed = [...CHANNELS].reverse().find((id) => bus?.stateOf(id) === "cued");
        if (bus === null || armed === undefined) return false;
        bus.uncue(armed);
        return true;
      }),
```

Import `CHANNELS` alongside the type.

- [ ] **Step 3: Update Monitors**

In `apps/studio/src/ui/monitors.tsx`, add to `MonitorsProps` after line 44:

```ts
  /** Which layer this monitor's controls address. */
  readonly channel: ChannelId;
```

Import the type, and replace reads of `bus.onAir` used for *this monitor's*
state with `bus.stateOf(channel)`. Leave the global tally reading `bus.onAir` —
that one genuinely means "anything at all is out".

In `apps/studio/src/ui/production.tsx` at line 279, pass it:

```tsx
          <Monitors
            bus={bus}
            channel="lower"
            previewCanvas={previewCanvas}
            programCanvas={programCanvas}
            revision={revision}
            onOffAir={onOffAir}
            onTake={() => bus.take("lower")}
            onCue={() => (bus.stateOf("lower") === "cued" ? bus.uncue("lower") : bus.cue("lower"))}
          />
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/studio && npm run check-types`
Expected: PASS. Any remaining error is a call site that has not named its
channel — fix it by naming `"lower"`.

- [ ] **Step 5: Run the full suite and the air e2e tests**

Run: `cd apps/studio && npm test`
Run: `cd apps/studio && npx playwright test e2e/cue.spec.ts e2e/compositing.spec.ts`
Expected: PASS. Behaviour through the UI is unchanged — one layer, as before.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/App.tsx apps/studio/src/ui/monitors.tsx \
        apps/studio/src/ui/production.tsx
git commit -m "feat(studio): the shell addresses a layer, and panic clears every one"
```

---

### Task 8: Two graphics, on air, proven by the pixels

**Files:**
- Modify: `apps/studio/src/App.tsx` (a canvas per channel)
- Modify: `apps/studio/src/ui/monitors.tsx` (stack them)
- Modify: `apps/studio/src/shell.css` (append)
- Create: `apps/studio/e2e/channels.spec.ts`

**Interfaces:**
- Consumes: `bus.live` and `bus.channel(id)` from Task 6.
- Produces: the test id `program-stack`, and one `data-channel="<id>"` canvas
  per built channel.

- [ ] **Step 1: Give every channel its own canvas**

In `apps/studio/src/App.tsx`, replace the single `programCanvasRef` with a map
created imperatively at the same point in the file (near line 212):

```tsx
  /**
   * A canvas per channel, created once, imperatively.
   *
   * A backend binds to its canvas for the session's lifetime (MirrorBackend
   * C2), so these cannot mount with a component — a layout change would tear
   * down a layer that is on air.
   */
  const channelCanvases = useRef<Map<ChannelId, HTMLCanvasElement>>(new Map());
  const canvasFor = useCallback((id: ChannelId): HTMLCanvasElement => {
    const existing = channelCanvases.current.get(id);
    if (existing !== undefined) return existing;
    const made = document.createElement("canvas");
    channelCanvases.current.set(id, made);
    return made;
  }, []);
```

In the factory passed to `new ProgramBus` (Task 4, Step 5), use `canvasFor(id)`
in place of `programCanvasRef.current!`, and size it from the document:

```tsx
        new ProgramBus(preview, (id) => {
          const surface = canvasFor(id);
          surface.width = created.world.output.width;
          surface.height = created.world.output.height;
          return new StudioSession(
            createBackend(rendererRef.current, surface, programOptions(settings)),
            newDocument(id, ids, new Date().toISOString()),
            {
              ...(text === undefined ? {} : { text }),
              ...(images === undefined ? {} : { images }),
            },
          );
        }),
```

Pass `canvasFor` down to `Production` in place of `programCanvas`.

- [ ] **Step 2: Stack them in the Program monitor**

In `apps/studio/src/ui/monitors.tsx`, replace the single program canvas mount
with a stack. Each live channel's canvas is appended to a positioned container
in `CHANNELS` order:

```tsx
  const stack = useRef<HTMLDivElement | null>(null);

  // The canvases are OWNED by the shell and only borrowed here, so this moves
  // them rather than creating them — the same contract the preview canvas has.
  useEffect(() => {
    const host = stack.current;
    if (host === null) return;
    for (const id of CHANNELS) {
      if (!bus.live.includes(id)) continue;
      const surface = canvasFor(id);
      surface.dataset.channel = id;
      // z-order IS array order: appending in CHANNELS order is the composite.
      host.appendChild(surface);
    }
  }, [bus, canvasFor, revision]);

```

The mount point already exists: `monitors.tsx:233` is
`<div className="mon-face" ref={programMount} data-testid="program-monitor" />`.
Keep that element and its test id — other e2e tests locate the program monitor
by it — and add the stack class and ref to it rather than introducing a sibling:

```tsx
  <div
    className="mon-face program-stack"
    ref={stack}
    data-testid="program-monitor"
  />
```

Delete the old `programMount` effect that appended the single program canvas;
the loop above replaces it.

Append to `apps/studio/src/shell.css`:

```css
/* Every layer occupies the same box; the stacking order is the DOM order,
   which is CHANNELS order, which is the compositing order. One rule, three
   places it has to agree, so it is written down once here. */
.program-stack { position: relative; }
.program-stack > canvas {
  position: absolute;
  inset: 0;
  inline-size: 100%;
  block-size: 100%;
}
```

- [ ] **Step 3: Write the test that matters**

Create `apps/studio/e2e/channels.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

/**
 * Everything else in P1 can pass while the feature does not work. This cannot:
 * it looks at the pixels and asserts two graphics are out at once.
 */
test("two graphics are on air at the same time", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-production").click();

  // Take a lower third to `lower`.
  await page.getByTestId("cue-tpl_lower_third").click();
  await page.getByTestId("take").click();

  // Take a ticker to `upper`.
  await page.getByTestId("nav-production").click();
  await page.getByTestId("cue-tpl_ticker").click();
  await page.getByTestId("take").click();

  const stack = page.getByTestId("program-monitor");
  await expect(stack.locator("canvas[data-channel='lower']")).toHaveCount(1);
  await expect(stack.locator("canvas[data-channel='upper']")).toHaveCount(1);

  // Both layers have actually DRAWN — a mounted canvas proves nothing.
  for (const channel of ["lower", "upper"]) {
    const painted = await stack
      .locator(`canvas[data-channel='${channel}']`)
      .evaluate((node) => {
        const canvas = node as HTMLCanvasElement;
        const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
        if (context === null) return false;
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        (context as WebGLRenderingContext).readPixels(
          0, 0, canvas.width, canvas.height,
          (context as WebGLRenderingContext).RGBA,
          (context as WebGLRenderingContext).UNSIGNED_BYTE,
          pixels,
        );
        return pixels.some((value, index) => index % 4 === 3 && value > 0);
      });
    expect(painted, `${channel} drew nothing`).toBe(true);
  }
});

```

> `cue-<templateId>` is confirmed at `production.tsx:301`. The take control's
> id is **not** in `monitors.tsx` — read it from that file's button markup
> (near `data-testid="monitor-program"`, line 230) and substitute the real one
> rather than inventing `take`.

**One e2e test in this task, deliberately.** Clearing one layer while another
stays live is already proven by the unit tests in Task 6, and driving it through
the UI needs the per-channel clear control — that is the channel strip, which is
P2. `Shift+Esc` is P2 for the same reason. Do not add a known-failing test to
the suite to hold their place.

- [ ] **Step 4: Run it**

Run: `cd apps/studio && npx playwright test e2e/channels.spec.ts`
Expected: PASS, 1 test.

- [ ] **Step 5: Measure the frame budget**

Run: `cd apps/studio && npx vitest bench src/studio.bench.ts`

Record the cost with four channels built. If the low-end profile cannot hold
four live sessions at budget, **stop and report** — the answer is fewer channels
offered on that profile, and that is a design decision, not an implementation
one.

- [ ] **Step 6: Full suite**

Run: `cd apps/studio && npm run check-types && npm run lint && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio/src/App.tsx apps/studio/src/ui/monitors.tsx \
        apps/studio/src/shell.css apps/studio/e2e/channels.spec.ts
git commit -m "feat(studio): the layers composite, and the pixels prove it"
```

---

## Blocked-on

Task 8 depends on the render-order fix at
`packages/engine-render-three/src/three-backend.ts:392`, which is **uncommitted
in the `phase-2-engine` working tree** and belongs to another session. It ships
alongside debug instrumentation at lines 394–408 that logs on every mesh attach;
that must be removed before four channels are measured, or the benchmark in
Task 8 Step 5 measures the logging.

Confirm it has landed before starting Task 8:

```bash
git log --oneline -S "mesh.renderOrder = record.object.renderOrder" -- packages/engine-render-three/src/three-backend.ts
```

## Not in this plan

The rundown, hotkeys `1`–`9`, `Ctrl/⌘+Enter`, `Shift+Esc`, and the fixed desk
layout are **P2**. The per-panel `▸ Advanced` disclosures and the Design screen
rebuild are **P3**. This plan delivers the capability and makes the level
reachable; it does not yet build the desk on top of them.
