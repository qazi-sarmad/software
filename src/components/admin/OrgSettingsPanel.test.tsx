import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const listRules = vi.fn();
const listLevels = vi.fn();
const getEmail = vi.fn();

vi.mock('../../data/sampling', () => ({
  listSamplingRules: () => listRules(),
  upsertSamplingRule: () => Promise.resolve({ ok: true }),
  deleteSamplingRule: () => Promise.resolve({ ok: true }),
}));
vi.mock('../../data/orgSettings', () => ({
  SEVERITY_COLOR_TOKENS: ['--accent-cinnabar'],
  EMAIL_PROVIDERS: ['stub', 'resend', 'graph'],
  listSeverityLevels: () => listLevels(),
  upsertSeverityLevel: () => Promise.resolve({ ok: true }),
  deleteSeverityLevel: () => Promise.resolve({ ok: true }),
  getEmailSettings: () => getEmail(),
  setEmailProvider: () => Promise.resolve({ ok: true }),
}));

const userRef = { current: { role: 'org_admin', rights: { edit_config: true } } };
vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: userRef.current }),
}));

import { OrgSettingsPanel } from './OrgSettingsPanel';

describe('Organisation settings panel (C5)', () => {
  beforeEach(() => {
    userRef.current = { role: 'org_admin', rights: { edit_config: true } } as never;
  });

  it('refuses a session without the edit_config right', () => {
    userRef.current = { role: 'preparer', rights: {} } as never;
    render(<OrgSettingsPanel />);
    expect(screen.getByTestId('org-settings-denied')).toBeTruthy();
  });

  it('lists sampling rules for an editor', async () => {
    listRules.mockResolvedValue([
      { id: 'r1', controlType: 'any', frequency: 'any', popBand: 'small', method: 'random', baseSize: 5, pct: 0.1 },
    ]);
    listLevels.mockResolvedValue([]);
    getEmail.mockResolvedValue(null);
    render(<OrgSettingsPanel />);
    await waitFor(() => expect(screen.getByTestId('org-settings-sampling')).toBeTruthy());
    expect(screen.getByLabelText(/Method for small/)).toBeTruthy();
  });

  it('shows designed empty states', async () => {
    listRules.mockResolvedValue([]);
    listLevels.mockResolvedValue([]);
    getEmail.mockResolvedValue(null);
    render(<OrgSettingsPanel />);
    await waitFor(() => expect(screen.getByTestId('org-settings-sampling')).toBeTruthy());
    expect(screen.getByText('No sampling rules are configured.')).toBeTruthy();
  });
});
