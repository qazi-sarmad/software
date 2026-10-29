import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ACTION_LABELS,
  INCIDENT_ACTIONS,
  INCIDENT_BOUNDARY_NOTE,
  OUTCOME_LABELS,
  actionLabel,
  availableActions,
  incidentModel,
  incidentStatus,
  incidentsHeadline,
  outcomeLabel,
  statusLabel,
  type IncidentActionRow,
  type IntegrityIncidentRow,
} from './incidentWizard';

function action(over: Partial<IncidentActionRow> = {}): IncidentActionRow {
  return {
    id: 'a1',
    action: 'annotate',
    reason: 'a note',
    outcome: '',
    detail: {},
    actorId: 'u1',
    createdAt: '2026-10-20T00:00:00Z',
    ...over,
  };
}

function incident(over: Partial<IntegrityIncidentRow> = {}): IntegrityIncidentRow {
  return {
    id: 'i1',
    alertId: 'al1',
    kind: 'evidence_hash_mismatch',
    severity: 'warning',
    objectType: 'evidence_file',
    objectId: 'e1',
    engagementId: 'eng1',
    expectedHash: 'a'.repeat(64),
    actualHash: 'b'.repeat(64),
    detail: {},
    openedBy: 'u1',
    openedAt: '2026-10-20T00:00:00Z',
    actions: [action({ action: 'open', outcome: 'open' })],
    ...over,
  };
}

describe('the incident status is derived from its own trail (T6)', () => {
  it('an incident with only its open row is open', () => {
    expect(incidentStatus(incident())).toBe('open');
    expect(statusLabel('open')).toBe('Open');
  });

  it('a mitigation step moves it to mitigated, but never to resolved without a clean verification', () => {
    const mitigated = incident({
      actions: [
        action({ action: 'open', outcome: 'open' }),
        action({ action: 'restore', outcome: 'still_mismatched' }),
      ],
    });
    expect(incidentStatus(mitigated)).toBe('mitigated');
    expect(statusLabel('mitigated')).toBe('Mitigated');
  });

  it('a clean verification resolves it — the incident closes on proof, not on assertion', () => {
    const resolved = incident({
      actions: [
        action({ action: 'open', outcome: 'open' }),
        action({ action: 'restore', outcome: 'restored' }),
        action({ action: 'verify', outcome: 'verified' }),
      ],
    });
    expect(incidentStatus(resolved)).toBe('resolved');
    expect(statusLabel('resolved')).toBe('Resolved');
  });

  it('a verification that still fails does NOT resolve the incident', () => {
    const unresolved = incident({
      actions: [
        action({ action: 'open', outcome: 'open' }),
        action({ action: 'restore', outcome: 'still_mismatched' }),
        action({ action: 'verify', outcome: 'mismatch' }),
      ],
    });
    expect(incidentStatus(unresolved)).toBe('mitigated');
  });

  it('the status is a pure function of the trail: the same trail always gives the same status', () => {
    const rows = incident({
      actions: [action({ action: 'open', outcome: 'open' }), action({ action: 'freeze', outcome: 'frozen' })],
    });
    expect(incidentStatus(rows)).toBe(incidentStatus(rows));
  });
});

describe('the guided steps offered (T6)', () => {
  it('restore is offered only where a sealed copy could exist', () => {
    expect(availableActions(incident({ objectType: 'evidence_file' }))).toContain('restore');
    expect(availableActions(incident({ objectType: 'population_archive' }))).toContain('restore');
    expect(availableActions(incident({ objectType: 'archive_job' }))).toContain('restore');
    expect(availableActions(incident({ objectType: 'ledger' }))).not.toContain('restore');
    expect(availableActions(incident({ objectType: 'report_graph' }))).not.toContain('restore');
  });

  it('freeze is offered only when the incident affects an engagement', () => {
    expect(availableActions(incident({ engagementId: 'eng1' }))).toContain('freeze');
    expect(availableActions(incident({ engagementId: null, objectType: 'ledger' }))).not.toContain('freeze');
  });

  it('every action the database accepts has a plain label', () => {
    for (const a of INCIDENT_ACTIONS) {
      expect(ACTION_LABELS[a], `no label for ${a}`).toBeTruthy();
      expect(actionLabel(a)).toBe(ACTION_LABELS[a]);
    }
    expect(actionLabel('open')).toBeTruthy();
    expect(actionLabel('verify')).toBeTruthy();
  });

  it('every outcome has plain words, and none of them overclaims', () => {
    for (const [key, label] of Object.entries(OUTCOME_LABELS)) {
      expect(label.length, `empty outcome label for ${key}`).toBeGreaterThan(0);
    }
    // The honest outcomes are the point: a mismatch is never described as a success.
    expect(outcomeLabel('still_mismatched')).toContain('still');
    expect(outcomeLabel('no_sealed_copy')).toContain('nothing');
    expect(outcomeLabel('broken')).toContain('still');
    expect(outcomeLabel('diverges')).toContain('diverge');
  });
});

