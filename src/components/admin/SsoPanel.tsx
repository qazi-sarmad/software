import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { getSsoSettings, listSsoProviders, setSsoProvider, type SsoProvider, type SsoSettings } from '../../data/sso';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Shield, Check } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Organisation SSO policy (WP11, OA SSO tab).
 *
 * A Level-1/Level-2 admin with edit_config sets which provider serves the org and which email
 * domain routes to it, and whether SSO is enforced. The database enforces edit_config and a reason;
 * the access-token hook does the actual enforcement (a non-SSO session in an enforcing org carries
 * no org claim and therefore sees no tenant data). Not a blocking modal.
 */
export const SsoPanel: React.FC = () => {
  const { currentUser } = useApp();
  const canEdit = hasRight(currentUser, 'edit_config');
  const orgId = currentUser.orgId ?? '';

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [current, setCurrent] = useState<SsoSettings | null>(null);
  const [provider, setProvider] = useState('');
  const [domain, setDomain] = useState('');
  const [enforced, setEnforced] = useState(false);
  const [reason, setReason] = useState('');
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [p, s] = await Promise.all([listSsoProviders(), orgId ? getSsoSettings(orgId) : Promise.resolve(null)]);
      setProviders(p);
      setCurrent(s);
      setProvider(s?.provider ?? p[0]?.provider ?? '');
      setDomain(s?.domain ?? '');
      setEnforced(Boolean(s?.enforced));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load SSO settings.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setResult(null);
    setBusy(true);
    const r = await setSsoProvider(orgId, provider || null, domain.trim() || null, enforced, reason.trim());
    setBusy(false);
    setResult(r);
    if (r.ok) {
      setReason('');
      await load();
    }
  };

  if (state === 'loading') {
    return <div className="text-apple-13 text-secondary" data-testid="sso-loading">Loading SSO settings…</div>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="sso-error" />;
  }

  return (
    <div className="space-y-5" data-testid="sso-panel">
      <div className="flex items-center gap-2">
        <Shield className="w-5 h-5 text-accent" />
        <h2 className="text-apple-17 font-semibold text-primary">Single sign-on</h2>
      </div>
      <p className="text-apple-13 text-secondary">
        Connect the organisation to a SAML or OIDC identity provider. When enforcement is on, a
        password session carries no organisation claim and sees no tenant data: only a session
        authenticated through the provider can read the workspace.
      </p>

      <div className="rounded-2xl bg-surface border border-hairline p-4 space-y-3" data-testid="sso-current">
        <div className="text-apple-12 text-secondary">Current policy</div>
        <div className="text-apple-13 text-primary">
          {current?.provider
            ? `${current.provider} · ${current.domain ?? 'no domain'} · ${current.enforced ? 'enforced' : 'not enforced'}`
            : 'No provider configured.'}
        </div>
      </div>

      {!canEdit && (
        <p className="text-apple-12 text-secondary" data-testid="sso-readonly">
          You need edit_config to change the SSO policy. It is shown read-only.
        </p>
      )}

      <div className="space-y-3" data-testid="sso-form">
        <label className="block space-y-1">
          <span className="text-apple-12 font-medium text-primary">Provider</span>
          <select
            data-testid="sso-provider"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={!canEdit}
            className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
          >
            {providers.map((p) => (
              <option key={p.provider} value={p.provider}>{p.label}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-apple-12 font-medium text-primary">Email domain</span>
          <input
            data-testid="sso-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="client.example"
            disabled={!canEdit}
            className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
          />
        </label>
        <label className="inline-flex items-center gap-2 text-apple-13 text-primary">
          <input
            type="checkbox"
            data-testid="sso-enforced"
            checked={enforced}
            onChange={(e) => setEnforced(e.target.checked)}
            disabled={!canEdit}
          />
          Enforce SSO (block password sign-in)
        </label>
        <label className="block space-y-1">
          <span className="text-apple-12 font-medium text-primary">Reason (required)</span>
          <input
            data-testid="sso-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canEdit}
            className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
          />
        </label>
        <InlineError message={result && !result.ok ? result.reason : null} testId="sso-save-error" />
        {result?.ok && (
          <div className="flex items-center gap-2 text-apple-12 text-primary" data-testid="sso-saved">
            <Check className="w-4 h-4 text-accent" /> Saved.
          </div>
        )}
        <button
          type="button"
          data-testid="sso-save"
          onClick={save}
          disabled={!canEdit || busy || reason.trim() === ''}
          className="px-4 py-2 rounded-xl bg-accent text-white text-apple-13 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Save policy
        </button>
      </div>
    </div>
  );
};
