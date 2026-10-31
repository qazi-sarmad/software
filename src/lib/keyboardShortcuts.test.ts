import { describe, expect, it } from 'vitest';
import {
  SHORTCUTS,
  formatChord,
  formatSequence,
  groupedShortcuts,
  matchSequence,
  matchShortcut,
  shortcutsFor,
  type Shortcut,
} from './keyboardShortcuts';
import { testUser } from '../test/testUsers';
import type { User } from '../types';

const userWith = (...rights: string[]): User => ({
  ...testUser('org_admin'),
  rights: Object.fromEntries(rights.map((r) => [r, true])),
});

const byId = (id: string): Shortcut => {
  const s = SHORTCUTS.find((x) => x.id === id);
  if (!s) throw new Error(`no shortcut ${id}`);
  return s;
};

describe('keyboardShortcuts (U8)', () => {
  it('has a stable, unique id per shortcut and a chord on each', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SHORTCUTS) expect(s.chord.key.length).toBeGreaterThan(0);
  });

  describe('shortcutsFor (rights, never role names)', () => {
    it('hides navigation from a configuration-only principal', () => {
      const ids = shortcutsFor(userWith()).map((s) => s.id);
      expect(ids).not.toContain('go.dashboard');
      expect(ids).toContain('palette.open'); // the palette is available to any member
    });

    it('offers navigation to a principal holding an audit right', () => {
      const ids = shortcutsFor(userWith('read_only')).map((s) => s.id);
      expect(ids).toContain('go.dashboard');
      expect(ids).toContain('go.issues');
    });
  });

  describe('groupedShortcuts', () => {
    it('groups in a fixed order and drops empty groups', () => {
      const groups = groupedShortcuts(userWith('read_only')).map((g) => g.group);
      expect(groups).toEqual(['Navigate', 'Actions', 'Help']);
      const onlyHelp = groupedShortcuts(userWith()).map((g) => g.group);
      expect(onlyHelp).toEqual(['Actions', 'Help']);
    });
  });

  describe('formatChord / formatSequence', () => {
    it('reads Cmd on macOS and Ctrl elsewhere', () => {
      expect(formatChord({ mod: true, key: 'k' }, true)).toEqual(['⌘', 'K']);
      expect(formatChord({ mod: true, key: 'k' }, false)).toEqual(['Ctrl', 'K']);
    });

    it('renders a g-sequence as "G then D"', () => {
      expect(formatSequence(byId('go.dashboard'), false)).toEqual(['G', 'then', 'D']);
    });
  });

  describe('matchShortcut', () => {
    it('matches mod-k on macOS and Ctrl-K elsewhere', () => {
      expect(matchShortcut({ key: 'k', metaKey: true }, true)?.id).toBe('palette.open');
      expect(matchShortcut({ key: 'k', ctrlKey: true }, false)?.id).toBe('palette.open');
      // The wrong modifier for the platform does not fire.
      expect(matchShortcut({ key: 'k', ctrlKey: true }, true)).toBeNull();
    });

    it('matches the ? sheet', () => {
      expect(matchShortcut({ key: '?' }, false)?.id).toBe('help.shortcuts');
    });

    it('suppresses a bare-letter chord inside a text field, but not a mod chord', () => {
      expect(matchShortcut({ key: 'g', inEditable: true }, false)).toBeNull();
      expect(matchShortcut({ key: 'g', inEditable: false }, false)?.id).toBe('go.dashboard');
      expect(matchShortcut({ key: 'k', metaKey: true, inEditable: true }, true)?.id).toBe('palette.open');
    });

    it('is deterministic and case-insensitive on the key', () => {
      expect(matchShortcut({ key: 'K', metaKey: true }, true)?.id).toBe('palette.open');
    });
  });

  describe('matchSequence', () => {
    it('resolves the second key of a g-sequence', () => {
      const leader = matchShortcut({ key: 'g' }, false)!;
      expect(matchSequence(leader, 'd')?.target.tab).toBe('executive');
      expect(matchSequence(leader, 'w')?.target.tab).toBe('pending');
      expect(matchSequence(leader, 'i')?.target.tab).toBe('issues');
    });

    it('returns null for an unknown second key', () => {
      const leader = matchShortcut({ key: 'g' }, false)!;
      expect(matchSequence(leader, 'z')).toBeNull();
    });
  });
});
