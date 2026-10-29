import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { User } from '../../types';
import {
  EXPLAIN_DENIED_REASON,
  EXPLAIN_ENTRIES,
  entriesForStandard,
  entriesRequiringRight,
  explainEntry,
  explainEntryIds,
  explainFor,
} from './catalogue';
import { IIA_STANDARDS, implementedStandards, unimplementedStandards } from './iia';

const admin: User = {
  id: 'u-admin',
  name: 'Admin',
  email: 'admin@example.test',
  avatar: '',
  role: 'cia',
  universeIds: ['*'],
  entityIds: ['*'],
};

/** A read-only observer: holds read_only and view_all_scopes, no working rights. */
const observer: User = {
  id: 'u-obs',
  name: 'Observer',
  email: 'obs@example.test',
  avatar: '',
  role: 'observer',
  universeIds: ['*'],
  entityIds: ['*'],
};

/** A preparer: performs work, holds no view_all_scopes. */
const preparer: User = {
  id: 'u-prep',
  name: 'Preparer',
  email: 'prep@example.test',
  avatar: '',
  role: 'preparer',
  universeIds: [],
  entityIds: [],
};

describe('explain catalogue (E1)', () => {
  it('has no duplicate ids', () => {
    const ids = explainEntryIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry is complete: title, summary and effect are non-empty', () => {
    const bad = EXPLAIN_ENTRIES.filter(
      (e) => !e.id || !e.title.trim() || !e.summary.trim() || !e.effect.trim()
    ).map((e) => e.id);
    expect(bad).toEqual([]);
  });

  it('every entry id is namespaced with its kind prefix', () => {
    const bad = EXPLAIN_ENTRIES.filter((e) => !e.id.startsWith(`${e.kind}.`)).map((e) => e.id);
    expect(bad).toEqual([]);
  });

  it('summary and effect are different sentences (effect states a consequence)', () => {
    const bad = EXPLAIN_ENTRIES.filter((e) => e.summary.trim() === e.effect.trim()).map((e) => e.id);
    expect(bad).toEqual([]);
  });

  it('every related id resolves to a real entry', () => {
    const known = new Set(explainEntryIds());
    const bad = EXPLAIN_ENTRIES.flatMap((e) =>
      (e.related ?? []).filter((r) => !known.has(r)).map((r) => `${e.id} -> ${r}`)
    );
    expect(bad).toEqual([]);
  });

  it('every standard an entry cites exists in the standard catalogue', () => {
    const known = new Set(EXPLAIN_ENTRIES.filter((e) => e.kind === 'standard').map((e) => e.id));
    const bad = EXPLAIN_ENTRIES.flatMap((e) =>
      (e.iiaStandards ?? [])
        .filter((n) => !known.has(`standard.${n}`))
        .map((n) => `${e.id} -> ${n}`)
    );
    expect(bad).toEqual([]);
  });
});

describe('explainFor is pure and total (E1)', () => {
  it('never returns nothing — an unknown id returns a benign placeholder', () => {
    const view = explainFor(admin, 'no.such.entry');
    expect(view).toBeTruthy();
    expect(view.id).toBe('no.such.entry');
    expect(view.status).toBe('ready');
    expect(view.title).toMatch(/not documented/i);
  });

  it('returns a full view for a documented id', () => {
    const view = explainFor(admin, 'method.mus');
    expect(view.status).toBe('ready');
    expect(view.title).toMatch(/Monetary unit sampling/);
    expect(view.effect.length).toBeGreaterThan(0);
    expect(view.iiaStandards).toContain('14.1');
  });

  it('is deterministic: the same inputs give the same output', () => {
    const a = explainFor(admin, 'term.coverage', { values: [{ label: 'x', value: '1' }] });
    const b = explainFor(admin, 'term.coverage', { values: [{ label: 'x', value: '1' }] });
    expect(a).toEqual(b);
  });

  it('does not read the clock: a result is independent of context.now', () => {
    const a = explainFor(admin, 'term.coverage', { now: '2020-01-01T00:00:00Z' });
    const b = explainFor(admin, 'term.coverage', { now: '2030-01-01T00:00:00Z' });
    expect(a).toEqual(b);
  });
});

