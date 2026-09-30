import { describe, expect, it } from 'vitest';
import { appendLedgerEntry, generateInitialLedger, matchesSignedState, verifyChain } from './ledger';

describe('Task 1: Audit Signatures Ledger Hash-Chain', () => {
  it('Appends entries and maintains cryptographic chain integrity', async () => {
    let chain: any[] = [];

    // Entry 1: test_finalize
    const entry1 = await appendLedgerEntry(chain, {
      actorId: 'usr-prep-1',
      actorName: 'Alice Auditor',
      actorRole: 'preparer',
      eventType: 'test_finalize',
      entityId: 'ent-a',
      recordId: 'wp-1',
      recordType: 'workpaper',
      payloadSummary: 'Finalized 25 sample items for LCR test',
      payloadData: { samplesTested: 25, exceptions: 0 },
    });
    chain = [...chain, entry1];

    expect(entry1.seq).toBe(1);
    expect(entry1.prevHash).toBe('0000000000000000000000000000000000000000000000000000000000000000');
    expect(entry1.hash).toBeDefined();

    // Entry 2: reviewer_sign_off
    const entry2 = await appendLedgerEntry(chain, {
      actorId: 'usr-rev-1',
      actorName: 'Bob Reviewer',
      actorRole: 'reviewer',
      eventType: 'reviewer_sign_off',
      entityId: 'ent-a',
      recordId: 'wp-1',
      recordType: 'workpaper',
      payloadSummary: 'Reviewed and concurred with test conclusion',
    });
    chain = [...chain, entry2];

    expect(entry2.seq).toBe(2);
    expect(entry2.prevHash).toBe(entry1.hash);

    // Verify chain is valid
    const verification = await verifyChain(chain);
    expect(verification.valid).toBe(true);
    expect(verification.brokenSeq).toBeUndefined();
  });

  it('Enforces reopen justification of at least 10 characters', async () => {
    const chain: any[] = [];

    // Short justification (< 10 chars) should throw
    await expect(
      appendLedgerEntry(chain, {
        actorId: 'usr-cia',
        actorName: 'Carol CIA',
        actorRole: 'cia',
        eventType: 'reopen',
        entityId: 'ent-a',
        recordId: 'wp-1',
        recordType: 'workpaper',
        payloadSummary: 'Reopening workpaper',
        justification: 'Too short',
      })
    ).rejects.toThrow('justification note of at least 10 characters');

    // Valid justification (>= 10 chars) should succeed
    const validEntry = await appendLedgerEntry(chain, {
      actorId: 'usr-cia',
      actorName: 'Carol CIA',
      actorRole: 'cia',
      eventType: 'reopen',
      entityId: 'ent-a',
      recordId: 'wp-1',
      recordType: 'workpaper',
      payloadSummary: 'Reopening workpaper',
      justification: 'Requested by external regulator for supplemental sampling',
    });

    expect(validEntry.seq).toBe(1);
    expect(validEntry.justification).toBe('Requested by external regulator for supplemental sampling');
  });

  it('Detects tampering in the hash chain and pinpoints the broken sequence number', async () => {
    let chain: any[] = [];

    const entry1 = await appendLedgerEntry(chain, {
      actorId: 'usr-1',
      actorName: 'User 1',
      actorRole: 'preparer',
      eventType: 'test_finalize',
      entityId: 'ent-a',
      recordId: 'wp-1',
      recordType: 'workpaper',
      payloadSummary: 'Block 1',
    });
    chain = [entry1];

    const entry2 = await appendLedgerEntry(chain, {
      actorId: 'usr-2',
      actorName: 'User 2',
      actorRole: 'reviewer',
      eventType: 'reviewer_sign_off',
      entityId: 'ent-a',
      recordId: 'wp-1',
      recordType: 'workpaper',
      payloadSummary: 'Block 2',
    });
    chain = [...chain, entry2];

    const entry3 = await appendLedgerEntry(chain, {
      actorId: 'usr-3',
      actorName: 'User 3',
      actorRole: 'cia',
      eventType: 'audit_sign_off',
      entityId: 'ent-a',
      recordId: 'eng-1',
      recordType: 'engagement',
      payloadSummary: 'Block 3',
    });
    chain = [...chain, entry3];

    // Tamper with entry 2 payloadHash
    const tamperedChain = [
      entry1,
      { ...entry2, payloadHash: 'tampered_hash_value_123' },
      entry3,
    ];

    const check = await verifyChain(tamperedChain);
    expect(check.valid).toBe(false);
    expect(check.brokenSeq).toBe(2);
  });

  it('matchesSignedState returns true only when hashes match', () => {
    const hash = 'a94a8fe5ccb19ba61c4c0873d391e987982fbbd3';
    expect(matchesSignedState(hash, hash)).toBe(true);
    expect(matchesSignedState(hash, 'drifted_state')).toBe(false);
    expect(matchesSignedState(hash, undefined)).toBe(false);
  });

  it('Verifies that an untouched seeded ledger verifies successfully', async () => {
    const seed = await generateInitialLedger();
    const result = await verifyChain(seed);
    expect(result.valid).toBe(true);
    expect(result.brokenSeq).toBeUndefined();
  });

  it('Tampering with any field in the seed ledger fails at the correct seq', async () => {
    const seed = await generateInitialLedger();

    // Tampering seq 1 actorRole
    const tampered1 = seed.map((e) => (e.seq === 1 ? { ...e, actorRole: 'reviewer' as any } : e));
    const res1 = await verifyChain(tampered1);
    expect(res1.valid).toBe(false);
    expect(res1.brokenSeq).toBe(1);

    // Tampering seq 2 payloadHash
    const tampered2 = seed.map((e) => (e.seq === 2 ? { ...e, payloadHash: 'tampered_hash_value' } : e));
    const res2 = await verifyChain(tampered2);
    expect(res2.valid).toBe(false);
    expect(res2.brokenSeq).toBe(2);

    // Tampering seq 3 timestamp
    const tampered3 = seed.map((e) => (e.seq === 3 ? { ...e, timestamp: '2027-01-01T00:00:00Z' } : e));
    const res3 = await verifyChain(tampered3);
    expect(res3.valid).toBe(false);
    expect(res3.brokenSeq).toBe(3);
  });
});
