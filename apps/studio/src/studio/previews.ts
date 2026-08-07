/**
 * Template previews, drawn by the engine that will draw them on air.
 *
 * ============================================================================
 * WHY THIS EXISTS AT ALL
 * ============================================================================
 * Home showed eight template cards and six of them carried the SAME picture:
 * a bar, a long line and a short line. Lower Third, Sponsor Bar, Ticker,
 * Breaking News, Leaderboard and Countdown were indistinguishable, so the most
 * important screen in the product — the one that decides what somebody makes —
 * asked them to choose between six identical things.
 *
 * A hand-drawn icon per template would have fixed the sameness and introduced a
 * worse problem: a picture that has to be redrawn every time the graphic
 * changes, and which is wrong the moment somebody installs a theme. The
 * Marketplace's whole premise is that a pack RESTYLES what you already have,
 * and an illustration cannot show that.
 *
 * So the card shows the real thing. Each template is built into a real
 * document, handed to the real engine and rendered with the real fonts, and
 * the resulting pixels become the card. Install Broadcast Red and every card
 * turns red, because every card IS the graphic.
 *
 * This is also the single clearest answer to "why is Streamatrix different" —
 * no other browser tool can put its own renderer's output on its own home
 * screen, because no other browser tool has one.
 *
 * ============================================================================
 * ONE AT A TIME, AND THEN GONE
 * ============================================================================
 * Each preview gets a backend and gives it straight back. A browser will
 * refuse somewhere around the sixteenth live WebGL context, and there are more
 * templates than that once a few packs are installed — so they are rendered in
 * sequence and each one is disposed before the next begins. At most one extra
 * context exists at any moment.
 *
 * Rendering yields to the browser between templates. This runs while somebody
 * is looking at Home, and a home screen that janks for a second while it draws
 * its own thumbnails would be worse than the six identical icons.
 */
import type { SceneDocument, SceneToken } from "@bracketx/engine-scene";

import { instantiateTemplate, type PackTemplate } from "./packs";
import { entranceOf } from "./program";
import { createBackend, type RendererChoice } from "./renderer";
import { StudioSession } from "./session";
import type { IdFactory } from "./ids";
import type { ImageProvider, TextProvider } from "@bracketx/engine-reconciler";

export interface PreviewOptions {
  readonly renderer: RendererChoice;
  readonly text?: TextProvider;
  readonly images?: ImageProvider;
  /** Theme tokens, so a preview shows the palette that is actually installed. */
  readonly theme?: readonly SceneToken[];
  /** Width of the rendered tile. Height follows the document's aspect. */
  readonly width?: number;
  readonly now?: string;
}

/**
 * A rig that renders previews. Made once, used for all of them, then closed.
 *
 * ============================================================================
 * ONE CONTEXT, NOT ONE PER TEMPLATE
 * ============================================================================
 * The first version made a backend per template and gave it straight back.
 * That is correct and it is slow: creating a WebGL context is the expensive
 * part, and eight of them took two and a half seconds — long enough that
 * somebody watched their home screen fill in.
 *
 * A session can be handed a new document (`open` — "a file open"), so one
 * context draws all of them. It is also the only honest reading of what this
 * is: one machine photographing a series of graphics, not eight machines.
 */
export class PreviewRig {
  readonly #canvas: HTMLCanvasElement;
  readonly #session: StudioSession;
  #disposed = false;

  private constructor(canvas: HTMLCanvasElement, session: StudioSession) {
    this.#canvas = canvas;
    this.#session = session;
  }

  /** Null where there is no DOM or no GPU. A preview is never worth a crash. */
  static create(options: PreviewOptions, seed: SceneDocument): PreviewRig | null {
    try {
      const canvas = globalThis.document?.createElement("canvas");
      if (canvas === undefined) return null;
      const width = options.width ?? 480;
      canvas.width = width;
      canvas.height = Math.round((width * seed.world.output.height) / seed.world.output.width);
      const backend = createBackend(options.renderer, canvas, { antialias: true });
      return new PreviewRig(
        canvas,
        new StudioSession(backend, seed, {
          ...(options.text === undefined ? {} : { text: options.text }),
          ...(options.images === undefined ? {} : { images: options.images }),
        }),
      );
    } catch {
      return null;
    }
  }

