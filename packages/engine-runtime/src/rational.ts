/**
 * Exact rational arithmetic.
 *
 * Broadcast frame rates are rationals, not decimals: 29.97 is exactly
 * 30000/1001, and 1/29.97 is 33.3666...ms which no binary float represents.
 * ENGINE_RUNTIME §1.1 — accumulating that error over an 8-hour event drifts by
 * seconds, and a facility's timecode will not agree with ours.
 *
 * Values are normalised on construction (reduced, positive denominator) so
 * structural equality matches mathematical equality.
 */

export interface Rational {
  readonly num: number;
  readonly den: number;
}

export class RationalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RationalError";
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x;
}

export function rational(num: number, den = 1): Rational {
  if (!Number.isInteger(num) || !Number.isInteger(den)) {
    throw new RationalError(
      `rational requires integers, received ${num}/${den}`,
    );
  }
  if (den === 0) throw new RationalError("denominator must not be zero");

  const sign = den < 0 ? -1 : 1;
  const divisor = gcd(num, den) || 1;
  return { num: (sign * num) / divisor, den: (sign * den) / divisor };
}

export function multiply(a: Rational, b: Rational): Rational {
  return rational(a.num * b.num, a.den * b.den);
}

export function divide(a: Rational, b: Rational): Rational {
  if (b.num === 0) throw new RationalError("division by zero");
  return rational(a.num * b.den, a.den * b.num);
}

export function add(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function subtract(a: Rational, b: Rational): Rational {
  return rational(a.num * b.den - b.num * a.den, a.den * b.den);
}

/** -1, 0, or 1. Cross-multiplication avoids any float conversion. */
export function compare(a: Rational, b: Rational): number {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function equals(a: Rational, b: Rational): boolean {
  return a.num === b.num && a.den === b.den;
}

export function isZero(value: Rational): boolean {
  return value.num === 0;
}

/**
 * Approximate decimal value. For display and for interop with APIs that only
 * take numbers — never for engine arithmetic, which stays exact.
 */
export function toNumber(value: Rational): number {
  return value.num / value.den;
}

export function toString(value: Rational): string {
  return value.den === 1 ? `${value.num}` : `${value.num}/${value.den}`;
}

/** Largest integer not greater than the value. Correct for negatives. */
export function floorToInteger(value: Rational): number {
  return Math.floor(value.num / value.den);
}

export const ZERO: Rational = { num: 0, den: 1 };
export const ONE: Rational = { num: 1, den: 1 };

/**
 * Broadcast frame rates, in frames per second.
 *
 * The 1001 denominators are the NTSC rates. They are the reason this module
 * exists.
 */
export const FRAME_RATES = {
  film24: rational(24, 1),
  ntscFilm: rational(24000, 1001), // 23.976
  pal25: rational(25, 1),
  ntsc2997: rational(30000, 1001), // 29.97
  smpte30: rational(30, 1),
  pal50: rational(50, 1),
  ntsc5994: rational(60000, 1001), // 59.94
  smpte60: rational(60, 1),
} as const;

export type FrameRateName = keyof typeof FRAME_RATES;
