import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listHostingConnections = vi.fn();
const saveHostingConnection = vi.fn();
const setConnectionSecret = vi.fn();
const createMigrationJob = vi.fn();
const storeSecret = vi.fn();

vi.mock('../../data/hostingFit', () => ({
  listHostingConnections: (o: string) => listHostingConnections(o),
  saveHostingConnection: (i: unknown) => saveHostingConnection(i),
  setConnectionSecret: (a: string, b: string, c: string) => setConnectionSecret(a, b, c),
  createMigrationJob: (o: string, c: string) => createMigrationJob(o, c),
  migrationRunnerCommand: (a: string, b: string) => `node tools/migration-runner/index.mjs --job ${a} --token ${b}`,
}));
vi.mock('../../data/secrets', () => ({ storeSecret: (o: string, l: string, v: string) => storeSecret(o, l, v) }));

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: { orgId: 'org-a' } }),
}));

import { OrgHostingPanel } from './OrgHostingPanel';

describe('OA-15 org hosting and database (F16)', () => {
  beforeEach(() => {
    listHostingConnections.mockResolvedValue([]);
    saveHostingConnection.mockResolvedValue('conn-1');
    setConnectionSecret.mockResolvedValue(undefined);
    createMigrationJob.mockResolvedValue({ jobId: 'job-1', jobToken: 'tok' });
    storeSecret.mockResolvedValue({ ok: true, secretId: 'sec-1', masked: '•••• 1234' });
  });

  it('shows an empty state when no connection exists', async () => {
    render(<OrgHostingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-hosting-empty')).toBeTruthy());
  });

  it('refuses an incomplete form before any call', async () => {
    render(<OrgHostingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-hosting-save')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-hosting-save'));
    await waitFor(() => expect(screen.getByTestId('oa-hosting-action-error').textContent).toContain('required'));
    expect(saveHostingConnection).not.toHaveBeenCalled();
  });

  it('stores the password through secrets-put, never through SQL (F5)', async () => {
    render(<OrgHostingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-hosting-save')).toBeTruthy());
    fireEvent.change(screen.getByTestId('oa-hosting-label'), { target: { value: 'Prod' } });
    fireEvent.change(screen.getByTestId('oa-hosting-host'), { target: { value: 'db.example' } });
    fireEvent.change(screen.getByTestId('oa-hosting-database'), { target: { value: 'provio' } });
    fireEvent.change(screen.getByTestId('oa-hosting-username'), { target: { value: 'provio' } });
    fireEvent.change(screen.getByTestId('oa-hosting-password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByTestId('oa-hosting-save'));
    await waitFor(() => expect(saveHostingConnection).toHaveBeenCalled());
    // The password is passed to storeSecret, and the connection save payload has no password field.
    await waitFor(() => expect(storeSecret).toHaveBeenCalledWith('org-a', 'hosting:Prod', 'hunter2'));
    const payload = saveHostingConnection.mock.calls[0][0];
    expect(JSON.stringify(payload)).not.toContain('hunter2');
    await waitFor(() => expect(setConnectionSecret).toHaveBeenCalledWith('conn-1', 'sec-1', '•••• 1234'));
  });

  it('starts a migration job and shows the runner command', async () => {
    listHostingConnections.mockResolvedValue([{
      id: 'conn-1', label: 'Prod', kind: 'managed_postgres', host: 'db', port: 5432, database: 'provio',
      username: 'u', sslMode: 'require', passwordMasked: '•••• 1234', lastTestAt: null,
      lastTestResult: null, lastTestDetail: null,
    }]);
    render(<OrgHostingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-hosting-migrate-conn-1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('oa-hosting-migrate-conn-1'));
    await waitFor(() => expect(screen.getByTestId('oa-hosting-runner-command').textContent).toContain('migration-runner'));
  });

  it('offers a hold-to-confirm retire control', async () => {
    listHostingConnections.mockResolvedValue([{
      id: 'conn-1', label: 'Prod', kind: 'managed_postgres', host: 'db', port: 5432, database: 'provio',
      username: 'u', sslMode: 'require', passwordMasked: null, lastTestAt: null,
      lastTestResult: 'ok', lastTestDetail: null,
    }]);
    render(<OrgHostingPanel />);
    await waitFor(() => expect(screen.getByTestId('oa-hosting-retire-conn-1')).toBeTruthy());
  });
});
