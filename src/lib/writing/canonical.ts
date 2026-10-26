/**
 * W1.2: canonical serialisation and hashing.
 *
 * The same facts must produce the same bytes in any key order, and one changed character must
 * produce a different hash. The rules:
 *   - object keys sorted (code-unit order), no insignificant whitespace;
 *   - decimals are strings with a fixed scale, tagged `$dec` (never a floating-point number);
 *   - text is NFC-normalised;
 *   - dates are UTC, tagged `$date` / `$utc`.
 *
 * Hashing uses WebCrypto (`crypto.subtle`), the primitive already in the repo
 * (`src/lib/ledger.ts`, `src/lib/certificate.ts`). It fails closed: no weak fallback.
 */

/** A decimal as an integer of `units` at a fixed `scale`. Money uses scale 2 (minor units). */
export interface Decimal {
  readonly scale: number;
  /** The integer value as a string, so it survives any magnitude without floating point. */
  readonly units: string;
}

export class CanonicalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalError';
  }
}

const DECIMAL_TAG = '$dec';
const DATE_TAG = '$date';
const UTC_TAG = '$utc';

// ---------------------------------------------------------------------------
// Decimals
// ---------------------------------------------------------------------------

function normaliseUnits(units: string): string {
  let s = units.trim();
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^\d+$/.test(s)) throw new CanonicalError(`decimal units must be an integer string: ${units}`);
  s = s.replace(/^0+(?=\d)/, '');
  return (negative && s !== '0' ? '-' : '') + s;
}

export function decimal(units: string | number | bigint, scale: number): Decimal {
  if (!Number.isInteger(scale) || scale < 0) throw new CanonicalError(`scale must be a non-negative integer: ${scale}`);
  return { scale, units: normaliseUnits(String(units)) };
}

/** Parse a decimal string such as `-123.45` into a fixed-scale Decimal. */
export function decimalFromString(text: string, scale?: number): Decimal {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text.trim());
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new CanonicalError(`not a decimal: ${text}`);
  const [, sign, whole, frac = ''] = m;
  const targetScale = scale ?? frac.length;
  if (frac.length > targetScale) throw new CanonicalError(`more fractional digits than scale ${targetScale}: ${text}`);
  const padded = frac.padEnd(targetScale, '0');
  return decimal(`${sign}${whole || '0'}${padded}` || '0', targetScale);
}

/** The decimal as a fixed-scale string. The canonical form for hashing. */
export function decimalToString(d: Decimal): string {
  const negative = d.units.startsWith('-');
  const digits = negative ? d.units.slice(1) : d.units;
  if (d.scale === 0) return (negative ? '-' : '') + digits;
  const padded = digits.padStart(d.scale + 1, '0');
  const whole = padded.slice(0, padded.length - d.scale);
  const frac = padded.slice(padded.length - d.scale);
  return `${negative ? '-' : ''}${whole}.${frac}`;
}

/**
 * Move a decimal to another scale. Scaling up is exact. Scaling down refuses when a dropped digit
 * is non-zero, so a rescale can never silently lose a cent.
 */
export function rescaleDecimal(d: Decimal, scale: number): Decimal {
  if (d.scale === scale) return d;
  if (d.scale > scale) {
    const drop = d.scale - scale;
    const negative = d.units.startsWith('-');
    const digits = negative ? d.units.slice(1) : d.units;
    if (digits.length <= drop) {
      // Every dropped digit must be zero, or the rescale loses information.
      if (/[^0]/.test(digits)) throw new CanonicalError(`rescale would lose information: ${decimalToString(d)}`);
      return decimal('0', scale);
    }
    const kept = digits.slice(0, digits.length - drop);
    const dropped = digits.slice(digits.length - drop);
    if (/[^0]/.test(dropped)) throw new CanonicalError(`rescale would lose information: ${decimalToString(d)}`);
    return decimal((negative ? '-' : '') + kept, scale);
  }
  return decimal(d.units + '0'.repeat(scale - d.scale), scale);
}

/** Add two decimals at a common scale. */
export function addDecimal(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  const x = BigInt(rescaleDecimal(a, scale).units);
  const y = BigInt(rescaleDecimal(b, scale).units);
  return decimal((x + y).toString(), scale);
}

export function subDecimal(a: Decimal, b: Decimal): Decimal {
  const scale = Math.max(a.scale, b.scale);
  const x = BigInt(rescaleDecimal(a, scale).units);
  const y = BigInt(rescaleDecimal(b, scale).units);
  return decimal((x - y).toString(), scale);
}

