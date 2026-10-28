import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import {
  buildAttestationPackage,
  merkleRootOfLeafHashes,
  type AttestationInput,
} from '../../lib/attestation';
import { signSubject, toHex, type CryptoLike, type SignatureSubject } from '../../lib/anchoring';
import { merkleLeafHash } from '../../lib/writing/merkle';

const listAttestationSubjects = vi.fn();
const loadAttestationInput = vi.fn();

vi.mock('../../data/attestation', () => ({
  listAttestationSubjects: () => listAttestationSubjects(),
  loadAttestationInput: (kind: string, id: string, at: string) => loadAttestationInput(kind, id, at),
}));

vi.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: { id: 'u1', role: 'cia', rights: { review_and_approve: true }, orgId: 'org-a' } }),
}));

import { AttestationPanel } from './AttestationPanel';

const crypto = webcrypto as unknown as CryptoLike;

async function realInput(subjectId: string): Promise<AttestationInput> {
  const pair = (await webcrypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify']
  )) as CryptoKeyPair;
  const raw = (await webcrypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
  const priv = (await webcrypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  const pubHex = toHex(new Uint8Array(raw));
  const leaves = [
    { claimId: 'c1', leafHash: await merkleLeafHash('one') },
    { claimId: 'c2', leafHash: await merkleLeafHash('two') },
  ];
  const graphRoot = await merkleRootOfLeafHashes(crypto, leaves.map((l) => l.leafHash));
  const subject: SignatureSubject = {
    kind: 'report_graph_root', subjectId, rootHash: graphRoot,
    signedAt: '2026-10-27T00:00:00Z', keyId: 'key-1',
  };
  const signature = await signSubject(crypto, subject, priv);
  return {
    generatedAt: '2026-10-27T09:00:00Z',
    subject: { kind: 'report_graph_root', id: subjectId, label: 'Report v1' },
    roots: [{ name: 'graph_root', hash: graphRoot }],
    versions: { engine: '1.0.0', template: 'M1@1', phraseLibrary: '1.0.0', rulePacks: [] },
    leaves,
    keys: [{ keyId: 'key-1', algorithm: 'Ed25519', publicKey: pubHex }],
    signatures: [{
      kind: 'report_graph_root', subjectId, rootHash: graphRoot, keyId: 'key-1',
      algorithm: 'Ed25519', signature, signedAt: subject.signedAt,
    }],
    timestamps: [],
    ledgerSeq: '1',
  };
}

describe('OA-30 attestation panel (T5)', () => {
  beforeEach(() => {
    listAttestationSubjects.mockReset();
    loadAttestationInput.mockReset();
  });

  it('shows the guided empty state when nothing is signed', async () => {
    listAttestationSubjects.mockResolvedValue([]);
    render(<AttestationPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-30-empty')).toBeTruthy());
    expect(screen.getByTestId('OA-30-headline').textContent).toContain('attestation');
  });

  it('lists a signed subject', async () => {
    listAttestationSubjects.mockResolvedValue([{
      kind: 'report_graph_root', subjectId: 'rv-1', rootHash: 'a'.repeat(64),
      keyId: 'key-1', signedAt: '2026-10-27T00:00:00Z', hasTimestamp: true,
    }]);
    render(<AttestationPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-30-subject-rv-1')).toBeTruthy());
    expect(screen.getByTestId('OA-30-subjects')).toBeTruthy();
  });

  it('builds and verifies a package in place', async () => {
    const input = await realInput('rv-1');
    listAttestationSubjects.mockResolvedValue([{
      kind: 'report_graph_root', subjectId: 'rv-1', rootHash: input.roots[0].hash,
      keyId: 'key-1', signedAt: '2026-10-27T00:00:00Z', hasTimestamp: false,
    }]);
    loadAttestationInput.mockResolvedValue(input);
    render(<AttestationPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-30-build-rv-1')).toBeTruthy());

    const button = screen.getByTestId('OA-30-build-rv-1') as HTMLButtonElement;
    button.click();

    await waitFor(() => expect(screen.getByTestId('OA-30-package')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('OA-30-verdict').textContent).toContain('Verified'));
    expect(screen.getByTestId('OA-30-package-root').textContent).toMatch(/^[0-9a-f]{64}$/);
    expect(screen.getByTestId('OA-30-merkle-root').textContent).toBe(input.roots[0].hash);
    expect(screen.getByTestId('OA-30-export')).toBeTruthy();
  });

  it('reports an error when the subject has no signed material', async () => {
    listAttestationSubjects.mockResolvedValue([{
      kind: 'report_graph_root', subjectId: 'rv-2', rootHash: 'a'.repeat(64),
      keyId: 'key-1', signedAt: '2026-10-27T00:00:00Z', hasTimestamp: false,
    }]);
    loadAttestationInput.mockResolvedValue(null);
    render(<AttestationPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-30-build-rv-2')).toBeTruthy());
    (screen.getByTestId('OA-30-build-rv-2') as HTMLButtonElement).click();
    await waitFor(() => expect(screen.getByTestId('OA-30-error')).toBeTruthy());
  });

  it('reports a load error without crashing', async () => {
    listAttestationSubjects.mockRejectedValue(new Error('not permitted'));
    render(<AttestationPanel />);
    await waitFor(() => expect(screen.getByTestId('OA-30-load-error')).toBeTruthy());
  });

  it('round-trips a package through the exported serialisation', async () => {
    const input = await realInput('rv-3');
    const built = await buildAttestationPackage(crypto, input);
    // The serialiser is a pure-layer concern; the panel never calls JSON itself.
    const mod = await import('../../lib/attestation');
    const text = mod.serialiseAttestationPackage(built);
    expect(mod.parseAttestationPackage(text)?.packageRoot).toBe(built.packageRoot);
  });
});
