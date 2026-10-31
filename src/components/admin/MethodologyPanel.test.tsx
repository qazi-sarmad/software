import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listProcedureTemplates = vi.fn();
const saveProcedureTemplate = vi.fn();
const publishProcedureTemplate = vi.fn();

vi.mock('../../data/methodology', () => ({
  STEP_KINDS: ['inquiry', 'observation', 'document_review', 'inspection', 'reperformance', 'recalculation', 'analytical'],
  STEP_KIND_LABELS: {
    inquiry: 'Inquiry', observation: 'Observation', document_review: 'Document review',
    inspection: 'Inspection', reperformance: 'Reperformance', recalculation: 'Recalculation',
    analytical: 'Analytical procedure',
  },
  listProcedureTemplates: () => listProcedureTemplates(),
  saveProcedureTemplate: (...a: unknown[]) => saveProcedureTemplate(...a),
  publishProcedureTemplate: (...a: unknown[]) => publishProcedureTemplate(...a),
}));

const userRef = { current: { id: 'u1', role: 'org_admin', rights: { edit_config: true }, orgId: 'org-a' } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { MethodologyPanel } from './MethodologyPanel';

const tpl = {
  id: 't1', modelId: 'internal_audit', version: 2, title: 'Internal audit', description: '',
  steps: [
    { stepKey: 'design', label: 'Walk the process', kind: 'inquiry' as const, requiresEvidence: false, ordinal: 1 },
    { stepKey: 'operate', label: 'Test the control', kind: 'inspection' as const, requiresEvidence: true, ordinal: 2 },
  ],
  updatedAt: null,
};

describe('OA-25 methodology library (Phase 4)', () => {
  beforeEach(() => {
    userRef.current = { id: 'u1', role: 'org_admin', rights: { edit_config: true }, orgId: 'org-a' } as never;
    listProcedureTemplates.mockResolvedValue([tpl]);
    saveProcedureTemplate.mockResolvedValue({ ok: true });
    publishProcedureTemplate.mockResolvedValue({ ok: true });
  });

  it('denies a caller without edit_config', () => {
    userRef.current = { id: 'u2', role: 'preparer', rights: { edit_config: false }, orgId: 'org-a' } as never;
    render(<MethodologyPanel />);
    expect(screen.getByTestId('methodology-no-right')).toBeTruthy();
  });

  it('lists the current procedures and loads the first one for editing', async () => {
    render(<MethodologyPanel />);
    await waitFor(() => expect(screen.getByTestId('methodology-panel')).toBeTruthy());
    expect(screen.getByTestId('methodology-template-internal_audit').textContent).toContain('v2');
    expect(screen.getByTestId('methodology-version').textContent).toContain('version 2');
    expect(screen.getByTestId('methodology-step-design')).toBeTruthy();
    expect(screen.getByTestId('methodology-step-operate')).toBeTruthy();
  });

  it('saves an edited procedure through the writer RPC', async () => {
    render(<MethodologyPanel />);
    await waitFor(() => expect(screen.getByTestId('methodology-save')).toBeTruthy());
    fireEvent.change(screen.getByTestId('methodology-title'), { target: { value: 'Treasury' } });
    fireEvent.click(screen.getByTestId('methodology-save'));
    await waitFor(() => expect(saveProcedureTemplate).toHaveBeenCalled());
    const call = saveProcedureTemplate.mock.calls[0];
    expect(call[0]).toBe('internal_audit');
    expect(call[1]).toBe('Treasury');
    expect(call[3].length).toBe(2);
  });

  it('adds and removes a step in the draft', async () => {
    render(<MethodologyPanel />);
    await waitFor(() => expect(screen.getByTestId('methodology-add-step')).toBeTruthy());
    fireEvent.click(screen.getByTestId('methodology-add-step'));
    expect(screen.getByTestId('methodology-steps').children.length).toBe(3);
    const stepKeys = screen.getByTestId('methodology-steps').children;
    const last = stepKeys[stepKeys.length - 1] as HTMLElement;
    const remove = last.querySelector('[data-testid^="methodology-step-remove-"]') as HTMLElement;
    fireEvent.click(remove);
    expect(screen.getByTestId('methodology-steps').children.length).toBe(2);
  });

  it('publishes the selected version and surfaces a refusal', async () => {
    publishProcedureTemplate.mockResolvedValue({ ok: false, reason: 'not allowed: caller lacks the edit_config right' });
    render(<MethodologyPanel />);
    await waitFor(() => expect(screen.getByTestId('methodology-publish')).toBeTruthy());
    fireEvent.click(screen.getByTestId('methodology-publish'));
    await waitFor(() =>
      expect(screen.getByTestId('methodology-save-error').textContent).toContain('edit_config'));
  });
});
