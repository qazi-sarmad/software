import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RECORD_VIEW_MODE,
  RECORD_VIEW_MODE,
  getPreference,
  getRecordViewMode,
  isRecordViewMode,
  setPreference,
  setRecordViewMode,
} from './preferences';

/**
 * With no Supabase environment variables the preferences module is inert: reads return null (so
 * the record-view mode falls back to the default) and writes report not configured. No request
 * leaves the process.
 */
describe('preferences data module (not configured)', () => {
  it('reads return null and the default mode', async () => {
    expect(await getPreference(RECORD_VIEW_MODE)).toBeNull();
    expect(await getRecordViewMode()).toBe(DEFAULT_RECORD_VIEW_MODE);
  });

  it('writes report not configured', async () => {
    expect(await setPreference('k', 'v')).toEqual({ ok: false, reason: 'The data module is not configured.' });
    expect(await setRecordViewMode('floating_window')).toEqual({
      ok: false,
      reason: 'The data module is not configured.',
    });
  });
});

describe('record view mode guard', () => {
  it('accepts only the two modes', () => {
    expect(isRecordViewMode('full_page')).toBe(true);
    expect(isRecordViewMode('floating_window')).toBe(true);
    expect(isRecordViewMode('windowed')).toBe(false);
    expect(isRecordViewMode(null)).toBe(false);
    expect(isRecordViewMode(undefined)).toBe(false);
  });

  it('defaults to full_page (§27.5)', () => {
    expect(DEFAULT_RECORD_VIEW_MODE).toBe('full_page');
  });
});
