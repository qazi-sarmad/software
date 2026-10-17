import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FloatingWindowManager, recordTypeToPath, type OpenWindow } from './FloatingWindowManager';

vi.mock('./RecordContent', () => ({
  INSPECTOR_TITLES: { audit_file: 'Engagement Audit File', cap_inspector: 'CAP Details' } as Record<string, string>,
  RecordContent: ({ type }: { type: string }) => <div>content:{type}</div>,
}));

const win = (over: Partial<OpenWindow> = {}): OpenWindow => ({
  windowId: 'audit_file:e1',
  recordType: 'audit_file',
  recordId: 'e1',
  title: 'Engagement Audit File',
  ...over,
});

describe('FloatingWindowManager (5C, §17.1)', () => {
  it('renders one non-blocking window per record and never sets aria-modal', () => {
    render(<FloatingWindowManager windows={[win()]} onCloseWindow={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Engagement Audit File' });
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(screen.getByTestId('floating-window-audit_file:e1')).toBeTruthy();
  });

  it('opens several records at once', () => {
    render(
      <FloatingWindowManager
        windows={[win(), win({ windowId: 'cap_inspector:c1', recordType: 'cap_inspector', recordId: 'c1', title: 'CAP Details' })]}
        onCloseWindow={() => {}}
      />
    );
    expect(screen.getByTestId('floating-window-audit_file:e1')).toBeTruthy();
    expect(screen.getByTestId('floating-window-cap_inspector:c1')).toBeTruthy();
  });

  it('minimises to a dock and restores from it', async () => {
    render(<FloatingWindowManager windows={[win()]} onCloseWindow={() => {}} />);
    fireEvent.click(screen.getByLabelText('Minimise window'));
    // AnimatePresence keeps the exiting node until its exit animation ends, so assert the dock
    // (the observable result) rather than the node's absence.
    const dock = await screen.findByTestId('floating-window-dock');
    expect(dock).toBeTruthy();
    fireEvent.click(screen.getByTitle('Restore window'));
    expect(screen.getByTestId('floating-window-audit_file:e1')).toBeTruthy();
  });

  it('closes a window through the caller', () => {
    const onClose = vi.fn();
    render(<FloatingWindowManager windows={[win()]} onCloseWindow={onClose} />);
    fireEvent.click(screen.getByLabelText('Close window'));
    expect(onClose).toHaveBeenCalledWith('audit_file:e1');
  });

  it('maps record types to /view URL segments', () => {
    expect(recordTypeToPath('audit_file')).toBe('engagement');
    expect(recordTypeToPath('workbench')).toBe('workpaper');
    expect(recordTypeToPath('cap_inspector')).toBe('cap');
    expect(recordTypeToPath('observation')).toBe('observation');
  });
});
