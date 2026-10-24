/**
 * Helpers for showing a record's fields as readable text, so no component needs JSON.stringify.
 * Rule F1 (spec §23): no screen shows a JSON blob; a configuration surface renders its fields.
 */

/** Render a flat record as "key: value, key: value". Nested values are shown as their type. */
export function formatFieldPairs(record: Record<string, unknown> | null | undefined): string {
  if (!record) return '';
  return Object.entries(record)
    .map(([k, v]) => `${k}: ${formatFieldValue(v)}`)
    .join(', ');
}

function formatFieldValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(formatFieldValue).join(', ');
  return '…';
}

/**
 * A deterministic, stable string key for a value, used to memoise work without JSON.stringify.
 * Objects are walked with sorted keys so the same value always yields the same key.
 */
export function stableKey(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  if (typeof value === 'string') return `s:${value}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `n:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(stableKey).join(',')}]`;
  if (typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    return `{${Object.keys(rec)
      .sort()
      .map((k) => `${k}=${stableKey(rec[k])}`)
      .join(',')}}`;
  }
  return String(value);
}
