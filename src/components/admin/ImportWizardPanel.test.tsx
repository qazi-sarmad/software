import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { ImportWizardPanel } from './ImportWizardPanel';
import { AppProvider } from '../../context/AppContext';
import { ThemeProvider } from '../../context/ThemeContext';
import { testSeed, testUser } from '../../test/testUsers';
import type { Role } from '../../types';

const listJobs = vi.fn();
vi.mock('../../data/imports', async (orig) => {
  const actual = await orig<typeof import('../../data/imports')>();
  return { ...actual, listImportJobs: (...a: unknown[]) => listJobs(...a) };
});

afterEach(() => {
  cleanup();
  listJobs.mockReset();
});

const renderAs = (role: Role) =>
  render(
    <ThemeProvider>
      <AppProvider user={testUser(role)} seed={testSeed}>
        <ImportWizardPanel />
      </AppProvider>
    </ThemeProvider>
  );

/** Drive the hidden file input with a synthetic File whose bytes we control. */
function chooseFile(bytes: Uint8Array, name: string, type = 'application/octet-stream') {
  const input = screen.getByTestId('import-file-input') as HTMLInputElement;
  const file = new File([bytes as BlobPart], name, { type });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ImportWizardPanel (S17 inventory)', () => {
  it('denies a caller without manage_engagements', () => {
    listJobs.mockResolvedValue([]);
    renderAs('preparer');
    expect(screen.getByTestId('import-no-right')).toBeTruthy();
  });

  it('shows the inventory counts for a chosen file', async () => {
    listJobs.mockResolvedValue([]);
    renderAs('cia');
    // A PDF has a real magic-byte signature, so the inventory reports it as importable.
    chooseFile(new TextEncoder().encode('%PDF-1.7\n%%EOF'), 'note.pdf', 'application/pdf');
    await waitFor(() => expect(screen.getByTestId('import-inventory')).toBeTruthy());
    expect(screen.getByTestId('import-inventory-counts').textContent).toContain('1 importable');
  });

  it('reports an unrecognised file as unrecognised, never silently dropped', async () => {
    listJobs.mockResolvedValue([]);
    renderAs('cia');
    chooseFile(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]), 'mystery.bin');
    await waitFor(() => expect(screen.getByTestId('import-inventory')).toBeTruthy());
    expect(screen.getByTestId('import-inventory-counts').textContent).toContain('1 unrecognised');
  });
});
