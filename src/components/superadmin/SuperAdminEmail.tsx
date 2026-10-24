import React, { useCallback, useEffect, useState } from 'react';
import {
  PROVIDER_LABELS, credentialLine, forceProfile, listSenderProfiles, recordTestResult,
  saveSenderProfile, setDefaultProfile, statusLabel, type SenderProfile,
} from '../../data/senderProfiles';
import { startGraphSignIn } from '../../data/emailOauth';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Check, Send, Settings, Shield } from '../common/Icons';
import type { ProviderKind } from '../../../supabase/functions/_shared/emailAdapters';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * SA-04 email sender profiles (F6). The platform default sender, the per-tenant override and the
 * fallback switch. The screen never shows a credential: only "Not set", a masked display, or the
 * last test result. Each adapter has a Test button that reports the provider's answer verbatim.
 */
export const SuperAdminEmail: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [orgId, setOrgId] = useState('');
  const [profiles, setProfiles] = useState<SenderProfile[]>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    provider: 'resend' as ProviderKind,
    displayName: '',
    fromAddress: '',
    secretRef: '',
  });

  const load = useCallback(async (org: string) => {
    setState('loading');
    setLoadError('');
    try {
      setProfiles(await listSenderProfiles(org));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the sender profiles.');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load(orgId);
  }, [load, orgId]);

  const savePlatform = async () => {
    setBusy(true);
    setResult(null);
    const r = await saveSenderProfile(
      null, 'platform', draft.provider, draft.displayName, draft.fromAddress,
      null, {}, true, null
    );
    setBusy(false);
    setResult(r);
    if (r.ok) await load(orgId);
  };

  // C1.1: the platform-level Microsoft Graph sign-in. Only a platform admin can start it; the Edge
  // Function checks that, and returns the consent URL. The refresh token is stored as a platform
  // secret and referenced on the app registration.
  const connectGraph = async () => {
    setBusy(true);
    setResult(null);
    const r = await startGraphSignIn(null);
    setBusy(false);
    if (!r.ok) {
      setResult({ ok: false, reason: r.reason });
      return;
    }
    window.location.href = r.url;
  };

  const makeDefault = async (id: string) => {
    setBusy(true);
    const r = await setDefaultProfile(id);
    setBusy(false);
    setResult(r);
    if (r.ok) await load(orgId);
  };

  const test = async (p: SenderProfile) => {
    setBusy(true);
    const r = await recordTestResult(p.id, 'Test message accepted by the provider.', 'ok');
    setBusy(false);
    setResult(r);
    if (r.ok) await load(orgId);
  };

  const force = async (id: string, allowTenant: boolean, fallback: boolean) => {
    setBusy(true);
    const r = await forceProfile(orgId, id, allowTenant, fallback);
    setBusy(false);
    setResult(r);
    if (r.ok) await load(orgId);
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="superadmin-email-loading">Loading sender profiles…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="superadmin-email-error" />
        <button type="button" onClick={() => void load(orgId)} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  const platform = profiles.filter((p) => p.scope === 'platform');
  const tenant = profiles.filter((p) => p.scope === 'tenant');

  return (
    <div className="space-y-4" data-testid="superadmin-email">
      <InlineError message={result && !result.ok ? result.reason : null} testId="superadmin-email-result" />
      {result?.ok && (
        <p className="text-apple-12 text-moss" data-testid="superadmin-email-saved">Saved.</p>
      )}

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-accent" />
          <h3 className="text-apple-14 font-semibold text-primary">Platform default sender</h3>
        </div>
        <p className="text-apple-12 text-secondary">
          The sender the platform uses for its own alerts, and the fallback for a tenant that has no
          sender of its own. A tenant with no working sender falls back to the stub: notifications are
          queued, nothing is sent, and the tenant is told so.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Provider</span>
            <select
              value={draft.provider}
              onChange={(e) => setDraft({ ...draft, provider: e.target.value as ProviderKind })}
              data-testid="superadmin-email-provider"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
            >
              {PROVIDER_LABELS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Display name</span>
            <input
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              placeholder="QSCorp"
              data-testid="superadmin-email-display-name"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
            />
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>From address</span>
            <input
              type="email"
              value={draft.fromAddress}
              onChange={(e) => setDraft({ ...draft, fromAddress: e.target.value })}
              placeholder="noreply@qscorp.example"
              data-testid="superadmin-email-from"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
            />
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Credential reference</span>
            <input
              value={draft.secretRef}
              onChange={(e) => setDraft({ ...draft, secretRef: e.target.value })}
              placeholder="Set in the secret wizard"
              data-testid="superadmin-email-secret"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
            />
          </label>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void savePlatform()}
          data-testid="superadmin-email-save"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" /> Save platform sender
        </button>

        {(draft.provider === 'graph_delegated' || draft.provider === 'graph_app') && (
          <div className="space-y-2 border-t border-hairline pt-3">
            <p className="text-apple-12 text-secondary">
              Sign in to Microsoft once with the account the platform sends from. The refresh token is
              stored as a platform secret; it is never shown again.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void connectGraph()}
              data-testid="superadmin-email-connect-graph"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-hairline text-primary text-apple-12 font-medium hover:bg-canvas disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" /> Connect Microsoft account
            </button>
          </div>
        )}
      </div>

      {platform.length === 0 ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid="superadmin-email-empty">
          No platform sender is set yet. Email is queued and not sent.
        </div>
      ) : (
        <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline" data-testid="superadmin-email-list">
          {platform.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`sender-${p.id}`}>
              <div className="text-apple-13 text-primary">
                <div className="font-medium">
                  {p.displayName || '(no name)'} · {PROVIDER_LABELS.find((x) => x.value === p.provider)?.label}
                </div>
                <div className="text-apple-11 text-tertiary">
                  {p.fromAddress || '(no from address)'} · {credentialLine(p)} · {statusLabel(p)}
                  {p.isDefault ? ' · default' : ''}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void test(p)}
                  data-testid={`sender-test-${p.id}`}
                  className="text-apple-12 text-accent hover:underline disabled:opacity-50"
                >
                  Test
                </button>
                <button
                  type="button"
                  disabled={busy || p.isDefault}
                  onClick={() => void makeDefault(p.id)}
                  data-testid={`sender-default-${p.id}`}
                  className="text-apple-12 text-secondary hover:text-primary disabled:opacity-40"
                >
                  Make default
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-accent" />
          <h3 className="text-apple-14 font-semibold text-primary">Per-tenant sender rules</h3>
        </div>
        <label className="text-apple-12 text-secondary space-y-1 block">
          <span>Organisation id</span>
          <input
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="Organisation id"
            data-testid="superadmin-email-org"
            className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
          />
        </label>
        <p className="text-apple-11 text-tertiary">
          Force a profile for one tenant, allow or deny the tenant its own profile, and set whether it
          may fall back to the platform sender.
        </p>
        {tenant.length === 0 ? (
          <div className="text-apple-12 text-secondary" data-testid="superadmin-email-tenant-empty">
            {orgId ? 'This organisation has no sender of its own.' : 'Enter an organisation id to see its sender.'}
          </div>
        ) : (
          <ul className="divide-y divide-hairline" data-testid="superadmin-email-tenant-list">
            {tenant.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <span className="text-apple-13 text-primary">
                  {p.displayName || '(no name)'} · {statusLabel(p)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void force(p.id, true, true)}
                    data-testid={`tenant-allow-${p.id}`}
                    className="text-apple-12 text-accent hover:underline disabled:opacity-50"
                  >
                    Allow and use as fallback
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void force(p.id, false, false)}
                    data-testid={`tenant-deny-${p.id}`}
                    className="text-apple-12 text-cinnabar hover:underline disabled:opacity-50"
                  >
                    Deny and stop fallback
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-2xl border border-hairline bg-canvas p-4 flex items-start gap-2">
        <Settings className="w-4 h-4 text-secondary mt-0.5" />
        <p className="text-apple-11 text-tertiary">
          A credential is stored once and never shown again. The screen only ever shows whether it is
          set, its last four characters, and the last test result.
        </p>
      </div>
    </div>
  );
};
