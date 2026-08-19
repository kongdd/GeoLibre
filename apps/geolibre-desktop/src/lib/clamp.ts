/**
 * Clamp a number to the inclusive range [min, max].
 *
 * @param value - The value to clamp.
 * @param min - Lower bound.
 * @param max - Upper bound.
 * @returns `value` constrained to the range.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Parse an in-progress numeric draft without clamping temporary input. */
export function parseBoundedNumberDraft(
  raw: string,
  min: number,
  max: number,
  precision = 0,
): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return Number(value.toFixed(precision));
}