describe('the incident model (T6)', () => {
  it('describes what changed, what it affects, and how long ago', () => {
    const m = incidentModel({
      incident: incident(),
      todayIso: '2026-10-28',
      engagementTitle: 'A-Eng1',
    });
    expect(m.kindLabel).toBe('Stored evidence no longer matches the hash recorded for it');
    expect(m.affects).toContain('A-Eng1');
    expect(m.ageDays).toBe(8);
    expect(m.ageLabel).toBe('8 days ago');
    expect(m.status).toBe('open');
  });

  it('a ledger incident affects the chain, not an engagement', () => {
    const m = incidentModel({
      incident: incident({ objectType: 'ledger', objectId: null, engagementId: null }),
      todayIso: '2026-10-28',
    });
    expect(m.affects).toContain('ledger chain');
    expect(m.availableActions).not.toContain('freeze');
  });

  it('resolves the opener name when the host could, else the id', () => {
    const named = incidentModel({ incident: incident(), todayIso: '2026-10-28', openedByName: 'Ayesha' });
    expect(named.openedByLabel).toBe('Ayesha');
    const unnamed = incidentModel({ incident: incident(), todayIso: '2026-10-28' });
    expect(unnamed.openedByLabel).toBe('u1');
  });

  it('reports the last verification and whether it was clean', () => {
    const m = incidentModel({
      incident: incident({
        actions: [
          action({ action: 'open', outcome: 'open' }),
          action({ action: 'verify', outcome: 'verified' }),
        ],
      }),
      todayIso: '2026-10-28',
    });
    expect(m.lastVerification).toBe('verified');
    expect(m.verifiedClean).toBe(true);
  });

  it('an age of zero reads as "today", not "0 days ago"', () => {
    const m = incidentModel({ incident: incident({ openedAt: '2026-10-28T09:00:00Z' }), todayIso: '2026-10-28' });
    expect(m.ageLabel).toBe('today');
  });
});

describe('the headline (T6)', () => {
  it('says so plainly when there are none', () => {
    expect(incidentsHeadline([])).toBe('No integrity incidents.');
  });

  it('counts by derived status', () => {
    const open = incident();
    const mitigated = incident({
      id: 'i2',
      actions: [action({ action: 'open', outcome: 'open' }), action({ action: 'freeze', outcome: 'frozen' })],
    });
    const resolved = incident({
      id: 'i3',
      actions: [action({ action: 'open', outcome: 'open' }), action({ action: 'verify', outcome: 'verified' })],
    });
    const text = incidentsHeadline([open, mitigated, resolved]);
    expect(text).toContain('3 integrity incidents');
    expect(text).toContain('1 open');
    expect(text).toContain('1 mitigated');
    expect(text).toContain('1 resolved');
  });
});

describe('the boundary note (T6)', () => {
  it('states tamper-evidence, not tamper-prevention', () => {
    expect(INCIDENT_BOUNDARY_NOTE).toContain('tamper-evidence, not tamper-prevention');
    expect(INCIDENT_BOUNDARY_NOTE).toContain('append-only');
  });

  it('no UI string in the module claims prevention or comprehension', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/incidentWizard.ts'), 'utf8');
    // "model" is the data model and is fine; what must never appear is an AI claim or a claim to
    // comprehend. "prevention" only appears inside the honest boundary note ("tamper-prevention").
    for (const banned of [/\bAI\b/, /\bLLM\b/, /\bembedding/i, /\bsmart\b/i, /\bunderstand\b/i, /\bcomprehend/i]) {
      const lines = source.split('\n').filter((l) => banned.test(l) && !l.includes('tamper-prevention'));
      expect(lines, `banned term ${banned} in: ${lines.join(' | ')}`).toEqual([]);
    }
    const prevention = source.split('\n').filter((l) => /\bprevent(s|ion|ed|ing)?\b/i.test(l) && !l.includes('tamper-prevention'));
    expect(prevention, `a prevention claim outside the boundary note: ${prevention.join(' | ')}`).toEqual([]);
  });
});
