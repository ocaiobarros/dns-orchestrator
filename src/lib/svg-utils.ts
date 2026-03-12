// ============================================================
// DNS Control — SVG Safety Utilities
// Defensive helpers to prevent SVG runtime crashes from
// undefined/null/NaN numeric attributes (r, cx, cy, etc.)
// ============================================================

/**
 * Ensures a numeric value is safe for SVG attributes.
 * Returns fallback if value is undefined, null, NaN, or Infinity.
 */
export function safeNum(value: unknown, fallback: number = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Safe radius — minimum 1px */
export function safeR(value: unknown, fallback: number = 6): number {
  return Math.max(1, safeNum(value, fallback));
}

/** Safe coordinate */
export function safeCx(value: unknown, fallback: number = 0): number {
  return safeNum(value, fallback);
}

/** Safe stroke width — minimum 0.1 */
export function safeSW(value: unknown, fallback: number = 1): number {
  return Math.max(0.1, safeNum(value, fallback));
}

/** Safe opacity — clamped 0–1 */
export function safeOpacity(value: unknown, fallback: number = 1): number {
  return Math.max(0, Math.min(1, safeNum(value, fallback)));
}

/** Safe dimension (width/height) — minimum 0 */
export function safeDim(value: unknown, fallback: number = 0): number {
  return Math.max(0, safeNum(value, fallback));
}
