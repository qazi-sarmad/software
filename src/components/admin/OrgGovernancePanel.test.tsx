import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const getLifecycleSettings = vi.fn();
const saveLifecycleSettings = vi.fn();
const getWorkflowSettings = vi.fn();
const saveWorkflowSettings = vi.fn();
const getExportRetention = vi.fn();
const saveExportRetention = vi.fn();
const getUploadLimits = vi.fn();
const saveUploadLimits = vi.fn();
const listFindingSections = vi.fn();
const upsertFindingSection = vi.fn();
const deleteFindingSection = vi.fn();
const listMethodologyScales = vi.fn();
const upsertMethodologyScale = vi.fn();
const listFsliMappings = vi.fn();
const upsertFsliMapping = vi.fn();
const listNotificationRules = vi.fn();
const upsertNotificationRule = vi.fn();
const listBiParameters = vi.fn();
const setBiParameter = vi.fn();

vi.mock('../../data/governance', () => ({
  FINDING_ROLE_TAGS: ['context', 'condition', 'effect', 'risk', 'criteria', 'cause', 'recommendation', 'other'],
  TEAM_ROLES: ['lead', 'preparer', 'reviewer', 'observer'],
  PLATFORM_EXTENSIONS: ['xls', 'xlsx', 'csv', 'doc', 'docx', 'ppt', 'pptx', 'pdf'],
  getLifecycleSettings: () => getLifecycleSettings(),
  saveLifecycleSettings: (s: unknown) => saveLifecycleSettings(s),
  getWorkflowSettings: () => getWorkflowSettings(),
  saveWorkflowSettings: (s: unknown) => saveWorkflowSettings(s),
  getExportRetention: () => getExportRetention(),
  saveExportRetention: (s: unknown) => saveExportRetention(s),
  getUploadLimits: () => getUploadLimits(),
  saveUploadLimits: (...a: unknown[]) => saveUploadLimits(...a),
  listFindingSections: () => listFindingSections(),
  upsertFindingSection: (...a: unknown[]) => upsertFindingSection(...a),
  deleteFindingSection: (id: string) => deleteFindingSection(id),
  listMethodologyScales: () => listMethodologyScales(),
  upsertMethodologyScale: (...a: unknown[]) => upsertMethodologyScale(...a),
  listFsliMappings: () => listFsliMappings(),
  upsertFsliMapping: (...a: unknown[]) => upsertFsliMapping(...a),
  listNotificationRules: () => listNotificationRules(),
  upsertNotificationRule: (...a: unknown[]) => upsertNotificationRule(...a),
  listBiParameters: () => listBiParameters(),
  setBiParameter: (...a: unknown[]) => setBiParameter(...a),
}));

import { OrgGovernancePanel } from './OrgGovernancePanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';

/** The panel now carries explain affordances, which read the live session; wrap it as the app does. */
const renderPanel = () =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser('org_admin')} seed={testSeed}>
        <OrgGovernancePanel />
      </AppProvider>
    </ThemeProvider>
  );

describe('OA-22 governance settings (C3.2-B)', () => {
  beforeEach(() => {
    getLifecycleSettings.mockResolvedValue({
      testingMode: 'two_stage', signoffRolePlanning: 'reviewer', signoffRoleTesting: 'reviewer',
      signoffRoleConclusion: 'reviewer', reportOpinionRequired: false, testingGraceHours: 0,
    });
    getWorkflowSettings.mockResolvedValue({ approvalChain: [], slaHours: 48, escalationRole: 'cia', escalationHours: 72 });
    getExportRetention.mockResolvedValue({ exportSchedule: 'manual', activityRetentionDays: 365, populationRetentionMonths: 6 });
    getUploadLimits.mockResolvedValue({ maxFileMb: 10, allowedExtensions: ['pdf', 'xlsx'] });
    listFindingSections.mockResolvedValue([
      { id: 's1', roleTag: 'condition', label: 'What we found', position: 1, required: true },
    ]);
    listMethodologyScales.mockResolvedValue([{ id: 'sc1', key: 'likelihood', label: 'Likelihood', points: [] }]);
    listFsliMappings.mockResolvedValue([{ id: 'f1', code: '1000', label: 'Cash', category: 'Assets' }]);
    listNotificationRules.mockResolvedValue([
      { id: 'r1', eventKey: 'cap.overdue', recipientRoles: ['cia'], supervisorCopy: true, enabled: true },
    ]);
    listBiParameters.mockResolvedValue([
      { checkKey: 'outlier_z_threshold', label: 'Outlier z', minValue: 1.5, maxValue: 5, defaultValue: 3, value: null },
    ]);
    saveLifecycleSettings.mockResolvedValue({ ok: true });
    saveWorkflowSettings.mockResolvedValue({ ok: true });
    saveExportRetention.mockResolvedValue({ ok: true });
    saveUploadLimits.mockResolvedValue({ ok: true });
    upsertFindingSection.mockResolvedValue({ ok: true });
    deleteFindingSection.mockResolvedValue({ ok: true });
    upsertMethodologyScale.mockResolvedValue({ ok: true });
    upsertFsliMapping.mockResolvedValue({ ok: true });
    upsertNotificationRule.mockResolvedValue({ ok: true });
    setBiParameter.mockResolvedValue({ ok: true });
  });

  it('renders every governance section with its real data', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('oa-governance')).toBeTruthy());
    for (const id of ['oa-governance-lifecycle', 'oa-governance-findings', 'oa-governance-methodology',
      'oa-governance-workflow', 'oa-governance-notifications', 'oa-governance-bi', 'oa-governance-uploads',
      'oa-governance-retention']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.getByTestId('oa-governance-section-condition').textContent).toContain('What we found');
    expect(screen.getByTestId('oa-governance-fsli-1000').textContent).toContain('Cash');
    expect(screen.getByTestId('oa-governance-rule-cap.overdue').textContent).toContain('cia');
  });

  it('saves the lifecycle settings through the RPC and confirms', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('oa-governance-lifecycle-save')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-governance-testing-mode'), { target: { value: 'one_stage' } });
    fireEvent.change(screen.getByTestId('oa-governance-grace-hours'), { target: { value: '24' } });
    fireEvent.click(screen.getByTestId('oa-governance-lifecycle-save'));
    await waitFor(() => expect(saveLifecycleSettings).toHaveBeenCalled());
    expect(saveLifecycleSettings.mock.calls[0][0].testingMode).toBe('one_stage');
    expect(saveLifecycleSettings.mock.calls[0][0].testingGraceHours).toBe(24);
    await waitFor(() => expect(screen.getByTestId('oa-governance-result').textContent).toContain('Saved'));
  });

  it('sets a BI parameter and reports a refusal from the platform range', async () => {
    setBiParameter.mockResolvedValueOnce({ ok: false, reason: 'the value for outlier_z_threshold must be between 1.5 and 5' });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('oa-governance-bi-save-outlier_z_threshold')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-governance-bi-value-outlier_z_threshold'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByTestId('oa-governance-bi-save-outlier_z_threshold'));
    await waitFor(() => expect(screen.getByTestId('oa-governance-result').textContent).toContain('must be between'));
  });

  it('adds a finding section with a role tag', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByTestId('oa-governance-section-label')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-governance-section-label'), { target: { value: 'Effect' } });
    fireEvent.click(screen.getByTestId('oa-governance-section-add'));
    await waitFor(() => expect(upsertFindingSection).toHaveBeenCalled());
    expect(upsertFindingSection.mock.calls[0][0]).toBe('condition');
  });
});
