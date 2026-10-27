/**
 * Live-region helpers (WP12). Pure and total: they map a state change to the polite or assertive
 * announcement channel, so a screen reader user hears the same event a sighted user sees. No clock,
 * no model, no I/O.
 */

export type Announcement = {
  message: string;
  /** 'assertive' interrupts (errors, refusals); 'polite' waits for a pause (sealed, saved, sent). */
  politeness: 'polite' | 'assertive';
};

/**
 * Classify an event into an announcement. A refusal or an error is assertive; a success is polite.
 * An empty message is not an announcement at all, so callers can pass a possibly-empty value.
 */
export function classifyAnnouncement(message: string, ok: boolean): Announcement | null {
  const trimmed = message.trim();
  if (trimmed === '') return null;
  return { message: trimmed, politeness: ok ? 'polite' : 'assertive' };
}
