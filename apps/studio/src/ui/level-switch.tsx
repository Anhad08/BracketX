import { levelLabels } from "../studio/shell";
import type { Section } from "../studio/shell";
import type { Depth } from "../studio/workspace";

/**
 * How much of the product is revealed, as a control a person can find.
 *
 * ============================================================================
 * WHY THIS COMPONENT HAD TO EXIST
 * ============================================================================
 * `Depth` has been in the workspace since Phase 4, has always had two honest
 * states, and has never had a surface. The result is the worst of both: a
 * beginner meets whatever the default happens to be and cannot leave it, and
 * an expert cannot reach the construction tools without knowing an unlisted
 * keystroke. Neither audience got the thing that was built for them.
 *
 * Two positions, always the same two, always in the same place on screen. A
 * section with nothing to reveal renders nothing rather than an inert control.
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
    <div
      className="level-switch"
      role="group"
      aria-label="How much is shown"
      data-testid="level-switch"
    >
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
