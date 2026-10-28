import { describe, expect, it } from 'vitest';
import {
  ACTION_COMMANDS,
  SCREEN_COMMANDS,
  explainCommands,
  flattenGroups,
  rankCommands,
  recordCommands,
  staticCommands,
  visibleCommands,
} from './commandPalette';
import type { User } from '../types';
import type { Role } from '../types';
import { EXPLAIN_ENTRIES } from './explain/catalogue';

const user = (role: Role): User => ({
  id: `u-${role}`,
  name: role,
  email: `${role}@example.test`,
  avatar: '',
  role,
  universeIds: ['*'],
  entityIds: ['*'],
});

describe('command palette index and ranking (U2)', () => {
  it('offers exactly the seven primary screens, in spec order', () => {
    expect(SCREEN_COMMANDS.map((c) => c.target.tab)).toEqual([
      'executive',
      'pending',
      'universe',
      'plan',
      'sira',
      'audit_file',
      'issues',
    ]);
  });

  it('reaches the analyst engine from the word "benford"', () => {
    const ranked = rankCommands('benford', staticCommands());
    expect(ranked[0]?.target.tab).toBe('audit_file');
  });

  it('ranks an exact label match first and is a total order', () => {
    const ranked = rankCommands('work queue', staticCommands());
    expect(ranked[0]?.label).toBe('Work Queue');
    // Deterministic: two runs over the same query give the same order.
    expect(rankCommands('work queue', staticCommands()).map((c) => c.id)).toEqual(ranked.map((c) => c.id));
  });

  it('returns nothing for a query no command matches', () => {
    expect(rankCommands('zzzzz-no-such-command', staticCommands())).toEqual([]);
  });

  it('the explain layer is searchable by id, kind and title', () => {
    const commands = explainCommands();
    expect(commands.length).toBe(EXPLAIN_ENTRIES.length);
    const byId = rankCommands('term.coverage', commands).map((c) => c.target.explainId);
    expect(byId).toContain('term.coverage');
  });

  it('a caller without a right does not see the action that needs it', () => {
    const preparer = visibleCommands(user('preparer'));
    const ids = preparer.map((c) => c.id);
    expect(ids).not.toContain('action.people_admin');
    expect(ids).not.toContain('action.org_settings');
    expect(ids).toContain('action.shared_with_me');
    // An org_admin holds manage_users, so the people action appears for them.
    expect(visibleCommands(user('org_admin')).map((c) => c.id)).toContain('action.people_admin');
  });

  it('every static command names exactly one target', () => {
    for (const c of staticCommands()) {
      const set = [c.target.tab, c.target.inspector, c.target.explainId, c.target.record].filter(Boolean);
      expect(set.length, `${c.id} must set exactly one target`).toBe(1);
    }
  });

  it('flattenGroups walks screens, then actions, then explain in order', () => {
    const flat = flattenGroups([SCREEN_COMMANDS.slice(0, 1), ACTION_COMMANDS.slice(0, 1), explainCommands().slice(0, 1)]);
    expect(flat.map((c) => c.kind)).toEqual(['screen', 'action', 'explain']);
  });

  it('recordCommands tags rows as action kind with the family in the keywords', () => {
    const cmds = recordCommands([{ id: 'e1', family: 'entity', title: 'Treasury', subtitle: 'TR-1 · Finance' }]);
    expect(cmds[0].kind).toBe('action');
    expect(cmds[0].id).toBe('record.entity.e1');
    expect(cmds[0].keywords).toContain('entity');
  });
});