/** -1, 0 or 1. */
export function compareDecimal(a: Decimal, b: Decimal): number {
  const scale = Math.max(a.scale, b.scale);
  const x = BigInt(rescaleDecimal(a, scale).units);
  const y = BigInt(rescaleDecimal(b, scale).units);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Multiply, keeping the declared result scale. Half-up rounding. */
export function mulDecimal(a: Decimal, b: Decimal, resultScale: number): Decimal {
  const product = BigInt(a.units) * BigInt(b.units);
  const rawScale = a.scale + b.scale;
  return roundUnits(product, rawScale, resultScale);
}

/** Divide, keeping the declared result scale. Half-up rounding. */
export function divDecimal(a: Decimal, b: Decimal, resultScale: number): Decimal {
  if (BigInt(b.units) === 0n) throw new CanonicalError('division by zero');
  // The quotient at `resultScale` is a.units * 10^(b.scale + resultScale) / (b.units * 10^a.scale).
  const numerator = BigInt(a.units) * 10n ** BigInt(b.scale + resultScale);
  const denominator = BigInt(b.units) * 10n ** BigInt(a.scale);
  return decimal(divideRounded(numerator, denominator).toString(), resultScale);
}

/** Integer division, rounded half away from zero. */
function divideRounded(numerator: bigint, denominator: bigint): bigint {
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Round a scaled integer to `resultScale`, half away from zero. */
export function roundUnits(units: bigint, scale: number, resultScale: number): Decimal {
  if (resultScale >= scale) return decimal((units * 10n ** BigInt(resultScale - scale)).toString(), resultScale);
  const drop = scale - resultScale;
  const factor = 10n ** BigInt(drop);
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  const quotient = magnitude / factor;
  const remainder = magnitude % factor;
  const rounded = remainder * 2n >= factor ? quotient + 1n : quotient;
  return decimal((negative ? -rounded : rounded).toString(), resultScale);
}

// ---------------------------------------------------------------------------
// Text, dates
// ---------------------------------------------------------------------------

/** NFC-normalise text. The canonical form of every string in the graph. */
export function normaliseText(text: string): string {
  return text.normalize('NFC');
}

/** A UTC date (no time). Canonical form `YYYY-MM-DD`. */
export function utcDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new CanonicalError('invalid Date');
    return value.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CanonicalError(`date must be YYYY-MM-DD: ${value}`);
  return value;
}

/** A UTC instant. Canonical form `YYYY-MM-DDTHH:MM:SSZ` (seconds precision, always Z). */
export function utcInstant(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new CanonicalError(`invalid instant: ${String(value)}`);
  return `${d.toISOString().slice(0, 19)}Z`;
}

// ---------------------------------------------------------------------------
// Canonical serialisation
// ---------------------------------------------------------------------------

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | Decimal
  | Date
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

function isDecimal(v: unknown): v is Decimal {
  return typeof v === 'object' && v !== null && 'scale' in v && 'units' in v
    && Number.isInteger((v as Decimal).scale) && typeof (v as Decimal).units === 'string';
}

/**
 * The canonical text of a value. Object keys are sorted by code unit, arrays keep their order,
 * and there is no insignificant whitespace. A non-integer number is refused: decimals must go
 * through `Decimal` so the scale is explicit.
 */
export function canonicalise(value: CanonicalValue): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new CanonicalError(`non-integer number ${value}: use a Decimal so the scale is explicit`);
    }
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(normaliseText(value));
  if (value instanceof Date) return `{"${UTC_TAG}":${JSON.stringify(utcInstant(value))}}`;
  if (isDecimal(value)) return `{"${DECIMAL_TAG}":${JSON.stringify(decimalToString(value))}}`;
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(',')}]`;
  const keys = Object.keys(value).sort();
  const parts = keys.map((k) => `${JSON.stringify(normaliseText(k))}:${canonicalise(value[k])}`);
  return `{${parts.join(',')}}`;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

export class HashUnavailableError extends Error {
  readonly code = 'HASH_UNAVAILABLE';
  constructor() {
    super('A secure hash is not available in this environment.');
    this.name = 'HashUnavailableError';
  }
}

export function isSecureHashAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle && typeof crypto.subtle.digest === 'function';
}

/** SHA-256 (hex) of a text. Fails closed when WebCrypto is absent. */
export async function sha256Hex(text: string): Promise<string> {
  if (!isSecureHashAvailable()) throw new HashUnavailableError();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 (hex) of the canonical form of a value. */
export async function hashCanonical(value: CanonicalValue): Promise<string> {
  return sha256Hex(canonicalise(value));
}

/** The zero hash used as the previous hash of the first link in a chain. */
export const ZERO_HASH = '0'.repeat(64);

/** Join parts with a separator and hash. The separator is not legal in a hex hash or a version id. */
export async function hashParts(parts: string[]): Promise<string> {
  return sha256Hex(parts.join('|'));
}
