import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listRecipients = vi.fn();
const addRecipient = vi.fn();
const removeRecipient = vi.fn();

vi.mock('../../data/platformSettings', async () => {
  const actual = await vi.importActual<typeof import('../../data/platformSettings')>('../../data/platformSettings');
  return {
    looksLikeEmail: actual.looksLikeEmail,
    listRecipients: () => listRecipients(),
    addRecipient: (a: string) => addRecipient(a),
    removeRecipient: (id: string) => removeRecipient(id),
  };
});

import { SuperAdminRecipients } from './SuperAdminRecipients';

describe('SA-05 platform notification recipients (F7)', () => {
  beforeEach(() => {
    listRecipients.mockResolvedValue([{ id: 'r1', address: 'ops@qscorp.example' }]);
    addRecipient.mockResolvedValue({ ok: true });
    removeRecipient.mockResolvedValue({ ok: true });
  });

  it('lists the recipients', async () => {
    render(<SuperAdminRecipients />);
    await waitFor(() => expect(screen.getByTestId('recipient-ops@qscorp.example')).toBeTruthy());
  });

  it('refuses a bad address before calling the server', async () => {
    render(<SuperAdminRecipients />);
    await waitFor(() => expect(screen.getByTestId('superadmin-recipients-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('superadmin-recipients-input'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByTestId('superadmin-recipients-add'));
    await waitFor(() => expect(screen.getByTestId('superadmin-recipients-result').textContent).toContain('email address'));
    expect(addRecipient).not.toHaveBeenCalled();
  });

  it('adds a valid address', async () => {
    render(<SuperAdminRecipients />);
    await waitFor(() => expect(screen.getByTestId('superadmin-recipients-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('superadmin-recipients-input'), { target: { value: 'security@qscorp.example' } });
    fireEvent.click(screen.getByTestId('superadmin-recipients-add'));
    await waitFor(() => expect(addRecipient).toHaveBeenCalledWith('security@qscorp.example'));
  });

  it('shows an empty state', async () => {
    listRecipients.mockResolvedValue([]);
    render(<SuperAdminRecipients />);
    await waitFor(() => expect(screen.getByTestId('superadmin-recipients-empty')).toBeTruthy());
  });
});
