import { describe, expect, it } from 'vitest';
import {
  listProcedureTemplates, getProcedureTemplate, saveProcedureTemplate, publishProcedureTemplate,
  listWorkpaperSteps, applyTemplateToWorkpaper, STEP_KINDS, STEP_KIND_LABELS,
} from './methodology';

/**
 * With no Supabase environment variables the methodology module is inert: reads return empty and
 * writes report that the module is not configured. No request leaves the process.
 */
describe('methodology data module (not configured)', () => {
  const notConfigured = { ok: false, reason: 'The methodology module is not configured.' };

  it('reads return empty', async () => {
    expect(await listProcedureTemplates()).toEqual([]);
    expect(await getProcedureTemplate('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(await listWorkpaperSteps('00000000-0000-0000-0000-000000000000')).toEqual([]);
  });

  it('writes report that the module is not configured', async () => {
    expect(await saveProcedureTemplate('m', 't', 'd', []))
      .toEqual(notConfigured);
    expect(await publishProcedureTemplate('00000000-0000-0000-0000-000000000000')).toEqual(notConfigured);
    expect(await applyTemplateToWorkpaper('00000000-0000-0000-0000-000000000000', 'internal_audit'))
      .toEqual(notConfigured);
  });

  it('the step kinds are the closed set the database enforces', () => {
    expect([...STEP_KINDS]).toEqual([
      'inquiry', 'observation', 'document_review', 'inspection', 'reperformance', 'recalculation', 'analytical',
    ]);
    for (const k of STEP_KINDS) expect(STEP_KIND_LABELS[k]).toBeTruthy();
  });
});