describe('redaction — the L2 guard (E1)', () => {
  it('redacts an entry whose minRight the caller lacks', () => {
    // status.alert.ledger_chain requires view_all_scopes; a preparer does not hold it.
    const view = explainFor(preparer, 'status.alert.ledger_chain');
    expect(view.status).toBe('denied');
    expect(view.deniedReason).toBe(EXPLAIN_DENIED_REASON);
    expect(view.effect).toBe('');
    expect(view.detail).toEqual([]);
  });

  it('shows the same entry to a caller who holds the right', () => {
    const view = explainFor(observer, 'status.alert.ledger_chain');
    expect(view.status).toBe('ready');
    expect(view.effect.length).toBeGreaterThan(0);
  });

  it('drops a contextual value whose own right the caller lacks', () => {
    const view = explainFor(preparer, 'term.coverage', {
      values: [
        { label: 'Public', value: 'visible' },
        { label: 'Restricted', value: 'secret', minRight: 'view_all_scopes' },
      ],
    });
    expect(view.values.map((v) => v.label)).toEqual(['Public']);
  });

  it('keeps a contextual value whose right the caller holds', () => {
    const view = explainFor(observer, 'term.coverage', {
      values: [{ label: 'Restricted', value: 'secret', minRight: 'view_all_scopes' }],
    });
    expect(view.values.map((v) => v.label)).toEqual(['Restricted']);
  });

  it('a denied entry exposes no contextual values at all', () => {
    const view = explainFor(preparer, 'status.alert.ledger_chain', {
      values: [{ label: 'Anything', value: 'x' }],
    });
    expect(view.values).toEqual([]);
  });

  it('a null user is treated as holding no rights', () => {
    const view = explainFor(null, 'status.engagement.signed_off');
    expect(view.status).toBe('denied');
  });

  it('redacts EVERY restricted entry for a caller lacking its right, and shows it to one who holds it', () => {
    // The exhaustive form of the guard: every entry that declares a minRight must be redacted for a
    // caller without it. A restricted entry that leaked its detail to an unauthorised caller is the
    // L2 breach this test exists to catch, and it is checked for the whole catalogue, not one sample.
    const restricted = EXPLAIN_ENTRIES.filter((e) => !!e.minRight);
    expect(restricted.length, 'no restricted entries — the guard would be vacuous').toBeGreaterThan(0);
    for (const entry of restricted) {
      const right = entry.minRight!;
      const holder: User = { ...observer, role: 'cia', rights: { [right]: true } as User['rights'] };
      const denied = explainFor(preparer, entry.id);
      expect(denied.status, `${entry.id} was not redacted for a caller lacking ${right}`).toBe('denied');
      expect(denied.effect, `${entry.id} leaked its effect`).toBe('');
      expect(denied.detail, `${entry.id} leaked its detail`).toEqual([]);
      expect(denied.values, `${entry.id} leaked contextual values`).toEqual([]);
      const allowed = explainFor(holder, entry.id);
      expect(allowed.status, `${entry.id} was redacted for a caller holding ${right}`).toBe('ready');
    }
    // And the helper used above resolves the same set the guard iterates.
    for (const right of new Set(restricted.map((e) => e.minRight!))) {
      expect(entriesRequiringRight(right).length).toBeGreaterThan(0);
    }
  });
});

