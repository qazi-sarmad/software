import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const generateSigningKey = vi.fn();
const signPack = vi.fn();
const verifyPack = vi.fn();
const listRulePacks = vi.fn();
const listRulePackRefusals = vi.fn();
const registerSigningKey = vi.fn();
const saveSignedRulePackArtifact = vi.fn();
const releaseRulePack = vi.fn();

vi.mock('../../data/rulePacks', () => ({
  listRulePacks: () => listRulePacks(),
  listRulePackRefusals: () => listRulePackRefusals(),
  registerSigningKey: (...a: unknown[]) => registerSigningKey(...a),
  saveSignedRulePackArtifact: (...a: unknown[]) => saveSignedRulePackArtifact(...a),
  releaseRulePack: (...a: unknown[]) => releaseRulePack(...a),
  generateSigningKey: (...a: unknown[]) => generateSigningKey(...a),
  signPack: (...a: unknown[]) => signPack(...a),
  verifyPack: (...a: unknown[]) => verifyPack(...a),
  buildAdhocRule: vi.fn(),
  runAdhocRule: vi.fn(),
}));

const userRef = { current: { id: 'u1', role: 'org_admin', rights: { edit_config: true }, orgId: 'org-a' } };
vi.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: userRef.current }) }));

import { RulePackPanel } from './RulePackPanel';
import { RuleRegistry, systeligonPopulationRules } from '../../lib/systeligon';

const draft = { id: 'p1', name: 'audit-default', version: 1, target: 'population', contentHash: 'a'.repeat(64), released: false, keyId: 'k1', signedAt: '2026-10-29T00:00:00Z', createdAt: '2026-10-29T00:00:00Z' };
const released = { ...draft, id: 'p2', version: 2, contentHash: 'b'.repeat(64), released: true };

describe('OA-33 rule-pack management (S10/S11)', () => {
  beforeEach(() => {
    userRef.current = { id: 'u1', role: 'org_admin', rights: { edit_config: true }, orgId: 'org-a' } as never;
    listRulePacks.mockResolvedValue([released, draft]);
    listRulePackRefusals.mockResolvedValue([]);
    releaseRulePack.mockResolvedValue({ ok: true });
  });

  it('denies a caller without edit_config the write controls, and says why', async () => {
    userRef.current = { id: 'u2', role: 'preparer', rights: { edit_config: false }, orgId: 'org-a' } as never;
    render(<RulePackPanel />);
    await waitFor(() => expect(screen.getByTestId('rule-pack-panel')).toBeTruthy());
    expect(screen.getByTestId('rule-pack-rights-note')).toBeTruthy();
    expect((screen.getByTestId('rule-pack-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists packs with their version and released/draft state', async () => {
    render(<RulePackPanel />);
    await waitFor(() => expect(screen.getByTestId('rule-pack-row-0')).toBeTruthy());
    expect(screen.getByTestId('rule-pack-released-0')).toBeTruthy();
    expect(screen.getByTestId('rule-pack-draft-1')).toBeTruthy();
  });

  it('offers release only on a draft, and shows the released pack without one', async () => {
    render(<RulePackPanel />);
    await waitFor(() => expect(screen.getByTestId('rule-pack-row-0')).toBeTruthy());
    expect(screen.queryByTestId('rule-pack-release-0')).toBeNull();
    expect(screen.getByTestId('rule-pack-release-1')).toBeTruthy();
  });

  it('shows the refusal log when a save was refused', async () => {
    listRulePackRefusals.mockResolvedValue([
      { id: 'r1', name: 'audit-default', version: 3, reason: 'bad_signature', detail: 'key mismatch', createdAt: '2026-10-29T01:00:00Z' },
    ]);
    render(<RulePackPanel />);
    await waitFor(() => expect(screen.getByTestId('rule-pack-refusal-list')).toBeTruthy());
    expect(screen.getByTestId('rule-pack-refusal-r1').textContent).toContain('bad_signature');
  });

  it('says no pack is refused when the log is empty', async () => {
    render(<RulePackPanel />);
    await waitFor(() => expect(screen.getByTestId('rule-pack-refusals-empty')).toBeTruthy());
  });

  it('shows an empty state before any pack exists', async () => {
    listRulePacks.mockResolvedValue([]);
    render(<RulePackPanel />);
    await waitFor(() => expect(screen.getByTestId('rule-pack-empty')).toBeTruthy());
  });

  it('is honest when the pack list cannot be read', async () => {
    listRulePacks.mockRejectedValue(new Error('network down'));
    render(<RulePackPanel />);
    await waitFor(() => expect(screen.getByTestId('rule-pack-load-error').textContent).toContain('network down'));
  });

  // F128 — the append-only registry is on the screen's path, not just in the library.
  it('reports the shipped rule base from the append-only RuleRegistry (F128)', async () => {
    render(<RulePackPanel />);
    await waitFor(() => expect(screen.getByTestId('rule-pack-registry')).toBeTruthy());
    const expected = new RuleRegistry();
    expected.registerAll(systeligonPopulationRules);
    const shown = screen.getByTestId('rule-pack-registry').textContent ?? '';
    expect(shown).toContain(`${expected.history().length} rule version(s)`);
    expect(shown).toContain(`${new Set(expected.history().map((h) => h.id)).size} id(s)`);
  });

  it('saves the shipped pack assembled by packRules over the registry (F128)', async () => {
    generateSigningKey.mockResolvedValue({ publicKeyHex: 'ab'.repeat(32), privateKey: {} });
    signPack.mockResolvedValue({ pack: { name: 'audit-default', version: 1, target: 'population', rules: [] }, contentHash: 'c'.repeat(64), signatureHex: '00', subject: { signedAt: '2026-10-29T00:00:00Z' } });
    verifyPack.mockResolvedValue({ ok: true });
    saveSignedRulePackArtifact.mockResolvedValue({ ok: true });
    render(<RulePackPanel />);
    await waitFor(() => expect(screen.getByTestId('rule-pack-row-0')).toBeTruthy());
    fireEvent.click(screen.getByTestId('rule-pack-key-generate'));
    await waitFor(() => expect((screen.getByTestId('rule-pack-save') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('rule-pack-save'));
    // The pack handed to `signPack` carries every released shipped rule the registry holds.
    await waitFor(() => expect(signPack).toHaveBeenCalled());
    const signedPack = signPack.mock.calls[0][1] as { rules: unknown[] };
    const released = systeligonPopulationRules.filter((r) => r.status === 'released');
    expect(signedPack.rules.length).toBe(released.length);
  });
});
