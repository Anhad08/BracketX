/**
 * Preview and Program — the on-air workflow.
 *
 * ============================================================================
 * PREVIEW NEVER TOUCHES PROGRAM. THAT IS THE WHOLE FEATURE
 * ============================================================================
 * A designer edits Preview. An operator airs Program. Between them is one
 * explicit act — a Take — and nothing else crosses.
 *
 * That is not a UI convention. It is why a broadcaster can retype a name while
 * the graphic is on air without the correction appearing mid-word, and it is
 * the difference between an editor with a live preview and a production tool.
 * The verification suite asserts it the only way that means anything: edit
 * Preview arbitrarily, and Program's session hash is unchanged.
 *
 * ============================================================================
 * TWO SESSIONS, NOT TWO DOCUMENTS
 * ============================================================================
 * The obvious implementation is one engine and two views of a document. It
 * cannot work: Program has its own clock. A graphic animating on air must keep
 * animating while a designer scrubs the Preview timeline to frame 0, and one
 * runtime cannot be at two frames.
 *
 * So Program is a full `StudioSession` with its own host, its own mirror and
 * its own clock, and a Take is `program.open(previewDocument)`. The cost is a
 * second mirror; the alternative is a preview that stops the show.
 */
import { canonicalize, type SceneDocument, type Timeline } from "@bracketx/engine-scene";

import type { StudioSession } from "./session";
import type { ChannelFactory, ChannelId } from "./channels";

/**
 * How a Take reaches air.
 *
 * `cut` and `take` differ only in whether the entrance plays, which is exactly
 * the distinction an operator means by the two words.
 */
export type TakeMode = "cut" | "take" | "auto";

/**
 * Where the transmission is.
 *
 * ============================================================================
 * `cued` IS A STATE, NOT A DECORATION
 * ============================================================================
 * A gallery does not go from nothing to air. It CUES — arms the next thing —
 * and then takes it. The prototype has three states for that reason
 * (`off · cued · live`) and Studio had two, which meant the only way to
 * indicate "this is what is going out next" was to already be going out.
 *
 * Cueing here records the canonical bytes of Preview at the moment it was
 * armed. That is what makes the state carry something rather than being a
 * lamp: `cueStale` can then answer "somebody edited the graphic after I cued
 * it", which is a real thing that happens to operators and which nothing could
 * previously ask.
 *
 * `holding` is a state of BEING on air, not a fourth colour. `onAir` is true
 * for `on-air` and `holding` and false for `cued` — a cued graphic is not on
 * air, and treating it as if it were would light the spine red for something
 * nobody can see.
 */
export type ProgramState = "off-air" | "cued" | "on-air" | "holding";

export interface TakeResult {
  readonly mode: TakeMode;
  readonly state: ProgramState;
  /** The timeline that was cued, when one was. */
  readonly played: string | null;
}

/** Heuristics for which timeline is the entrance and which is the exit. */
const ENTRANCE_HINTS = ["in", "enter", "entrance", "on", "open", "reveal"];
const EXIT_HINTS = ["out", "exit", "off", "close", "hide", "collapse"];

function matches(timeline: Timeline, hints: readonly string[]): boolean {
  const name = timeline.name.toLowerCase();
  const id = timeline.id.toLowerCase();
  return hints.some((hint) => name.includes(hint) || id.includes(hint));
}

/**
 * Which timeline an entrance/exit refers to.
 *
 * Name matching, deliberately, and deliberately not a format field. Marking a
 * timeline `role: "entrance"` in the document would be a broadcast noun in the
 * scene format — the exact thing SCENE_FORMAT §7 refuses for components, and it
 * refuses it for the same reason: the engine would then have to understand a
 * product concept forever.
 *
 * A name is a convention Studio and a pack author share. When it does not
 * match, the first timeline is the entrance and there is no exit, which is
 * correct for the overwhelmingly common case of a graphic with one animation.
 */
export function entranceOf(document: SceneDocument): Timeline | null {
  const timelines = (document.animations ?? []) as readonly Timeline[];
  if (timelines.length === 0) return null;
  return (
    timelines.find((timeline) => matches(timeline, ENTRANCE_HINTS)) ??
    timelines.find((timeline) => !matches(timeline, EXIT_HINTS)) ??
    null
  );
}

export function exitOf(document: SceneDocument): Timeline | null {
  const timelines = (document.animations ?? []) as readonly Timeline[];
  return timelines.find((timeline) => matches(timeline, EXIT_HINTS)) ?? null;
}

export type BusListener = (bus: ProgramBus) => void;

export class ProgramBus {
  readonly preview: StudioSession;

  readonly #make: ChannelFactory;
  readonly #channels = new Map<ChannelId, StudioSession>();

