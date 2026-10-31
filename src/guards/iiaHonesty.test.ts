import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IIA_STANDARDS, implementedStandards, unimplementedStandards } from '../lib/explain/iia';
import { explainEntry } from '../lib/explain/catalogue';

/**
 * G9 — IIA honesty (docs/EXPLAIN-LAYER.md §7).
 *
 * Rule: every standard entry points at a screen or an RPC that exists, or is explicitly marked `not
 * yet implemented`; and no standard's text is reproduced. Standards shown as covered when they are
 * not is the defect this gate exists to catch, and the IIA holds copyright, so a near-paste is a
 * legal exposure as well as a honesty one.
 *
 * The verified numbering lives in docs/iia-standards-reference.md. Every number here must appear
 * there, so a guessed number cannot enter the catalogue.
 */
const ROOT = resolve(process.cwd());

const reference = readFileSync(resolve(ROOT, 'docs/iia-standards-reference.md'), 'utf8');
const contract = readFileSync(resolve(ROOT, 'docs/ACP-UI-CONTRACT.md'), 'utf8');
const inventory = readFileSync(resolve(ROOT, 'docs/UI-INVENTORY.md'), 'utf8');

/** Verified numbers, from the reference file's `- N.N Title` rows. */
function verifiedNumbers(): Set<string> {
  const out = new Set<string>();
  for (const m of reference.matchAll(/^- (\d+\.\d+) /gm)) out.add(m[1]);
  return out;
}

/** Screen ids documented anywhere the designer reads. */
function documentedScreens(): Set<string> {
  const out = new Set<string>();
  for (const text of [contract, inventory]) {
    for (const m of text.matchAll(/\b([A-Z]{2,3}-\d{2})\b/g)) out.add(m[1]);
  }
  return out;
}

describe('G9 — IIA honesty', () => {
  it('every standard number is one of the verified reference numbers', () => {
    const verified = verifiedNumbers();
    const guessed = IIA_STANDARDS.filter((s) => !verified.has(s.id)).map((s) => s.id);
    expect(guessed, `numbers not in docs/iia-standards-reference.md: ${guessed.join(', ')}`).toEqual([]);
  });

  it('the reference file actually carries the numbers (guards the parser itself)', () => {
    expect(verifiedNumbers().size).toBeGreaterThan(40);
  });

  it('an implemented standard names a real documented screen and a real RPC', () => {
    const screens = documentedScreens();
    const bad: string[] = [];
    for (const s of implementedStandards()) {
      if (s.rpcs.length === 0) bad.push(`${s.id}: no RPC`);
      for (const id of s.implementedBy) {
        if (!screens.has(id)) bad.push(`${s.id}: unknown screen ${id}`);
      }
      if (s.evidence.length === 0) bad.push(`${s.id}: no evidence artifact`);
    }
    expect(bad).toEqual([]);
  });

  it('a standard the product does not implement names no surface and says so in the UI', () => {
    const bad = unimplementedStandards().filter(
      (s) => s.implementedBy.length > 0 || s.rpcs.length > 0 || s.evidence.length > 0 || s.implementation !== null
    );
    expect(bad.map((s) => s.id)).toEqual([]);
    // The honesty must reach the entry the UI renders.
    for (const s of unimplementedStandards()) {
      const entry = explainEntry(`standard.${s.id}`);
      expect(entry, `${s.id} has no catalogue entry`).toBeTruthy();
      expect(entry!.effect, `${s.id} must say it is not implemented`).toMatch(/not yet implemented/i);
    }
  });

  it('no standard reproduces the IIA wording: a paraphrase is not a long shared run', () => {
    // The reference records structure and titles only, so a paraphrase may share topic words but not
    // a long consecutive run. A six-word run shared with any reference prose is a near-paste.
    const refWords = (reference.toLowerCase().match(/[a-z]{4,}/g) ?? []);
    const refRuns = new Set<string>();
    for (let i = 0; i + 6 <= refWords.length; i++) refRuns.add(refWords.slice(i, i + 6).join(' '));
    const offenders: string[] = [];
    for (const s of IIA_STANDARDS) {
      const words = (s.paraphrase.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      for (let i = 0; i + 6 <= words.length; i++) {
        if (refRuns.has(words.slice(i, i + 6).join(' '))) offenders.push(s.id);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('the catalogue records the verified numbers it claims to (weighted to Domains IV and V)', () => {
    const required = [
      '13.1', '13.2', '13.3', '13.4', '13.5', '13.6',
      '14.1', '14.2', '14.3', '14.4', '14.5', '14.6',
      '15.1', '15.2',
    ];
    const missing = required.filter((n) => !IIA_STANDARDS.some((s) => s.id === n));
    expect(missing, `missing lifecycle standards: ${missing.join(', ')}`).toEqual([]);
  });

  it('each standard declares a valid domain and a one-sentence paraphrase', () => {
    const bad = IIA_STANDARDS.filter(
      (s) => !['I', 'II', 'III', 'IV', 'V'].includes(s.domain) || s.paraphrase.trim().length === 0
    ).map((s) => s.id);
    expect(bad).toEqual([]);
  });
});
