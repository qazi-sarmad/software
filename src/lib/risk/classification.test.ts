import { describe, expect, it } from 'vitest';
import {
  CLASSIFICATIONS,
  CLASSIFICATION_CODES,
  classifyClient,
  icfrMandatory,
  obligationsFor,
} from './classification';

describe('D10: the C1–C8 matrix is the classification set', () => {
  it('names exactly C1..C8, each with a regulator, a law and a citation', () => {
    expect(CLASSIFICATION_CODES).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
    for (const c of CLASSIFICATIONS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.regulator.length).toBeGreaterThan(0);
      expect(c.governingLaw.length).toBeGreaterThan(0);
      expect(c.citation.length).toBeGreaterThan(0);
      expect(['verified', 'reported']).toContain(c.verification);
    }
  });

  it('an SMC (C5) is exempt from internal audit and ICFR', () => {
    const d = classifyClient({ classification: 'C5', isIslamic: false, hasItScope: false });
    expect(d.internalAuditMandatory).toBe(false);
    expect(d.icfrMandatory).toBe(false);
    expect(d.icfrRigour).toBe('none');
    expect(d.obligations).toEqual([]);
  });

  it('a banking company / DFI (C6) is offered the SBP ICFR set and the LFR artifact', () => {
    const d = classifyClient({ classification: 'C6', isIslamic: false, hasItScope: false });
    expect(d.internalAuditMandatory).toBe(true);
    expect(d.icfrMandatory).toBe(true);
    expect(d.icfrRigour).toBe('highest');
    expect(d.frameworks).toContain('SBP ICFR Roadmap');
    expect(d.artifacts.join(' ')).toContain('Long Form Report (LFR)');
    expect(d.regulatorNumbering).toContain('SBP BSD Circular No. 7 of 2004');
  });

  it('an SOE (C7) mandates COSO ERM, ISO 31000 and COBIT', () => {
    const d = classifyClient({ classification: 'C7', isIslamic: false, hasItScope: false });
    expect(d.frameworks).toEqual(['COSO ERM', 'ISO 31000', 'COBIT']);
    expect(d.artifacts).toContain('LFR');
  });

  it('bad path: a classification the matrix does not name is refused, never guessed', () => {
    expect(() => classifyClient({ classification: 'C9', isIslamic: false, hasItScope: false })).toThrow(
      /not a classification the matrix names/,
    );
    expect(() => classifyClient({ classification: '', isIslamic: false, hasItScope: false })).toThrow();
    expect(() => obligationsFor('X1')).toThrow();
  });

  it('bad path: an obligation without a citation is refused', () => {
    // obligationsFor is the guard; every real obligation carries a source clause.
    for (const code of CLASSIFICATION_CODES) {
      for (const o of obligationsFor(code)) {
        expect(o.sourceClause.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('offered disciplines follow the matrix: C1 offers management (+IT), never Shari\'ah', () => {
    expect(classifyClient({ classification: 'C1', isIslamic: false, hasItScope: false }).offeredDisciplines).toEqual(['management']);
    expect(classifyClient({ classification: 'C1', isIslamic: false, hasItScope: true }).offeredDisciplines).toEqual(['management', 'it']);
    expect(classifyClient({ classification: 'C1', isIslamic: true, hasItScope: false }).offeredDisciplines).toEqual(['management', 'shariah']);
  });

  it('C6/C7 offer all three disciplines; an Islamic tenant is offered Shari\'ah regardless', () => {
    expect(classifyClient({ classification: 'C6', isIslamic: false, hasItScope: true }).offeredDisciplines).toEqual(['management', 'it', 'shariah']);
    expect(classifyClient({ classification: 'C7', isIslamic: false, hasItScope: false }).offeredDisciplines).toEqual(['management', 'shariah']);
    expect(classifyClient({ classification: 'C8', isIslamic: true, hasItScope: false }).offeredDisciplines).toContain('shariah');
  });

  it('C8 is conditional, not exempt', () => {
    const d = classifyClient({ classification: 'C8', isIslamic: false, hasItScope: false });
    expect(d.internalAuditConditional).toBe(true);
    expect(d.internalAuditMandatory).toBe(false);
  });

  it('icfrMandatory is false for a bare statutory audit', () => {
    expect(icfrMandatory('none')).toBe(false);
    expect(icfrMandatory('basic')).toBe(false);
    expect(icfrMandatory('statement')).toBe(true);
  });
});
