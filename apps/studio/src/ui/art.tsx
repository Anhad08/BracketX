import { useCallback, useRef, type ReactNode } from "react";

/**
 * A graphic's picture on a card — still, and then moving when you point at it.
 *
 * ============================================================================
 * WHAT A STILL CANNOT SAY
 * ============================================================================
 * A still tells you what a template LOOKS like. It cannot tell you what it
 * DOES, and for a broadcast graphic what it does is most of the decision.
 * "Slides in from the left." "Wipes open, then the headline arrives." "Fades
 * up." Those are the descriptions printed under the cards, and until now they
 * were words a person had to take on trust.
 *
 * Point at the card and the real animation runs, through the real engine, at
 * the real frame rate — the same renderer that will put it on air, running the
 * same timeline, a second before the person decides. Not a video, not a sprite
 * sheet, not a recording of one.
 *
 * ============================================================================
 * ONE COMPONENT, EVERY SURFACE
 * ============================================================================
 * Home, Templates, the Marketplace and Production's scene rail all show the
 * same graphics, and a hover that behaved differently on each would read as
 * four products. The still, the canvas, the fallback and the hand-off to the
 * player live here once.
 */

export interface ArtProps {
  /** Which template this tile is showing. */
  readonly templateId: string;
  /** The rendered still, once it exists. */
  readonly still: string | undefined;
  /**
   * Starts playing this template into the given surface, or does nothing where
   * there is no renderer. Returning nothing is the honest answer on a machine
   * that cannot draw: the still stays, which is what it is for.
   */
  readonly onPlay: ((templateId: string, into: HTMLCanvasElement) => void) | undefined;
  readonly onStop: (() => void) | undefined;
  /** Drawn while the still is being rendered, so the grid never reflows. */
  readonly placeholder?: ReactNode;
  readonly className?: string;
}

export function TemplateArt({
  templateId,
  still,
  onPlay,
  onStop,
  placeholder,
  className,
}: ArtProps) {
  const surface = useRef<HTMLCanvasElement | null>(null);
  const live = useRef(false);

  const start = useCallback(() => {
    const canvas = surface.current;
    if (canvas === null || onPlay === undefined) return;
    live.current = true;
    // The class rather than a state flag: this fires on every pointer entry
    // across a grid of forty tiles, and a React render per hover is a render
    // per hover. Nothing above this component needs to know.
    canvas.classList.add("on");
    onPlay(templateId, canvas);
  }, [onPlay, templateId]);

  const stop = useCallback(() => {
    const canvas = surface.current;
    if (canvas !== null) canvas.classList.remove("on");
    if (live.current) {
      live.current = false;
      onStop?.();
    }
  }, [onStop]);

  return (
    <span
      className={`art ${className ?? ""}`}
      aria-hidden
      onPointerEnter={start}
      onPointerLeave={stop}
      // Focus as well as hover, because the cards are buttons and a person
      // tabbing through them is choosing between the same graphics with the
      // same question in mind.
      onFocus={start}
      onBlur={stop}
    >
      {still === undefined ? placeholder : <img className="art-still" src={still} alt="" />}
      {/* Above the still and transparent until it is playing, so the swap is a
          fade rather than a gap. A canvas that unmounted on leave would flash
          the card's background between the last frame and the still. */}
      <canvas className="art-live" ref={surface} />
    </span>
  );
}
