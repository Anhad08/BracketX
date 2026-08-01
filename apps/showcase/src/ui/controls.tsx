import type { ReactNode } from "react";

/**
 * Control primitives.
 *
 * Deliberately plain. A showcase control exists to issue one command and show
 * its effect; anything more elaborate competes for attention with the scene it
 * is meant to verify.
 */

export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="control-group">
      <span className="control-label">{label}</span>
      <div className="control-row">{children}</div>
    </div>
  );
}

export function Action({
  label,
  onClick,
  tone,
  disabled,
}: {
  label: string;
  onClick: () => void;
  tone?: "primary" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`control-button ${tone ?? ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

export function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="control-choice">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={option === value ? "active" : ""}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (next: number) => void;
  format?: (value: number) => string;
}) {
  return (
    <label className="control-slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="control-value">{format ? format(value) : value}</span>
    </label>
  );
}

export function Swatches({
  colors,
  value,
  onChange,
}: {
  colors: readonly string[];
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="control-swatches">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          className={color.toLowerCase() === value.toLowerCase() ? "active" : ""}
          style={{ background: color }}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  );
}

export function TextField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      className="control-text"
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="control-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

/** Reads a variable with a fallback, for controls that display as well as set. */
export function read<T>(
  variables: Readonly<Record<string, unknown>>,
  key: string,
  fallback: T,
): T {
  const value = variables[key];
  return value === undefined ? fallback : (value as T);
}
