import React, { useCallback, useEffect, useState } from 'react';
import {
  configurePlatformEmailSender, createTenant, listTenants, provisioningStatus, seedOrgRoles,
  setInviteCap, setTenantStatus,
  type ProvisioningStatus, type TenantRow,
} from '../../data/platform';
import { listFeatureCatalogue, setEntitlement, type FeatureRow } from '../../data/entitlements';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Check, Building, Send, Zap, Users, Shield } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Guided client provisioning (WP3, SA-16).
 *
 * A non-technical Super Admin stands up client N from zero with no further code: create the org,
 * set its entitlements and invite cap, configure the platform sender, invite the first Org Admin,
 * and confirm a first engagement can be created. Every action is a platform_* RPC; the database
 * refuses a tenant session, and the readiness report it reads back is counts and booleans only, so
 * the platform role never reads tenant content (L2). Non-blocking: refusals render inline.
 */
export const SuperAdminProvisioning: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [catalogue, setCatalogue] = useState<FeatureRow[]>([]);

  // Step 1: create the organisation.
  const [orgName, setOrgName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [createReason, setCreateReason] = useState('');
  const [createdId, setCreatedId] = useState('');
  const [createError, setCreateError] = useState('');
  const [busy, setBusy] = useState(false);

  // Steps 2-6: entitlements, cap, sender, first admin, readiness.
  const [featureKey, setFeatureKey] = useState('');
  const [entitleReason, setEntitleReason] = useState('');
  const [capDraft, setCapDraft] = useState('20');
  const [capReason, setCapReason] = useState('');
  const [senderName, setSenderName] = useState('Provio');
  const [senderFrom, setSenderFrom] = useState('');
  const [senderReply, setSenderReply] = useState('');
  const [senderReason, setSenderReason] = useState('');
  const [status, setStatus] = useState<ProvisioningStatus | null>(null);
  const [result, setResult] = useState<DataResult | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [rows, cat] = await Promise.all([listTenants(), listFeatureCatalogue()]);
      setTenants(rows);
      setCatalogue(cat);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the provisioning data.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshStatus = useCallback(async (id: string) => {
    if (!id) { setStatus(null); return; }
    try {
      setStatus(await provisioningStatus(id));
    } catch {
      setStatus(null);
    }
  }, []);

  const run = async (action: () => Promise<DataResult>) => {
    setBusy(true);
    const r = await action();
    setResult(r);
    setBusy(false);
    return r;
  };

  const onCreate = async () => {
    setBusy(true);
    setCreateError('');
    const r = await createTenant(orgName, adminEmail, createReason);
    if (r.ok) {
      setCreatedId(r.orgId);
      setCreateError('');
      setOrgName('');
      setAdminEmail('');
      setCreateReason('');
      await refreshStatus(r.orgId);
      await load();
    } else {
      setCreateError(r.error);
    }
    setBusy(false);
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="sa-provisioning-loading">Loading the guided setup…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="sa-provisioning-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline" data-testid="sa-provisioning-retry">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="sa-provisioning">
      <header className="space-y-1">
        <h2 className="text-apple-16 font-semibold text-primary flex items-center gap-2">
          <Building className="w-4 h-4 text-accent" /> Guided client provisioning
        </h2>
        <p className="text-apple-12 text-secondary">
          Take a client from nothing to a live tenant. Each step is a platform action; a tenant
          session cannot call any of them.
        </p>
      </header>

      {/* Step 1: create the organisation. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-provisioning-create">
        <h3 className="text-apple-13 font-semibold text-primary">1. Create the client organisation</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <input
            type="text" value={orgName} onChange={(e) => setOrgName(e.target.value)}
            placeholder="Client name" aria-label="Client name"
            data-testid="sa-provisioning-org-name"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          />
          <input
            type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="First admin email" aria-label="First admin email"
            data-testid="sa-provisioning-admin-email"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          />
          <input
            type="text" value={createReason} onChange={(e) => setCreateReason(e.target.value)}
            placeholder="Reason (recorded)" aria-label="Reason"
            data-testid="sa-provisioning-create-reason"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          />
        </div>
        <button
          type="button" disabled={busy} onClick={() => void onCreate()}
          data-testid="sa-provisioning-create-submit"
          className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
        >
          Create organisation
        </button>
        {createError && <InlineError message={createError} testId="sa-provisioning-create-error" />}
        {createdId && (
          <p className="text-apple-12 text-primary" data-testid="sa-provisioning-created">
            Created. The new organisation id is {createdId}.
          </p>
        )}
      </section>

      {/* The tenant being provisioned. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-provisioning-target">
        <h3 className="text-apple-13 font-semibold text-primary">Tenant being provisioned</h3>
        <select
          value={createdId} onChange={(e) => { setCreatedId(e.target.value); void refreshStatus(e.target.value); }}
          aria-label="Target tenant" data-testid="sa-provisioning-tenant-select"
          className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
        >
          <option value="">Choose a tenant…</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {status && (
          <ul className="text-apple-12 text-secondary space-y-1" data-testid="sa-provisioning-readiness">
            <li data-testid="sa-provisioning-check-roles">Roles seeded: {status.rolesSeeded} {status.rolesReady ? '✓' : '—'}</li>
            <li data-testid="sa-provisioning-check-status">Status: {status.status}</li>
            <li data-testid="sa-provisioning-check-invite">Initial invite sent: {status.hasInitialInvite ? 'yes' : 'no'}</li>
            <li data-testid="sa-provisioning-check-sender">Platform sender ready: {status.platformSenderReady ? 'yes' : 'no'}</li>
            <li data-testid="sa-provisioning-check-engagement">
              First engagement possible: {status.canCreateEngagement ? 'yes' : 'no'}
            </li>
            <li data-testid="sa-provisioning-check-ready">
              {status.ready ? 'This tenant is ready to hand over.' : 'This tenant is not ready yet.'}
            </li>
          </ul>
        )}
      </section>

      {/* Step 2: entitlements. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-provisioning-entitlements">
        <h3 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
          <Zap className="w-3.5 h-3.5" /> 2. Set entitlements and feature flags
        </h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <select
            value={featureKey} onChange={(e) => setFeatureKey(e.target.value)}
            aria-label="Feature" data-testid="sa-provisioning-feature-select"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          >
            <option value="">Choose a feature…</option>
            {catalogue.map((f) => <option key={f.key} value={f.key}>{f.label ?? f.key}</option>)}
          </select>
          <input
            type="text" value={entitleReason} onChange={(e) => setEntitleReason(e.target.value)}
            placeholder="Reason (required)" aria-label="Entitlement reason"
            data-testid="sa-provisioning-entitlement-reason"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="button" disabled={busy || !createdId || !featureKey}
            onClick={() => void run(() => setEntitlement(createdId, featureKey, true, null, entitleReason)).then(() => refreshStatus(createdId))}
            data-testid="sa-provisioning-entitlement-enable"
            className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
          >
            Enable feature
          </button>
          <button
            type="button" disabled={busy || !createdId || !featureKey}
            onClick={() => void run(() => setEntitlement(createdId, featureKey, false, null, entitleReason)).then(() => refreshStatus(createdId))}
            data-testid="sa-provisioning-entitlement-disable"
            className="px-3 py-2 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40"
          >
            Disable feature
          </button>
        </div>
      </section>

      {/* Step 3: invite cap. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-provisioning-cap">
        <h3 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
          <Users className="w-3.5 h-3.5" /> 3. Set the invitation cap
        </h3>
        <div className="flex flex-wrap gap-2">
          <input
            type="number" min="1" max="100" value={capDraft} onChange={(e) => setCapDraft(e.target.value)}
            aria-label="Per-user daily cap" data-testid="sa-provisioning-cap-input"
            className="w-32 rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          />
          <input
            type="text" value={capReason} onChange={(e) => setCapReason(e.target.value)}
            placeholder="Reason (recorded)" aria-label="Cap reason" data-testid="sa-provisioning-cap-reason"
            className="flex-1 min-w-40 rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          />
          <button
            type="button" disabled={busy || !createdId}
            onClick={() => void run(() => setInviteCap(createdId, Number(capDraft))).then(() => refreshStatus(createdId))}
            data-testid="sa-provisioning-cap-submit"
            className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
          >
            Set cap
          </button>
        </div>
      </section>

      {/* Step 4: platform sender. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-provisioning-sender">
        <h3 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
          <Send className="w-3.5 h-3.5" /> 4. Configure the platform email sender
        </h3>
        <div className="grid gap-2 sm:grid-cols-4">
          <input
            type="text" value={senderName} onChange={(e) => setSenderName(e.target.value)}
            placeholder="Display name" aria-label="Sender display name" data-testid="sa-provisioning-sender-name"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          />
          <input
            type="email" value={senderFrom} onChange={(e) => setSenderFrom(e.target.value)}
            placeholder="From address" aria-label="From address" data-testid="sa-provisioning-sender-from"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          />
          <input
            type="email" value={senderReply} onChange={(e) => setSenderReply(e.target.value)}
            placeholder="Reply-to (optional)" aria-label="Reply-to" data-testid="sa-provisioning-sender-reply"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          />
          <input
            type="text" value={senderReason} onChange={(e) => setSenderReason(e.target.value)}
            placeholder="Reason (required)" aria-label="Sender reason" data-testid="sa-provisioning-sender-reason"
            className="rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12"
          />
        </div>
        <button
          type="button" disabled={busy}
          onClick={() => void run(() => configurePlatformEmailSender(senderName, senderFrom, senderReply || null, 'stub', senderReason)).then(() => refreshStatus(createdId))}
          data-testid="sa-provisioning-sender-submit"
          className="px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-40"
        >
          Save platform sender
        </button>
      </section>

      {/* Step 5: first Org Admin + step 6: readiness. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="sa-provisioning-finish">
        <h3 className="text-apple-13 font-semibold text-primary flex items-center gap-2">
          <Shield className="w-3.5 h-3.5" /> 5. Invite the first Org Admin and confirm readiness
        </h3>
        <p className="text-apple-12 text-secondary">
          The first Org Admin is invited when the organisation is created. Confirm the tenant is
          complete below, or repair the role catalogue if it is ever missing.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button" disabled={busy || !createdId}
            onClick={() => void run(() => seedOrgRoles(createdId)).then(() => refreshStatus(createdId))}
            data-testid="sa-provisioning-repair-roles"
            className="px-3 py-2 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40"
          >
            Repair the role catalogue
          </button>
          <button
            type="button" disabled={busy || !createdId}
            onClick={() => void run(() => setTenantStatus(createdId, 'active')).then(() => refreshStatus(createdId))}
            data-testid="sa-provisioning-activate"
            className="px-3 py-2 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40"
          >
            Activate the tenant
          </button>
          <button
            type="button" disabled={busy || !createdId}
            onClick={() => void refreshStatus(createdId)}
            data-testid="sa-provisioning-recheck"
            className="px-3 py-2 rounded-xl border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40"
          >
            Re-check readiness
          </button>
        </div>
        {status?.ready && (
          <p className="text-apple-12 text-primary flex items-center gap-1" data-testid="sa-provisioning-done">
            <Check className="w-3.5 h-3.5" /> The client can now start their first engagement.
          </p>
        )}
      </section>

      {result && (
        <div
          className={`rounded-xl border px-3 py-2 text-apple-12 ${result.ok ? 'border-hairline text-secondary' : 'border-danger text-danger'}`}
          data-testid="sa-provisioning-result"
        >
          {result.ok ? 'Saved.' : result.reason}
        </div>
      )}
    </div>
  );
};
