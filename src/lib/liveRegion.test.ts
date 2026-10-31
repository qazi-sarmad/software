import { describe, expect, it } from 'vitest';
import { classifyAnnouncement } from './liveRegion';

/** WP12: the live-region classifier, pure and total. */
describe('classifyAnnouncement (WP12)', () => {
  it('returns null for an empty or whitespace-only message', () => {
    expect(classifyAnnouncement('', true)).toBeNull();
    expect(classifyAnnouncement('   ', false)).toBeNull();
  });

  it('is polite on success and assertive on failure', () => {
    expect(classifyAnnouncement('Report sealed.', true)).toEqual({ message: 'Report sealed.', politeness: 'polite' });
    expect(classifyAnnouncement('Refused.', false)).toEqual({ message: 'Refused.', politeness: 'assertive' });
  });

  it('trims the message', () => {
    expect(classifyAnnouncement('  Saved.  ', true)?.message).toBe('Saved.');
  });
});
