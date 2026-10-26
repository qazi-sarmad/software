/**
 * W2.4: realisation rules. Pure functions that turn a typed slot value into the words a locale and
 * a register require: number and money formatting, plural and agreement, ordinals, list joining,
 * date forms, capitalisation and sentence assembly.
 *
 * Nothing here composes a claim. It formats a value that is already a fact. Rounding mode is
 * declared by the template, never chosen here.
 */

import { Decimal, decimalToString } from './canonical';
import { joinWithAnd, localePack } from './locale';
import type { Locale, Slot, SlotKind } from './types';

/** The declared rounding mode of a figure or a slot. The template states it; this module applies it. */
export type RoundingMode = 'half_up' | 'half_even' | 'down' | 'up';

/** Insert the grouping separator every three digits, from the left of the integer part. */
export function groupDigits(integer: string, separator: string): string {
  const negative = integer.startsWith('-');
  const digits = negative ? integer.slice(1) : integer;
  const parts: string[] = [];
  for (let i = digits.length; i > 0; i -= 3) parts.unshift(digits.slice(Math.max(0, i - 3), i));
  return (negative ? '-' : '') + parts.join(separator);
}

export interface NumberFormat {
  locale: Locale;
  /** How many fractional digits to show. */
  scale: number;
  /** Whether to insert grouping separators. */
  grouping: boolean;
  /** The declared rounding mode. */
  rounding: RoundingMode;
}

/** Format a decimal as a locale number, at the declared scale, with the declared rounding. */
export function formatNumber(value: Decimal, format: NumberFormat): string {
  const rounded = applyRounding(value, format.scale, format.rounding);
  const text = decimalToString(rounded);
  const negative = text.startsWith('-');
  const [whole, frac = ''] = (negative ? text.slice(1) : text).split('.');
  const wholeText = format.grouping ? groupDigits(whole, localePack(format.locale).grouping) : whole;
  const decimalSep = localePack(format.locale).decimal;
  return `${negative ? '-' : ''}${wholeText}${format.scale > 0 ? decimalSep + frac : ''}`;
}

/** Apply a rounding mode, returning a decimal at `scale`. */
export function applyRounding(value: Decimal, scale: number, mode: RoundingMode): Decimal {
  if (value.scale <= scale) {
    // Pad up so the printed form always has the declared scale.
    return { scale, units: value.units + '0'.repeat(scale - value.scale) };
  }
  const drop = value.scale - scale;
  const negative = value.units.startsWith('-');
  const digits = negative ? value.units.slice(1) : value.units;
  const kept = digits.slice(0, digits.length - drop);
  const dropped = digits.slice(digits.length - drop);
  const remainder = BigInt(dropped);
  const factor = 10n ** BigInt(drop);
  let units = BigInt(kept || '0');
  const half = factor / 2n;
  switch (mode) {
    case 'down':
      break;
    case 'up':
      if (remainder > 0n) units += 1n;
      break;
    case 'half_even': {
      if (remainder > half) units += 1n;
      else if (remainder === half && units % 2n === 1n) units += 1n;
      break;
    }
    case 'half_up':
    default:
      if (remainder * 2n >= factor) units += 1n;
      break;
  }
  return { scale, units: (negative && units !== 0n ? '-' : '') + units.toString() };
}

/** Format money: the symbol placed by the locale, the amount grouped at the declared scale. */
export function formatMoney(
  value: Decimal, symbol: string, format: NumberFormat,
): string {
  return localePack(format.locale).currency(symbol, formatNumber(value, format));
}

/** Format a percentage. The value is the percentage itself (12.5 renders as "12.5%"). */
export function formatPercent(value: Decimal, format: NumberFormat): string {
  return `${formatNumber(value, format)}%`;
}

/** English plural rules for a count: singular for exactly 1 (and -1), plural otherwise. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  const word = Math.abs(count) === 1 ? singular : (pluralForm ?? `${singular}s`);
  return word;
}

/** "3 controls", "1 control". Agreement for a count slot. */
export function countPhrase(count: number, singular: string, pluralForm?: string): string {
  const format: NumberFormat = { locale: 'en-GB', scale: 0, grouping: count >= 10000, rounding: 'half_up' };
  return `${formatNumber({ scale: 0, units: String(count) }, format)} ${plural(count, singular, pluralForm)}`;
}

