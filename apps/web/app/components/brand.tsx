import { cn } from "@bracketx/ui";

/**
 * The BracketX mark. Brackets are the product's namesake and the esports
 * primitive it exists to render, so the logotype is literally one.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-baseline font-semibold tracking-tight",
        className,
      )}
    >
      <span aria-hidden className="text-accent">
        [
      </span>
      <span className="text-fg">Bracket</span>
      <span className="text-accent">X</span>
      <span aria-hidden className="text-accent">
        ]
      </span>
    </span>
  );
}
