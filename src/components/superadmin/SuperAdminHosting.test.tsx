import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const getHostingCatalogue = vi.fn();
const saveHostingRule = vi.fn();

vi.mock('../../data/hostingFit', async () => {
  const actual = await vi.importActual<typeof import('../../data/hostingFit')>('../../data/hostingFit');
  return {
    getHostingCatalogue: () => getHostingCatalogue(),
    saveHostingRule: (r: unknown) => saveHostingRule(r),
    saveHostingConnection: actual.saveHostingConnection,
    setConnectionSecret: actual.setConnectionSecret,
    listHostingConnections: actual.listHostingConnections,
    createMigrationJob: actual.createMigrationJob,
    listMigrationJobs: actual.listMigrationJobs,
    migrationRunnerCommand: actual.migrationRunnerCommand,
  };
});

import { SuperAdminHosting } from './SuperAdminHosting';

const catalogue = {
  catalogue: [
    { key: 'supabase_cloud', label: 'Supabase Cloud', aliases: ['supabase'], engine: 'postgres', hostingKind: 'supabase_cloud', notes: '', isSupported: true },
    { key: 'rds', label: 'Amazon RDS', aliases: ['Aurora'], engine: 'postgres', hostingKind: 'managed_postgres', notes: '', isSupported: true },
  ],
  rules: [
    { key: 'engine.postgres.required', field: 'engine', operator: 'neq', value: 'postgres', severity: 'blocker', message: 'Engine must be PostgreSQL.', costTier: 'custom_quote', enabled: true },
  ],
};

describe('SA-10 hosting fit check (F16)', () => {
  beforeEach(() => {
    getHostingCatalogue.mockResolvedValue(catalogue);
    saveHostingRule.mockResolvedValue(undefined);
  });

  it('loads the catalogue and shows a verdict', async () => {
    render(<SuperAdminHosting />);
    await waitFor(() => expect(screen.getByTestId('sa-hosting-verdict-value')).toBeTruthy());
    // Default answers are a Supabase cloud project: no blockers -> GREEN.
    expect(screen.getByTestId('sa-hosting-verdict-value').textContent).toBe('GREEN');
  });

  it('searches the stack catalogue on an alias', async () => {
    render(<SuperAdminHosting />);
    await waitFor(() => expect(screen.getByTestId('sa-hosting-search')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-hosting-search'), { target: { value: 'aurora' } });
    await waitFor(() => expect(screen.getByTestId('sa-hosting-stack-rds')).toBeTruthy());
    expect(screen.queryByTestId('sa-hosting-stack-supabase_cloud')).toBeNull();
  });

  it('turns RED for a non-Postgres engine', async () => {
    render(<SuperAdminHosting />);
    await waitFor(() => expect(screen.getByTestId('sa-hosting-field-engine')).toBeTruthy());
    fireEvent.change(screen.getByTestId('sa-hosting-field-engine'), { target: { value: 'mysql' } });
    await waitFor(() => expect(screen.getByTestId('sa-hosting-verdict-value').textContent).toBe('RED'));
    expect(screen.getByTestId('sa-hosting-cost').textContent).toContain('custom_quote');
  });

  it('shows an error state when the catalogue fails', async () => {
    getHostingCatalogue.mockRejectedValue(new Error('nope'));
    render(<SuperAdminHosting />);
    await waitFor(() => expect(screen.getByTestId('sa-hosting-error')).toBeTruthy());
  });

  it('saves a rule through the data module, never by JSON', async () => {
    render(<SuperAdminHosting />);
    await waitFor(() => expect(screen.getByTestId('sa-hosting-tab-rules')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sa-hosting-tab-rules'));
    await waitFor(() => expect(screen.getByTestId('sa-hosting-rule-enabled-engine.postgres.required')).toBeTruthy());
    fireEvent.click(screen.getByTestId('sa-hosting-rule-enabled-engine.postgres.required'));
    await waitFor(() => expect(saveHostingRule).toHaveBeenCalled());
  });
});
