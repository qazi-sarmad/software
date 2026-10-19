import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const runAiAssist = vi.fn();
const testAiEndpoint = vi.fn();
const decideSuggestion = vi.fn();

vi.mock('../../data/ai', () => ({
  runAiAssist: (...a: unknown[]) => runAiAssist(...a),
  testAiEndpoint: (...a: unknown[]) => testAiEndpoint(...a),
  decideSuggestion: (...a: unknown[]) => decideSuggestion(...a),
}));

import { AiAssist } from './AiAssist';

function renderAssist(overrides: Partial<React.ComponentProps<typeof AiAssist>> = {}) {
  const onAccept = vi.fn();
  render(
    <AiAssist
      orgId="org-a" useCase="observation_draft" recordType="observation" recordId="obs-1"
      allowedNumbers={['42']} buildPrompt={() => 'Draft an observation.'} onAccept={onAccept}
      {...overrides}
    />
  );
  return { onAccept };
}

describe('WK-07 AiAssist (M-4a, F8)', () => {
  beforeEach(() => {
    runAiAssist.mockReset();
    testAiEndpoint.mockReset();
    decideSuggestion.mockReset();
  });

  it('shows a draft with the AI-generated label and never writes it until accepted', async () => {
    runAiAssist.mockResolvedValue({
      ok: true, text: 'There were 42 findings.', suggestionId: 'sug-1',
      unverifiedFigures: [],
    });
    const { onAccept } = renderAssist();
    fireEvent.click(screen.getByTestId('ai-assist-suggest'));
    await waitFor(() => expect(screen.getByTestId('ai-assist-draft')).toBeTruthy());
    expect(screen.getByTestId('ai-assist-label').textContent).toContain('AI-generated');
    // Nothing is written to the record merely by drafting (F8).
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('accepting hands the text to the caller and records the decision', async () => {
    runAiAssist.mockResolvedValue({ ok: true, text: 'Draft text', suggestionId: 'sug-2', unverifiedFigures: [] });
    decideSuggestion.mockResolvedValue({ ok: true });
    const { onAccept } = renderAssist();
    fireEvent.click(screen.getByTestId('ai-assist-suggest'));
    await waitFor(() => expect(screen.getByTestId('ai-assist-draft')).toBeTruthy());
    fireEvent.click(screen.getByTestId('ai-assist-accept'));
    await waitFor(() => expect(onAccept).toHaveBeenCalledWith('Draft text', 'sug-2'));
    expect(decideSuggestion).toHaveBeenCalledWith('sug-2', 'accepted', 'Draft text');
  });

  it('blocks Accept while an unverified figure is unconfirmed', async () => {
    runAiAssist.mockResolvedValue({
      ok: true, text: 'There were 99 findings.', suggestionId: 'sug-3',
      unverifiedFigures: [{ token: '99', context: 'There were 99 findings' }],
    });
    renderAssist();
    fireEvent.click(screen.getByTestId('ai-assist-suggest'));
    await waitFor(() => expect(screen.getByTestId('ai-assist-figures')).toBeTruthy());
    const accept = screen.getByTestId('ai-assist-accept') as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('ai-assist-figure-confirm-99'));
    await waitFor(() => expect((screen.getByTestId('ai-assist-accept') as HTMLButtonElement).disabled).toBe(false));
  });

  it('rejecting records the rejection and closes the draft', async () => {
    runAiAssist.mockResolvedValue({ ok: true, text: 'Draft', suggestionId: 'sug-4', unverifiedFigures: [] });
    decideSuggestion.mockResolvedValue({ ok: true });
    renderAssist();
    fireEvent.click(screen.getByTestId('ai-assist-suggest'));
    await waitFor(() => expect(screen.getByTestId('ai-assist-draft')).toBeTruthy());
    fireEvent.click(screen.getByTestId('ai-assist-reject'));
    await waitFor(() => expect(decideSuggestion).toHaveBeenCalledWith('sug-4', 'rejected'));
    expect(screen.queryByTestId('ai-assist-draft')).toBeNull();
  });

  it('shows the server refusal in its own words when the model does not answer', async () => {
    runAiAssist.mockResolvedValue({ ok: false, reason: 'The model endpoint could not be reached.' });
    renderAssist();
    fireEvent.click(screen.getByTestId('ai-assist-suggest'));
    await waitFor(() => expect(screen.getByTestId('ai-assist-error').textContent)
      .toContain('could not be reached'));
  });

  it('the Test button reports the installed model and the round-trip time', async () => {
    testAiEndpoint.mockResolvedValue({ ok: true, models: ['llama3.1:8b'], modelInstalled: true, roundTripMs: 12 });
    renderAssist();
    fireEvent.click(screen.getByTestId('ai-assist-test'));
    await waitFor(() => expect(screen.getByTestId('ai-assist-probe').textContent)
      .toContain('is installed'));
  });

  it('the Test button warns when the assigned model is not installed', async () => {
    testAiEndpoint.mockResolvedValue({ ok: true, models: ['other'], modelInstalled: false, roundTripMs: 8 });
    renderAssist();
    fireEvent.click(screen.getByTestId('ai-assist-test'));
    await waitFor(() => expect(screen.getByTestId('ai-assist-probe').textContent)
      .toContain('not installed'));
  });
});
