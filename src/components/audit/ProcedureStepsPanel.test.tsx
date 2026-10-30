import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listWorkpaperSteps = vi.fn();
const listProcedureTemplates = vi.fn();
const applyTemplateToWorkpaper = vi.fn();
const setTestStepCompleted = vi.fn();

vi.mock('../../data/methodology', () => ({
  STEP_KIND_LABELS: {
    inquiry: 'Inquiry', observation: 'Observation', document_review: 'Document review',
    inspection: 'Inspection', reperformance: 'Reperformance', recalculation: 'Recalculation',
    analytical: 'Analytical procedure',
  },
  listWorkpaperSteps: (...a: unknown[]) => listWorkpaperSteps(...a),
  listProcedureTemplates: () => listProcedureTemplates(),
  applyTemplateToWorkpaper: (...a: unknown[]) => applyTemplateToWorkpaper(...a),
}));
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ setTestStepCompleted }) }));

import { ProcedureStepsPanel } from './ProcedureStepsPanel';

describe('WK-09 procedure steps on a workpaper (Phase 4.2)', () => {
  beforeEach(() => {
    listProcedureTemplates.mockResolvedValue([
      { id: 't1', modelId: 'internal_audit', version: 1, title: 'Internal audit', description: '', steps: [], updatedAt: null },
    ]);
    listWorkpaperSteps.mockResolvedValue([]);
    applyTemplateToWorkpaper.mockResolvedValue({ ok: true });
    setTestStepCompleted.mockReturnValue({ ok: true });
  });

  it('shows the empty state until a procedure is applied', async () => {
    render(<ProcedureStepsPanel workpaperId="w1" locked={false} />);
    await waitFor(() => expect(screen.getByTestId('procedure-steps-empty')).toBeTruthy());
  });

  it('applies the selected procedure through the RPC', async () => {
    render(<ProcedureStepsPanel workpaperId="w1" locked={false} />);
    await waitFor(() => expect(screen.getByTestId('procedure-apply')).toBeTruthy());
    fireEvent.click(screen.getByTestId('procedure-apply'));
    await waitFor(() => expect(applyTemplateToWorkpaper).toHaveBeenCalledWith('w1', 'internal_audit'));
  });

  it('renders the applied steps with their kind and ticks one', async () => {
    listWorkpaperSteps.mockResolvedValue([
      { stepId: 'design', label: 'Walk the process', kind: 'inquiry', requiresEvidence: false, completed: false, ordinal: 1, fromTemplate: true },
      { stepId: 'operate', label: 'Test the control', kind: 'inspection', requiresEvidence: true, completed: false, ordinal: 2, fromTemplate: true },
    ]);
    render(<ProcedureStepsPanel workpaperId="w1" locked={false} />);
    await waitFor(() => expect(screen.getByTestId('procedure-step-design')).toBeTruthy());
    expect(screen.getByTestId('procedure-step-operate').textContent).toContain('evidence required');
    fireEvent.click(screen.getByTestId('procedure-step-design'));
    await waitFor(() => expect(setTestStepCompleted).toHaveBeenCalledWith('w1', 'design', true));
  });

  it('surfaces a refusal from the write instead of pretending success', async () => {
    listWorkpaperSteps.mockResolvedValue([
      { stepId: 'design', label: 'Walk the process', kind: 'inquiry', requiresEvidence: false, completed: false, ordinal: 1, fromTemplate: true },
    ]);
    setTestStepCompleted.mockReturnValue({ ok: false, reason: 'workpaper_locked: a signed-off workpaper is read-only' });
    render(<ProcedureStepsPanel workpaperId="w1" locked={false} />);
    await waitFor(() => expect(screen.getByTestId('procedure-step-design')).toBeTruthy());
    fireEvent.click(screen.getByTestId('procedure-step-design'));
    await waitFor(() =>
      expect(screen.getByTestId('procedure-steps-message').textContent).toContain('read-only'));
  });
});
