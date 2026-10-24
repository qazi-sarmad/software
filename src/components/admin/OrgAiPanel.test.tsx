import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listUseCases = vi.fn();
const listVoiceTerms = vi.fn();
const listVoiceSamples = vi.fn();
const getVoiceProfile = vi.fn();
const setEndpoint = vi.fn();
const saveUseCase = vi.fn();
const saveVoiceProfile = vi.fn();
const addVoiceTerm = vi.fn();
const addVoiceSample = vi.fn();

vi.mock('../../data/ai', () => ({
  listUseCases: (o: string) => listUseCases(o),
  listVoiceTerms: (o: string) => listVoiceTerms(o),
  listVoiceSamples: (o: string) => listVoiceSamples(o),
  getVoiceProfile: (o: string) => getVoiceProfile(o),
  setEndpoint: (...a: unknown[]) => setEndpoint(...a),
  saveUseCase: (...a: unknown[]) => saveUseCase(...a),
  saveVoiceProfile: (...a: unknown[]) => saveVoiceProfile(...a),
  addVoiceTerm: (...a: unknown[]) => addVoiceTerm(...a),
  addVoiceSample: (...a: unknown[]) => addVoiceSample(...a),
}));

import { OrgAiPanel } from './OrgAiPanel';

describe('OA-06 and OA-07 AI settings and voice library (F8)', () => {
  beforeEach(() => {
    listUseCases.mockResolvedValue([
      { useCase: 'observation_draft', enabled: true, systemPrompt: 'draft', temperature: 0.2, topP: 0.9, maxTokens: 600 },
    ]);
    listVoiceTerms.mockResolvedValue([]);
    listVoiceSamples.mockResolvedValue([]);
    getVoiceProfile.mockResolvedValue({ tone: 'formal', person: 'third', length: 'brief', customInstructions: null });
    setEndpoint.mockResolvedValue({ ok: true });
    saveUseCase.mockResolvedValue({ ok: true });
    saveVoiceProfile.mockResolvedValue({ ok: true });
    addVoiceTerm.mockResolvedValue({ ok: true });
    addVoiceSample.mockResolvedValue({ ok: true });
  });

  it('renders the use cases and the voice profile', async () => {
    render(<OrgAiPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('org-ai-panel')).toBeTruthy());
    expect(screen.getByTestId('oa-ai-usecase-observation_draft')).toBeTruthy();
    expect(screen.getByTestId('oa-voice')).toBeTruthy();
  });

  it('refuses a vendor endpoint with the server message', async () => {
    setEndpoint.mockResolvedValue({ ok: false, reason: 'This looks like a vendor-hosted AI service.' });
    render(<OrgAiPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('org-ai-panel')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-ai-endpoint-url'), { target: { value: 'https://api.openai.com/v1' } });
    fireEvent.click(screen.getByTestId('oa-ai-endpoint-save'));
    await waitFor(() => expect(screen.getByTestId('oa-ai-result')).toBeTruthy());
  });

  it('toggles a use case', async () => {
    render(<OrgAiPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('org-ai-panel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-ai-usecase-toggle-observation_draft'));
    await waitFor(() => expect(saveUseCase).toHaveBeenCalled());
  });

  it('saves the voice profile', async () => {
    render(<OrgAiPanel orgId="org-a" />);
    await waitFor(() => expect(screen.getByTestId('org-ai-panel')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-voice-save'));
    await waitFor(() => expect(saveVoiceProfile).toHaveBeenCalledWith('org-a', 'formal', 'third', 'brief', ''));
  });
});