  /** One template, as a data URL, or null. */
  capture(document_: SceneDocument): string | null {
    if (this.#disposed) return null;
    try {
      this.#session.open(document_);
      // Held past the end of the entrance, not at frame zero. Every template
      // animates ON, so frame zero is an empty screen — the previews were
      // black rectangles the first time this ran, which is a perfectly
      // faithful rendering of a graphic that has not arrived yet.
      this.#session.seek(holdPoint(document_));
      this.#session.render();
      return framed(this.#canvas);
    } catch {
      return null;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#session.dispose();
  }
}

/**
 * The picture, framed on what is actually in it.
 *
 * ============================================================================
 * A FULL FRAME IS MOSTLY EMPTY, AND THAT MADE THE CARDS LOOK EMPTY
 * ============================================================================
 * A lower third occupies the lower third. A ticker is a strip along the
 * bottom. Rendered at full frame into a card, seven tenths of every tile was
 * black and the graphic was a band too small to read — truthful, and it made
 * the most important screen in the product look unfinished.
 *
 * Cropping to the graphic alone would fix the emptiness and lose the one thing
 * the emptiness was saying: WHERE in frame the graphic sits. A lower third
 * cropped to its own edges is just a bar, and a designer choosing between a
 * lower third and a sponsor bar would have nothing to choose by.
 *
 * So it crops to the content and then GIVES BACK a generous margin, keeping
 * the frame's own shape. The graphic fills the tile, and it is still visibly
 * sitting at the bottom of a wider picture.
 *
 * Read from the alpha channel, because a broadcast graphic is transparent
 * everywhere it is not: "what is in the picture" is a question the pixels
 * already answer exactly.
 */
function framed(source: HTMLCanvasElement): string {
  const context = source.getContext("2d") ?? null;
  // A WebGL canvas has no 2D context, so the pixels are copied into one that
  // does. This is one small blit per template, once, at start-up.
  const scratch = globalThis.document.createElement("canvas");
  scratch.width = source.width;
  scratch.height = source.height;
  const scratchContext = scratch.getContext("2d", { willReadFrequently: true });
  if (scratchContext === null) return source.toDataURL("image/png");
  scratchContext.drawImage(source, 0, 0);
  void context;

  const box = contentBounds(scratchContext, scratch.width, scratch.height);
  if (box === null) return source.toDataURL("image/png");

  const out = globalThis.document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const outContext = out.getContext("2d");
  if (outContext === null) return source.toDataURL("image/png");
  outContext.drawImage(
    scratch,
    box.x, box.y, box.width, box.height,
    0, 0, out.width, out.height,
  );
  return out.toDataURL("image/png");
}

/**
 * The part of the frame the graphic actually occupies, plus air, in the
 * frame's own aspect.
 *
 * The margin is a share of the CONTENT rather than of the frame, so a strap
 * and a full-screen title card both end up with the same amount of air around
 * them rather than the strap being lost in a fixed border.
 */
function contentBounds(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } | null {
  const { data } = context.getImageData(0, 0, width, height);
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  // Every fourth row and column. A broadcast graphic is a solid shape, not a
  // scatter of pixels, so a coarse scan finds the same box for a sixteenth of
  // the reads — and this runs once per template while somebody is waiting.
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      // 10 rather than 0: an antialiased edge and a shadow both leave a haze
      // of nearly-nothing across half the frame, and cropping to that is
      // cropping to the whole frame again.
      if (data[(y * width + x) * 4 + 3]! < 10) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0 || bottom < 0) return null;

  const margin = Math.max((right - left) * 0.14, (bottom - top) * 0.5, width * 0.03);
  let x0 = left - margin;
  let y0 = top - margin;
  let x1 = right + margin;
  let y1 = bottom + margin;

  // Back to the frame's aspect, by growing the short side. Growing rather than
  // cropping, so nothing that was in the box is pushed out of it.
  const aspect = width / height;
  let boxWidth = x1 - x0;
  let boxHeight = y1 - y0;
  if (boxWidth / boxHeight < aspect) {
    const wanted = boxHeight * aspect;
    const grow = (wanted - boxWidth) / 2;
    x0 -= grow;
    x1 += grow;
  } else {
    const wanted = boxWidth / aspect;
    const grow = (wanted - boxHeight) / 2;
    y0 -= grow;
    y1 += grow;
  }

  // Slid back inside the frame rather than clamped: clamping changes the
  // aspect again and the crop stops matching the tile.
  boxWidth = Math.min(x1 - x0, width);
  boxHeight = Math.min(y1 - y0, height);
  x0 = Math.max(0, Math.min(width - boxWidth, x0));
  y0 = Math.max(0, Math.min(height - boxHeight, y0));
  return { x: x0, y: y0, width: boxWidth, height: boxHeight };
}

/**
 * The moment a template looks most like itself.
 *
 * The end of its longest entrance, plus a beat. Taking the very last frame
 * would be equally arrived-at and would also catch anything that animates OFF
 * again; a third past the end of the entrance is the pose a designer would
 * choose for a press shot.
 */
function holdPoint(document_: SceneDocument): number {
  let longest = 0;
  for (const timeline of document_.animations ?? []) {
    longest = Math.max(longest, timeline.duration);
  }
  // Seconds in the timeline, FRAMES at the seek. Confusing the two renders
  // every preview at frame zero, which is a faithful picture of a graphic
  // that has not arrived yet — a black rectangle.
  return longest === 0 ? 0 : Math.round((longest * 0.75 + 0.15) * document_.world.output.fps);
}

/**
 * Every template, rendered in sequence, reporting each as it lands.
 *
 * Incremental on purpose: a home screen that fills in card by card feels like
 * it is working, and one that shows nothing for a second and then everything
 * feels like it stalled. The callback is what lets the cards arrive.
 */
export async function renderTemplatePreviews(
  templates: readonly PackTemplate[],
  ids: IdFactory,
  options: PreviewOptions,
  onPreview: (templateId: string, url: string) => void,
  shouldStop: () => boolean = () => false,
): Promise<void> {
  if (templates.length === 0) return;
  const now = options.now ?? "2026-01-01T00:00:00.000Z";
  const built = templates.map((template) => ({
    id: template.id,
    document: instantiateTemplate(template, ids, now, options.theme ?? []),
  }));

  const rig = PreviewRig.create(options, built[0]!.document);
  if (rig === null) return;
  try {
    for (const entry of built) {
      if (shouldStop()) return;
      const url = rig.capture(entry.document);
      if (url !== null) onPreview(entry.id, url);
      // Back to the browser between each. This runs while somebody is looking
      // at Home, and a home screen that janks while drawing its own thumbnails
      // would be worse than the placeholder it is replacing.
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  } finally {
    rig.dispose();
  }
}

/**
 * THE HOVER PLAYER.
 *
 * ============================================================================
 * POINT AT A GRAPHIC AND IT PLAYS
 * ============================================================================
 * A still tells you what a template looks like. It cannot tell you what it
 * DOES — and for a broadcast graphic, what it does is most of the decision.
 * "Slides in from the left", "wipes open, then the headline arrives", "fades
 * up": those are the descriptions under the cards, and until now they were
 * words a person had to take on trust.
 *
 * Hovering plays the real animation, through the real engine, at the real
 * frame rate. Not a video, not a sprite sheet, not a recording — the same
 * renderer that will put it on air, running the same timeline, one second
 * before the person decides. Nothing else in a browser can do that, which is
 * exactly why it is worth the code.
 *
 * ============================================================================
 * ONE CONTEXT, MOVED AROUND
 * ============================================================================
 * A player per card would mean forty WebGL contexts on the Marketplace and a
 * browser that refuses the seventeenth. Only one card is ever under the
 * pointer, so there is one hidden renderer and its frames are BLITTED into
 * whichever tile is asking — one `drawImage` per frame.
 *
 * Starting is instant because the context already exists. Building one on
 * hover would take a couple of hundred milliseconds, which is exactly long
 * enough for a person to have moved on.
 */
export class PreviewPlayer {
  readonly #canvas: HTMLCanvasElement;
  readonly #session: StudioSession;
  #target: HTMLCanvasElement | null = null;
  #document: SceneDocument | null = null;
  #raf = 0;
  #started = 0;
  #loop = 0;
  #disposed = false;

  private constructor(canvas: HTMLCanvasElement, session: StudioSession) {
    this.#canvas = canvas;
    this.#session = session;
  }

  static create(options: PreviewOptions, seed: SceneDocument): PreviewPlayer | null {
    try {
      const canvas = globalThis.document?.createElement("canvas");
      if (canvas === undefined) return null;
      const width = options.width ?? 480;
      canvas.width = width;
      canvas.height = Math.round((width * seed.world.output.height) / seed.world.output.width);
      const backend = createBackend(options.renderer, canvas, { antialias: true });
      return new PreviewPlayer(
        canvas,
        new StudioSession(backend, seed, {
          ...(options.text === undefined ? {} : { text: options.text }),
          ...(options.images === undefined ? {} : { images: options.images }),
        }),
      );
    } catch {
      return null;
    }
  }

  /**
   * Plays a document into a tile until told to stop.
   *
   * It LOOPS, with a pause at the end. A broadcast entrance is under a second;
   * played once, a person who glanced away has missed it and has to leave and
   * come back. The hold is what stops the loop reading as a stutter — you see
   * the graphic arrive, you see it SIT there, and then it goes again.
   */
  play(document_: SceneDocument, target: HTMLCanvasElement): void {
    if (this.#disposed) return;
    this.stop();
    try {
      this.#session.open(document_);
    } catch {
      return;
    }
    this.#target = target;
    this.#document = document_;
    this.#loop = loopLength(document_);
    this.#started = performance.now();
    // THE CLOCK HAS TO BE RUNNING.
    //
    // The first version seeked a stopped clock frame by frame and every frame
    // came out identical — because a template is AUTHORED at its arrived
    // state and its entrance animates from an offset back to that. A static
    // render is therefore the finished graphic, which looks entirely correct
    // and is not an animation at all. (It is also why the stills looked right
    // by accident.)
    //
    // The engine owns the clock, so the honest thing is to start it and let it
    // run, exactly as the editor's transport does.
    this.#restart(document_);
    this.#tick();
  }

  stop(): void {
    if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#target = null;
    // The clock stops with it. A paused renderer costs nothing; one left
    // running is a timeline advancing for a card nobody is looking at.
    if (!this.#disposed) {
      try {
        this.#session.pause();
      } catch {
        // A disposed session refuses, which is the state we wanted anyway.
      }
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.stop();
    this.#disposed = true;
    this.#session.dispose();
  }

  /**
   * Runs the graphic's entrance, the way going to air runs it.
   *
   * A TIMELINE IS A CLIP, and a clip has to be PLAYED. Starting the clock and
   * expecting motion is the mistake that cost this feature an afternoon: the
   * clock ran, the frame counter advanced, and every rendered frame was
   * identical — because a template is authored at its ARRIVED state and its
   * entrance animates from an offset back to that. A document with a running
   * clock and no clip playing is a finished graphic sitting still.
   *
   * `entranceOf` is the same selector `ProgramBus` uses when a graphic
   * actually goes on air, so the card shows what a take would show. Two ways
   * of deciding which timeline is the entrance would eventually disagree, and
   * the day they did, a card would advertise a move the show does not make.
   */
  #restart(document_: SceneDocument | null): void {
    if (document_ === null) return;
    this.#session.seek(0);
    this.#session.play();
    const entrance = entranceOf(document_);
    if (entrance !== null) this.#session.playClip(entrance.id);
  }

  #tick = (): void => {
    const target = this.#target;
    if (target === null || this.#disposed) return;

    const now = performance.now();
    try {
      // Back to the top when the loop is up, and then playing again. A
      // broadcast entrance is under a second; played once, somebody who
      // glanced away has missed it and has to leave the card and come back.
      if (this.#loop > 0 && now - this.#started > this.#loop * 1000) {
        this.#started = now;
        this.#restart(this.#document);
      }
      // NO WALL TIME. `render()` with an argument treats it as absolute, and
      // `performance.now()` is however long the page has been open — so the
      // clock jumped several seconds past the end of the entrance on the very
      // first frame and every frame after it, which renders as a graphic that
      // has already arrived and never moves. The engine keeps its own 60fps
      // counter; the editor's own render loop calls it exactly like this.
      this.#session.render();
      const context = target.getContext("2d");
      if (context !== null) {
        // The tile is sized in CSS pixels and the renderer works at its own
        // resolution, so the blit is a scale as well as a copy. Cleared first:
        // a broadcast graphic is transparent, and without the clear the
        // previous frame shows through the gaps in this one.
        if (target.width !== this.#canvas.width || target.height !== this.#canvas.height) {
          target.width = this.#canvas.width;
          target.height = this.#canvas.height;
        }
        context.clearRect(0, 0, target.width, target.height);
        context.drawImage(this.#canvas, 0, 0);
      }
    } catch {
      this.stop();
      return;
    }
    this.#raf = requestAnimationFrame(this.#tick);
  };
}

/**
 * How long a template's loop is: its longest timeline, plus a beat to sit.
 *
 * The hold matters more than it sounds. Without it the graphic arrives and
 * instantly restarts, which reads as a glitch rather than as a loop — and a
 * preview that looks broken is worse than no preview.
 */
function loopLength(document_: SceneDocument): number {
  let longest = 0;
  for (const timeline of document_.animations ?? []) {
    longest = Math.max(longest, timeline.duration);
  }
  return longest === 0 ? 0 : longest + 1.1;
}