  #state: ProgramState = "off-air";
  #airedHash: string | null = null;
  /** The canonical bytes armed by `cue`, so `cueStale` can compare. */
  #cuedHash: string | null = null;
  #playing: string | null = null;
  #listeners = new Set<BusListener>();

  /**
   * The show's own record of itself.
   *
   * ==========================================================================
   * A CLOSURE NEEDS FACTS, NOT A FEELING
   * ==========================================================================
   * When a transmission ends the operator is shown what happened: how long it
   * ran, how many takes went out. Those are the two numbers anyone asks about
   * a show afterwards, and they are worth nothing unless they are counted by
   * the thing that did them.
   *
   * `#firstAiredAt` rather than "the last take": a show that took thirty-four
   * graphics ran from the first one to going off air, not from the most
   * recent. `#takes` counts what actually reached air, so a cue that was
   * disarmed never inflates it.
   */
  #takes = 0;
  #firstAiredAt: number | null = null;
  #wentOffAt: number | null = null;

  /**
   * Canonical form, cached on the document's object identity.
   *
   * `pending` is read on every render of the Program row, and canonicalizing a
   * scene is O(document) — 0.61 ms at 64 nodes, so tens of milliseconds at
   * broadcast scale, on a path that runs whenever anything repaints. Measured,
   * not assumed: the authoring benchmark showed `pending` costing more than
   * three quarters of what a whole Take costs.
   *
   * A `WeakMap` is safe as the key because documents are IMMUTABLE — every edit
   * produces a new object — so identity is exactly as precise as content, and
   * an old document is collected with its entry. The same trick the workbench's
   * `SceneIndex` uses, for the same reason.
   */
  #canonical = new WeakMap<SceneDocument, string>();

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
   * TEMPORARY. The next task gives every verb an explicit channel and this
   * goes away. It exists so that introducing channels is a refactor with no
   * behaviour change, reviewable on its own.
   */
  get program(): StudioSession {
    return this.channel("lower");
  }

  get state(): ProgramState {
    return this.#state;
  }

  /**
   * True only when frames are actually going out.
   *
   * NOT `state !== "off-air"`. A cued graphic is armed and invisible, and
   * counting it as on air would put the red spine across the top of the
   * application for something nobody is watching — and would duck the
   * interface sound of an operator who is still preparing.
   */
  get onAir(): boolean {
    return this.#state === "on-air" || this.#state === "holding";
  }

  get cued(): boolean {
    return this.#state === "cued";
  }

  /** Graphics that actually reached air this run. A disarmed cue is not one. */
  get takes(): number {
    return this.#takes;
  }