describe('the catalogue carries no tenant content (Law L2)', () => {
  // A defensive scan: the catalogue is static documentation and must never embed a uuid, a tenant
  // id or an email — any of which would be tenant content in a module every user can read.
  const dir = resolve(process.cwd(), 'src/lib/explain');
  const files = readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));

  it('names no uuid, tenant id or email', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = readFileSync(resolve(dir, f), 'utf8');
      if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text)) {
        offenders.push(`${f}: uuid`);
      }
      if (/provio-corp-tenant/.test(text)) offenders.push(`${f}: tenant id`);
      if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text.replace(/@example\.test/g, ''))) {
        offenders.push(`${f}: email`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('standards mapping (E3)', () => {
  it('an implemented standard names at least one real screen and one real RPC or table', () => {
    const bad = implementedStandards()
      .filter((s) => s.implementedBy.length === 0 || s.rpcs.length === 0)
      .map((s) => s.id);
    expect(bad).toEqual([]);
  });

  it('a standard the product does not implement is marked honestly and names no surface', () => {
    const bad = unimplementedStandards().filter(
      (s) => s.implementedBy.length > 0 || s.rpcs.length > 0 || s.implementation !== null
    );
    expect(bad.map((s) => s.id)).toEqual([]);
    // The honesty must reach the catalogue entry the UI renders.
    for (const s of unimplementedStandards()) {
      const entry = explainEntry(`standard.${s.id}`);
      expect(entry?.effect, `${s.id} must say it is not implemented`).toMatch(/not yet implemented/i);
    }
  });

  it('every standard screen id is a real documented screen id', () => {
    const documented = new Set<string>();
    const inv = readFileSync(resolve(process.cwd(), 'docs/UI-INVENTORY.md'), 'utf8');
    for (const m of inv.matchAll(/^### (.+)$/gm)) {
      for (const id of m[1].match(/[A-Z]{2,3}-\d{2}/g) ?? []) documented.add(id);
    }
    const bad = IIA_STANDARDS.flatMap((s) =>
      s.implementedBy.filter((id) => !documented.has(id)).map((id) => `${s.id} -> ${id}`)
    );
    expect(bad).toEqual([]);
  });

  it('every explain id a standard cites resolves to a catalogue entry', () => {
    const known = new Set(explainEntryIds());
    const bad = IIA_STANDARDS.flatMap((s) =>
      s.explainIds.filter((id) => !known.has(id)).map((id) => `${s.id} -> ${id}`)
    );
    expect(bad).toEqual([]);
  });

  it('covers the required engagement-lifecycle standards (Domain V)', () => {
    const required = [
      '13.1', '13.2', '13.3', '13.4', '13.5', '13.6',
      '14.1', '14.2', '14.3', '14.4', '14.5', '14.6',
      '15.1', '15.2',
    ];
    const missing = required.filter((n) => !IIA_STANDARDS.some((s) => s.id === n));
    expect(missing).toEqual([]);
  });

  it('entriesForStandard returns every entry citing a number', () => {
    const withCoverage = entriesForStandard('14.6');
    expect(withCoverage.length).toBeGreaterThan(1);
    expect(withCoverage.every((e) => (e.iiaStandards ?? []).includes('14.6'))).toBe(true);
  });

  it('the standards are paraphrased, never pasted: no entry contains IIA body wording', () => {
    // A crude but useful honesty check: the reference file records structure only, so no catalogue
    // sentence should match a long run of words from the reference's prose.
    const ref = readFileSync(resolve(process.cwd(), 'docs/iia-standards-reference.md'), 'utf8');
    const refWords = new Set(ref.toLowerCase().match(/[a-z]{6,}/g) ?? []);
    const suspicious = EXPLAIN_ENTRIES.filter((e) => e.kind === 'standard').filter((e) => {
      const words = (e.summary + ' ' + e.effect).toLowerCase().match(/[a-z]{6,}/g) ?? [];
      // A paraphrase shares topic words but not a long consecutive run; this only flags near-pastes.
      return words.length > 0 && words.every((w) => refWords.has(w));
    }).map((e) => e.id);
    expect(suspicious).toEqual([]);
  });
});

describe('explainEntry lookup', () => {
  it('returns the entry for a known id and undefined otherwise', () => {
    expect(explainEntry('method.random')?.kind).toBe('method');
    expect(explainEntry('nope')).toBeUndefined();
  });
});
