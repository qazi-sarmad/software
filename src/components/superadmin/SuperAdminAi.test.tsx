import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listAiModels = vi.fn();
const listDenyPatterns = vi.fn();
const addAiModel = vi.fn();
const updateAiModel = vi.fn();
const removeAiModel = vi.fn();
const addDenyPattern = vi.fn();
const removeDenyPattern = vi.fn();

vi.mock('../../data/ai', () => ({
  listAiModels: () => listAiModels(),
  listDenyPatterns: () => listDenyPatterns(),
  addAiModel: (...a: unknown[]) => addAiModel(...a),
  updateAiModel: (...a: unknown[]) => updateAiModel(...a),
  removeAiModel: (...a: unknown[]) => removeAiModel(...a),
  addDenyPattern: (...a: unknown[]) => addDenyPattern(...a),
  removeDenyPattern: (...a: unknown[]) => removeDenyPattern(...a),
}));

import { SuperAdminAi } from './SuperAdminAi';

const MODELS = [
  { id: 'm1', name: 'Llama 3.1', modelRef: 'llama3.1:8b', status: 'live', notes: null },
];
const PATTERNS = [
  { id: 'p1', pattern: 'api.openai.com', label: 'OpenAI' },
];

describe('SA-06 AI model registry and deny-list (F8)', () => {
  beforeEach(() => {
    listAiModels.mockResolvedValue(MODELS);
    listDenyPatterns.mockResolvedValue(PATTERNS);
    addAiModel.mockResolvedValue({ ok: true });
    updateAiModel.mockResolvedValue({ ok: true });
    removeAiModel.mockResolvedValue({ ok: true });
    addDenyPattern.mockResolvedValue({ ok: true });
    removeDenyPattern.mockResolvedValue({ ok: true });
  });

  it('lists the models and the deny-list', async () => {
    render(<SuperAdminAi />);
    await waitFor(() => expect(screen.getByTestId('superadmin-ai')).toBeTruthy());
    expect(screen.getByTestId('sa-ai-model-m1')).toBeTruthy();
    expect(screen.getByTestId('sa-ai-pattern-p1')).toBeTruthy();
  });

  it('adds a model through the registry', async () => {
    render(<SuperAdminAi />);
    await waitFor(() => expect(screen.getByTestId('superadmin-ai')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-ai-model-name'), { target: { value: 'Qwen' } });
    fireEvent.change(screen.getByTestId('sa-ai-model-ref'), { target: { value: 'qwen2.5:7b' } });
    fireEvent.click(screen.getByTestId('sa-ai-model-add'));
    await waitFor(() => expect(addAiModel).toHaveBeenCalledWith('Qwen', 'qwen2.5:7b', undefined));
  });

  it('shows the fixed refusal when the server refuses a vendor endpoint', async () => {
    addAiModel.mockResolvedValue({ ok: false, reason: 'This looks like a vendor-hosted AI service.' });
    render(<SuperAdminAi />);
    await waitFor(() => expect(screen.getByTestId('superadmin-ai')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-ai-model-name'), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByTestId('sa-ai-model-ref'), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId('sa-ai-model-add'));
    await waitFor(() => expect(screen.getByTestId('sa-ai-result')).toBeTruthy());
  });

  it('disables an active model', async () => {
    render(<SuperAdminAi />);
    await waitFor(() => expect(screen.getByTestId('superadmin-ai')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sa-ai-model-toggle-m1'));
    await waitFor(() => expect(updateAiModel).toHaveBeenCalledWith('m1', 'Llama 3.1', 'llama3.1:8b', 'parked'));
  });
});
