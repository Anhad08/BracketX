import { useEffect } from "react";
import { keyForSide, type Scoreboard } from "../studio/scoring";

/**
 * The scoring surface.
 *
 * ============================================================================
 * ONE ACT IS COMMON; THE OTHER IS A CORRECTION
 * ============================================================================
 * Adding a point happens dozens of times a match, often without looking. Taking
 * one back happens when somebody mis-hit, and it must never be the same size or
 * the same weight as the thing it corrects — a symmetrical pair of small chips
 * is how a mis-click becomes two mis-clicks.
 *
 * So: one large target per side, a smaller correction beside it, and the score
 * itself set large and tabular so it can be read across a desk without leaning
 * in. Tabular because a score that changes width when it passes 9 draws the eye
 * to the wrong thing.
 *
 * ============================================================================
 * THE KEYBOARD IS THE POINT
 * ============================================================================
 * Left hand for the left side, right hand for the right, mirroring where the
 * teams already are on screen and on the wall. Shift corrects. The keys are
 * PRINTED on the buttons, so an operator learns them by using the mouse rather
 * than by reading a reference they will never open.
 */
export interface ScoringProps {
  readonly board: Scoreboard;
  readonly onStep: (scoreKey: string, delta: number) => void;
  readonly onUndo: () => void;
  readonly canUndo: boolean;
  /** Suspends the keyboard — a scene with nothing loaded has nothing to score. */
  readonly enabled: boolean;
}

export function Scoring({ board, onStep, onUndo, canUndo, enabled }: ScoringProps) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      // NEVER while typing. A producer editing a team's name must be able to
      // type the letter q without scoring a goal.
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const pressed = event.key.toLowerCase();
      const index = board.sides.findIndex((_, i) => keyForSide(i) === pressed);
      if (index === -1) return;
      event.preventDefault();
      onStep(board.sides[index]!.scoreKey, event.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board, onStep, enabled]);

  return (
    <section className="home-block scoring" data-testid="scoring">
      <div className="block-head">
        <h2>Score</h2>
        <span className="dim">
          {canUndo ? (
            <button type="button" className="link" data-testid="score-undo" onClick={onUndo}>
              Undo last point
            </button>
          ) : (
            "Changes go out as you make them"
          )}
        </span>
      </div>

      <div className="score-grid">
        {board.sides.map((side, index) => {
          const key = keyForSide(index);
          return (
            <div className="side" key={side.scoreKey} data-testid={`side-${side.scoreKey}`}>
              <span className="side-name" title={side.name}>
                {side.name}
              </span>

              <span className="side-score" data-testid={`score-${side.scoreKey}`}>
                {side.score}
              </span>

              <div className="side-controls">
                {/* THE COMMON ACT. Large, primary, and the only thing here that
                    looks like it wants to be pressed. */}
                <button
                  type="button"
                  className="score-add"
                  data-testid={`score-up-${side.scoreKey}`}
                  aria-label={`${side.name} up one`}
                  onClick={() => onStep(side.scoreKey, 1)}
                >
                  +1
                  {key === null ? null : <kbd>{key.toUpperCase()}</kbd>}
                </button>

                {/* THE CORRECTION. Deliberately quieter, and deliberately not
                    the same shape. */}
                <button
                  type="button"
                  className="score-take"
                  data-testid={`score-down-${side.scoreKey}`}
                  aria-label={`${side.name} down one`}
                  disabled={side.score === 0}
                  onClick={() => onStep(side.scoreKey, -1)}
                >
                  −1
                  {key === null ? null : <kbd>⇧{key.toUpperCase()}</kbd>}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