/** The ordinal word for 1..12; a numeral with a suffix beyond that. */
export function ordinal(n: number): string {
  const words = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh',
    'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
  if (n >= 0 && n < words.length) return words[n];
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th'
    : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** A count as an ordinal phrase: "the 3rd control" is avoided; "the third control" is used. */
export function ordinalPhrase(n: number, singular: string, pluralForm?: string): string {
  const format: NumberFormat = { locale: 'en-GB', scale: 0, grouping: false, rounding: 'half_up' };
  const value = formatNumber({ scale: 0, units: String(n) }, format);
  return `the ${value} ${plural(n, singular, pluralForm)}`;
}

/** Join a list by the locale convention (the Oxford comma follows the template's locale). */
export function formatList(items: string[], locale: Locale): string {
  return localePack(locale).joinList(items);
}

/** Format a date in the long locale form: "25 October 2026" or "October 25, 2026". */
export function formatDate(iso: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  const d = { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };
  return localePack(locale).longDate(d);
}

/** Format a date in the short locale form. */
export function formatShortDate(iso: string, locale: Locale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`not an ISO date: ${iso}`);
  const d = { day: Number(m[3]), month: Number(m[2]), year: Number(m[1]) };
  return localePack(locale).shortDate(d);
}

/** Capitalise the first character. Used to start an assembled sentence. */
export function capitalise(text: string): string {
  if (text.length === 0) return text;
  return text[0].toUpperCase() + text.slice(1);
}

/** Join fragments into one sentence: capitalise the first, end with a full stop. */
export function assembleSentence(fragments: string[]): string {
  const body = fragments.map((f) => f.trim()).filter(Boolean).join(' ');
  if (!body) return '';
  const capitalised = capitalise(body);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

export interface SlotFormatContext {
  locale: Locale;
  /** The scale for number, money, percent and count slots. */
  scale: number;
  rounding: RoundingMode;
  grouping: boolean;
  currencySymbol: string;
}

/** Render one slot value to its words. A null or empty slot renders as the caller's fallback. */
export function realiseSlot(slot: Slot, ctx: SlotFormatContext): string {
  const value = slot.value;
  if (value === null || value === undefined) return '';
  const format: NumberFormat = {
    locale: ctx.locale, scale: ctx.scale, grouping: ctx.grouping, rounding: ctx.rounding,
  };
  switch (slot.kind) {
    case 'number':
      return formatNumber(asDecimal(value), format);
    case 'count':
      // A count is a whole number: it never shows fractional digits, whatever the section's scale.
      return formatNumber(asDecimal(value), { ...format, scale: 0 });
    case 'money':
      return formatMoney(asDecimal(value), ctx.currencySymbol, format);
    case 'percent':
      return formatPercent(asDecimal(value), format);
    case 'date':
      return formatDate(String(value), ctx.locale);
    case 'list':
      return formatList(Array.isArray(value) ? value.map(String) : [String(value)], ctx.locale);
    case 'ref':
      return String(value);
    case 'text':
    default:
      return String(value);
  }
}

/** Accept a Decimal, an integer, or a fixed-scale decimal string. */
export function asDecimal(value: unknown): Decimal {
  if (value && typeof value === 'object' && 'scale' in value && 'units' in value) return value as Decimal;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error(`a non-integer number cannot be a slot value: ${value}`);
    return { scale: 0, units: String(value) };
  }
  const text = String(value);
  const m = /^(-?\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) throw new Error(`not a decimal: ${text}`);
  const frac = m[2] ?? '';
  return { scale: frac.length, units: `${m[1]}${frac}`.replace(/^\+/, '') };
}

/** The slot kinds that carry a numeric, date or amount value (the slot-discipline rule, W2.5). */
export const NUMERIC_SLOT_KINDS: SlotKind[] = ['number', 'money', 'date', 'percent', 'count'];

/** A slot reference in a template: `{name}`. */
const SLOT_TOKEN = /\{([a-z][a-z0-9_]*)\}/g;

/**
 * Render a phrase template: replace each `{name}` with the realised slot value. A slot the
 * template names but the claim does not carry throws, so a missing fact is loud, never silent.
 */
export function renderTemplate(template: string, slots: Slot[], ctx: SlotFormatContext): string {
  const byName = new Map(slots.map((s) => [s.name, s]));
  return template.replace(SLOT_TOKEN, (_match, name: string) => {
    const slot = byName.get(name);
    if (!slot) throw new Error(`Missing: [${name}]`);
    const text = realiseSlot(slot, ctx);
    return text;
  });
}

/** The slot names a template names. Used by the completeness checks. */
export function templateSlotNames(template: string): string[] {
  return [...template.matchAll(SLOT_TOKEN)].map((m) => m[1]);
}