  /**
   * Milliseconds on air, live while transmitting and frozen once off.
   *
   * Frozen rather than reset: the number an operator reads AFTER a show is the
   * one they need, and a duration that snapped to zero the moment they went
   * off air would be the one moment it was useless.
   */
  elapsed(now = Date.now()): number {
    if (this.#firstAiredAt === null) return 0;
    return (this.#wentOffAt ?? now) - this.#firstAiredAt;
  }

  /** When the transmission ended, or null if it has not. */
  get wentOffAt(): number | null {
    return this.#wentOffAt;
  }

  /**
   * True when Preview has changed since it was cued.
   *
   * The question an operator cannot otherwise ask: "is the thing I armed still
   * the thing I armed?" Somebody retyping a name after the cue is normal and
   * fine — but it must be VISIBLE, because the alternative is taking a graphic
   * you checked and airing one you did not.
   */
  get cueStale(): boolean {
    return this.#state === "cued" && this.#hash(this.preview.document) !== this.#cuedHash;
  }

  /**
   * Arms Preview. Nothing reaches air.
   *
   * Refused while on air, deliberately: an operator cannot cue over a live
   * transmission with one keystroke, because the state that would produce —
   * "on air AND armed" — has no honest single indicator, and a tally that
   * cannot be read at a glance is worse than no tally.
   */
  cue(): TakeResult {
    if (this.onAir) {
      return { mode: "take", state: this.#state, played: this.#playing };
    }
    this.#cuedHash = this.#hash(this.preview.document);
    this.#state = "cued";
    return this.#emit({ mode: "take", state: this.#state, played: null });
  }

  /** Disarms. Only ever from `cued`, so it cannot take anything off air. */
  uncue(): TakeResult {
    if (this.#state !== "cued") {
      return { mode: "take", state: this.#state, played: this.#playing };
    }
    this.#cuedHash = null;
    this.#state = "off-air";
    return this.#emit({ mode: "cut", state: this.#state, played: null });
  }

  /** The timeline Program is currently running, if any. */
  get playing(): string | null {
    return this.#playing;
  }

  /**
   * True when Preview differs from what was last aired.
   *
   * Compared by canonical form, so it is exact and cheap to reason about: two
   * documents that serialise identically are the same graphic, whatever route
   * either took to get there. An operator needs to know there is something to
   * take, and "the editor is dirty" is a different question — a designer can
   * make and undo a change and correctly have nothing pending.
   */
  get pending(): boolean {
    return this.#hash(this.preview.document) !== this.#airedHash;
  }

  #hash(document: SceneDocument): string {
    const cached = this.#canonical.get(document);
    if (cached !== undefined) return cached;
    const computed = canonicalize(document);
    this.#canonical.set(document, computed);
    return computed;
  }

  /**
   * Sends Preview to Program.
   *
   * `cut` lands the graphic instantly. `take` lands it and plays the entrance.
   * `auto` does that and arms the exit, which the caller advances by calling
   * `continue`. Nothing here starts a timer: a hidden timer is a graphic that
   * leaves air while an operator is still talking about it.
   */
  take(mode: TakeMode = "take"): TakeResult {
    const document = this.preview.document;
    const bytes = this.#hash(document);
    // A fresh parse of the same bytes, so Program can never share a reference
    // with something the designer is still editing.
    this.program.open(JSON.parse(bytes) as SceneDocument);
    this.#airedHash = bytes;
    // The cue is CONSUMED, not kept. What was armed is now what is out, and a
    // cue that survived its own take would leave the strip armed for a graphic
    // that has already gone.
    this.#cuedHash = null;
    this.#takes += 1;
    // The run starts at the FIRST take and is not restarted by later ones —
    // a show is one transmission however many graphics go through it.
    if (this.#firstAiredAt === null) this.#firstAiredAt = Date.now();
    this.#wentOffAt = null;
    this.#state = "on-air";
    this.#playing = null;

    if (mode === "cut") {
      // Still stepped once: a graphic that has never had a frame rendered has
      // no world matrices, and the first output frame would be empty.
      this.program.render();
      return this.#emit({ mode, state: this.#state, played: null });
    }

    const entrance = entranceOf(this.program.document);
    if (entrance !== null) {
      this.program.play();
      this.program.playClip(entrance.id);
      this.#playing = entrance.id;
    }
    this.program.render();
    return this.#emit({ mode, state: this.#state, played: this.#playing });
  }

  /** Alias, because an operator says "cut" and means a take with no animation. */
  cut(): TakeResult {
    return this.take("cut");
  }

  auto(): TakeResult {
    return this.take("auto");
  }

  /**
   * Freezes Program where it is.
   *
   * Pauses the clock rather than stopping it: `stop` would rewind, and a
   * graphic that jumps back to frame zero when an operator holds it is the
   * worst possible response to "wait".
   */
  hold(): void {
    // `!onAir` rather than `=== "off-air"`: holding a CUED graphic would put
    // the bus in `holding` — which reads as on air everywhere — for something
    // that has never been transmitted.
    if (!this.onAir) return;
    this.program.pause();
    this.#state = "holding";
    this.#emit({ mode: "take", state: this.#state, played: this.#playing });
  }

  /**
   * Resumes a hold, or plays the exit when already running.
   *
   * One button doing two things is deliberate and is what an operator's finger
   * expects: Continue means "carry on", and what carrying on means depends on
   * whether the graphic is paused or finished arriving.
   */
  continue(): TakeResult {
    if (this.#state === "holding") {
      this.program.play();
      this.#state = "on-air";
      return this.#emit({ mode: "take", state: this.#state, played: this.#playing });
    }

    const exit = exitOf(this.program.document);
    if (exit === null) return this.#emit({ mode: "take", state: this.#state, played: this.#playing });

    this.program.play();
    this.program.playClip(exit.id);
    this.#playing = exit.id;
    return this.#emit({ mode: "take", state: this.#state, played: exit.id });
  }

  /** Clears Program. The graphic is off air and the surface is empty. */
  clear(): void {
    this.program.stop();
    this.#state = "off-air";
    this.#cuedHash = null;
    this.#playing = null;
    // Stamped only if something was ever on air, so an operator who never
    // took anything is not shown a closure for a show that did not happen.
    if (this.#firstAiredAt !== null) this.#wentOffAt = Date.now();
    // The aired hash is NOT cleared: what was last on air is still what was
    // last on air, and `pending` should not become true merely because the
    // surface is empty.
    this.#emit({ mode: "cut", state: this.#state, played: null });
  }

  subscribe(listener: BusListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(result: TakeResult): TakeResult {
    for (const listener of this.#listeners) listener(this);
    return result;
  }
}
