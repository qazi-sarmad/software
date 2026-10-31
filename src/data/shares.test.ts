import { describe, expect, it, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
const from = vi.fn();
vi.mock('./client', () => ({
  getClient: () => ({ rpc: (...a: unknown[]) => rpc(...a), from: (...a: unknown[]) => from(...a) }),
}));

import {
  adoptConfig, distributeConfig, grantJointShare, listAssociatedOrgs, listConfigDistributions,
  listJointShares, listJointSharesWithMe, listShareableEngagements, revokeJointShare,
} from './shares';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('group / joint-audit sharing data module', () => {
  it('maps a granted joint-audit share, including its live flag', async () => {
    rpc.mockResolvedValue({
      data: [{
        id: 's1', engagement_id: 'e1', engagement_title: 'Payroll', owner_org_id: 'a',
        counterparty_org_id: 'b', counterparty_name: 'Beta', rights: 'edit',
        granted_at: '2026-10-25T00:00:00Z', expires_at: null, revoked_at: null,
        revoke_reason: null, live: true,
      }],
      error: null,
    });
    const rows = await listJointShares();
    expect(rpc).toHaveBeenCalledWith('joint_shares_get');
    expect(rows).toEqual([{
      id: 's1', engagementId: 'e1', engagementTitle: 'Payroll', ownerOrgId: 'a',
      counterpartyOrgId: 'b', counterpartyName: 'Beta', rights: 'edit',
      grantedAt: '2026-10-25T00:00:00Z', expiresAt: null, revokedAt: null,
      revokeReason: null, live: true,
    }]);
  });

  it('maps the joint audits shared with me', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 's2', engagement_id: 'e9', engagement_title: 'Treasury', owner_org_id: 'a', owner_name: 'Alpha', rights: 'edit', granted_at: '2026-10-25T00:00:00Z', expires_at: null, live: true }],
      error: null,
    });
    const rows = await listJointSharesWithMe();
    expect(rows[0]).toMatchObject({ id: 's2', engagementTitle: 'Treasury', ownerName: 'Alpha', live: true });
  });

  it('lists the RLS-scoped shareable engagements (real database ids, not demo ids)', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ id: 'e0000000-0000-4000-8000-000000000001', title: 'Payroll audit' }], error: null,
    });
    const select = vi.fn().mockReturnValue({ order });
    from.mockReturnValue({ select });
    expect(await listShareableEngagements()).toEqual([
      { id: 'e0000000-0000-4000-8000-000000000001', title: 'Payroll audit' },
    ]);
    expect(from).toHaveBeenCalledWith('engagements');

    const orderErr = vi.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    from.mockReturnValue({ select: vi.fn().mockReturnValue({ order: orderErr }) });
    expect(await listShareableEngagements()).toEqual([]);
  });

  it('returns an empty list when a read fails rather than throwing', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    expect(await listJointShares()).toEqual([]);
    expect(await listJointSharesWithMe()).toEqual([]);
    expect(await listAssociatedOrgs()).toEqual([]);
    expect(await listConfigDistributions()).toEqual([]);
  });

  it('grants a joint share and surfaces the database refusal reason verbatim', async () => {
    rpc.mockResolvedValue({ data: 'share-9', error: null });
    expect(await grantJointShare('e1', 'b', null)).toEqual({ ok: true, id: 'share-9' });
    expect(rpc).toHaveBeenCalledWith('joint_share_grant', { p_engagement_id: 'e1', p_counterparty_org_id: 'b', p_expires_at: null });

    rpc.mockResolvedValue({ data: null, error: { message: 'not allowed: the two organisations are not associated (group companies)' } });
    expect(await grantJointShare('e1', 'b', null)).toEqual({ ok: false, reason: 'not allowed: the two organisations are not associated (group companies)' });
  });

  it('revokes a joint share with the reason', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await revokeJointShare('s1', 'audit concluded')).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('joint_share_revoke', { p_share_id: 's1', p_reason: 'audit concluded' });
  });

  it('lists associated orgs and distributes/adopts configuration', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'b', name: 'Beta' }], error: null });
    expect(await listAssociatedOrgs()).toEqual([{ id: 'b', name: 'Beta' }]);

    rpc.mockResolvedValue({ data: 'd1', error: null });
    expect(await distributeConfig('b', ['sampling'])).toEqual({ ok: true, id: 'd1' });
    expect(rpc).toHaveBeenCalledWith('group_distribute_config', { p_member_org_id: 'b', p_keys: ['sampling'] });

    rpc.mockResolvedValue({ data: 2, error: null });
    expect(await adoptConfig('d1')).toEqual({ ok: true, keys: 2 });
  });

  it('maps config distributions', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 'd1', parent_org_id: 'a', parent_name: 'Alpha', member_org_id: 'b', member_name: 'Beta', keys: ['sampling'], distributed_at: '2026-10-25T00:00:00Z', revoked_at: null }],
      error: null,
    });
    const rows = await listConfigDistributions();
    expect(rows[0]).toMatchObject({ id: 'd1', parentName: 'Alpha', memberName: 'Beta', keys: ['sampling'] });
  });
});
