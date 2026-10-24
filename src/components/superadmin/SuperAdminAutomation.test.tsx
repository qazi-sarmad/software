import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listRules = vi.fn();
const saveRule = vi.fn();
const testRule = vi.fn();
const listEventCatalogue = vi.fn();
const listTemplates = vi.fn();
const saveTemplate = vi.fn();

vi.mock('../../data/automation', () => ({
  listRules: (o: string) => listRules(o),
  saveRule: (...a: unknown[]) => saveRule(...a),
  testRule: (...a: unknown[]) => testRule(...a),
  listEventCatalogue: () => listEventCatalogue(),
  listTemplates: (o: string) => listTemplates(o),
  saveTemplate: (...a: unknown[]) => saveTemplate(...a),
}));

import { SuperAdminAutomation } from './SuperAdminAutomation';

const events = [
  { eventKey: 'config.changed', label: 'A configuration changed', category: 'configuration', fields: [{ field: 'area', label: 'Area', kind: 'text' as const }] },
  { eventKey: 'cap.overdue', label: 'A corrective action is overdue', category: 'cap', fields: [{ field: 'severity', label: 'Severity', kind: 'select' as const }] },
];

const rules = [{
  id: 'r1', ruleKey: 'platform.config.changed', name: 'Tell Org Admins', eventKey: 'config.changed',
  conditions: [], actions: [{ type: 'notify' as const, message: 'A setting changed' }],
  enabled: true, isPlatformTemplate: true, pausedAt: null, pauseReason: null,
}];

describe('SA-07 and SA-08 automation (F7, F1)', () => {
  beforeEach(() => {
    listRules.mockResolvedValue(rules);
    listEventCatalogue.mockResolvedValue(events);
    listTemplates.mockResolvedValue([]);
    saveRule.mockResolvedValue({ ok: true });
    saveTemplate.mockResolvedValue({ ok: true });
    testRule.mockResolvedValue({ recipients: ['ops@qscorp.example'], subject: 'A setting changed', bodyText: 'area: email' });
  });

  it('lists rules with a plain-language description', async () => {
    render(<SuperAdminAutomation />);
    await waitFor(() => expect(screen.getByTestId('rule-platform.config.changed')).toBeTruthy());
    expect(screen.getByTestId('rule-platform.config.changed').textContent).toContain('When');
  });

  it('the event picker is a dropdown built from the catalogue, never a JSON box', async () => {
    render(<SuperAdminAutomation />);
    await waitFor(() => expect(screen.getByTestId('rule-event')).toBeTruthy());
    expect((screen.getByTestId('rule-event') as HTMLSelectElement).tagName).toBe('SELECT');
    expect(screen.getByTestId('superadmin-automation').querySelectorAll('textarea')).toHaveLength(0);
  });

  it('refuses a rule with no key before calling the server', async () => {
    render(<SuperAdminAutomation />);
    await waitFor(() => expect(screen.getByTestId('rule-save')).toBeTruthy());
    fireEvent.click(screen.getByTestId('rule-save'));
    await waitFor(() => expect(screen.getByTestId('superadmin-automation-result').textContent).toContain('key and a name'));
    expect(saveRule).not.toHaveBeenCalled();
  });

  it('saves a rule and reloads', async () => {
    render(<SuperAdminAutomation />);
    await waitFor(() => expect(screen.getByTestId('rule-key')).toBeTruthy());
    fireEvent.change(screen.getByTestId('rule-key'), { target: { value: 'platform.new' } });
    fireEvent.change(screen.getByTestId('rule-name'), { target: { value: 'A new rule' } });
    fireEvent.click(screen.getByTestId('rule-save'));
    await waitFor(() => expect(saveRule).toHaveBeenCalled());
    expect(listRules).toHaveBeenCalledTimes(2);
  });

  it('Test with a sample event shows the recipients and sends nothing', async () => {
    render(<SuperAdminAutomation />);
    await waitFor(() => expect(screen.getByTestId('rule-test-platform.config.changed')).toBeTruthy());
    fireEvent.click(screen.getByTestId('rule-test-platform.config.changed'));
    await waitFor(() => expect(screen.getByTestId('rule-test-output')).toBeTruthy());
    expect(screen.getByTestId('rule-test-output').textContent).toContain('ops@qscorp.example');
    expect(screen.getByTestId('rule-test-output').textContent).toContain('nothing was sent');
  });

  it('the template editor moves blocks with up and down buttons', async () => {
    render(<SuperAdminAutomation />);
    await waitFor(() => expect(screen.getByTestId('superadmin-automation-tab-templates')).toBeTruthy());
    fireEvent.click(screen.getByTestId('superadmin-automation-tab-templates'));
    await waitFor(() => expect(screen.getByTestId('template-block-0')).toBeTruthy());
    fireEvent.click(screen.getByTestId('template-add-heading'));
    await waitFor(() => expect(screen.getByTestId('template-block-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('template-block-up-1'));
    const first = screen.getByTestId('template-block-0').querySelector('span')?.textContent;
    expect(first).toBe('heading');
  });

  it('saves a template', async () => {
    render(<SuperAdminAutomation />);
    await waitFor(() => expect(screen.getByTestId('superadmin-automation-tab-templates')).toBeTruthy());
    fireEvent.click(screen.getByTestId('superadmin-automation-tab-templates'));
    await waitFor(() => expect(screen.getByTestId('template-subject')).toBeTruthy());
    fireEvent.change(screen.getByTestId('template-subject'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTestId('template-save'));
    await waitFor(() => expect(saveTemplate).toHaveBeenCalled());
  });
});
