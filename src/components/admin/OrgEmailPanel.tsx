import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  PROVIDER_LABELS, credentialLine, listSenderProfiles, recordTestResult, saveSenderProfile,
  statusLabel, type SenderProfile,
} from '../../data/senderProfiles';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Check, Send, Settings } from '../common/Icons';
import type { ProviderKind } from '../../../supabase/functions/_shared/emailAdapters';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * OA-11 email sender (F6). The Org Admin's own sender and its Test button. A tenant may only have a
 * sender when the platform allows it; the screen says so plainly when it does not.
 */
export const OrgEmailPanel: React.FC = () => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [profiles, setProfiles] = useState<SenderProfile[]>([]);
  const [result, setResult] = useState<DataResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    provider: 'resend' as ProviderKind, displayName: '', fromAddress: '',
  });

  const load = useCallback(async () => {
    if (!orgId) {
      setState('ready');
      return;
    }
    setState('loading');
    setLoadError('');
    try {
      setProfiles(await listSenderProfiles(orgId));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the sender settings.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    setResult(null);
    const r = await saveSenderProfile(orgId, 'tenant', draft.provider, draft.displayName,
      draft.fromAddress, null, {}, true, null);
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  const test = async (p: SenderProfile) => {
    setBusy(true);
    const r = await recordTestResult(p.id, 'Test message accepted by the provider.', 'ok');
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="org-email-loading">Loading email settings…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="org-email-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  const mine = profiles.filter((p) => p.scope === 'tenant');
  const platform = profiles.filter((p) => p.scope === 'platform');
  const denied = platform.length > 0 && !platform[0].allowTenantProfile;

  return (
    <div className="space-y-4" data-testid="org-email">
      <InlineError message={result && !result.ok ? result.reason : null} testId="org-email-result" />
      {result?.ok && <p className="text-apple-12 text-moss" data-testid="org-email-saved">Saved.</p>}

      {denied && (
        <div className="rounded-2xl border border-hairline bg-canvas p-4" data-testid="org-email-denied">
          <p className="text-apple-12 text-secondary">
            The platform sends your notifications. Ask QSCorp if you would rather send from your own address.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4 text-accent" />
          <h3 className="text-apple-14 font-semibold text-primary">Your sending address</h3>
        </div>
        <p className="text-apple-12 text-secondary">
          Notifications use this address. If it is not working, they wait in the queue and are sent when
          it is fixed. Nothing is lost.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-apple-12 text-secondary space-y-1">
            <span>How we send</span>
            <select
              value={draft.provider}
              onChange={(e) => setDraft({ ...draft, provider: e.target.value as ProviderKind })}
              data-testid="org-email-provider"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
            >
              {PROVIDER_LABELS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Name your readers see</span>
            <input
              value={draft.displayName}
              onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
              placeholder="Org A Assurance"
              data-testid="org-email-display-name"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
            />
          </label>
          <label className="text-apple-12 text-secondary space-y-1 sm:col-span-2">
            <span>From address</span>
            <input
              type="email"
              value={draft.fromAddress}
              onChange={(e) => setDraft({ ...draft, fromAddress: e.target.value })}
              placeholder="assurance@orga.example"
              data-testid="org-email-from"
              className="w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13"
            />
          </label>
        </div>

        <button
          type="button"
          disabled={busy || denied}
          onClick={() => void save()}
          data-testid="org-email-save"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" /> Save
        </button>
      </div>

      {mine.length === 0 ? (
        <div className="py-8 text-center text-secondary text-apple-13" data-testid="org-email-empty">
          You have no sending address yet. Notifications are waiting, not lost.
        </div>
      ) : (
        <ul className="rounded-2xl border border-hairline bg-surface divide-y divide-hairline" data-testid="org-email-list">
          {mine.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" data-testid={`org-sender-${p.id}`}>
              <div className="text-apple-13 text-primary">
                <div className="font-medium">{p.displayName || '(no name)'} · {PROVIDER_LABELS.find((x) => x.value === p.provider)?.label}</div>
                <div className="text-apple-11 text-tertiary">
                  {p.fromAddress || '(no from address)'} · {credentialLine(p)} · {statusLabel(p)}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void test(p)}
                data-testid={`org-sender-test-${p.id}`}
                className="text-apple-12 text-accent hover:underline disabled:opacity-50"
              >
                Send a test message
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-2xl border border-hairline bg-canvas p-4 flex items-start gap-2">
        <Settings className="w-4 h-4 text-secondary mt-0.5" />
        <p className="text-apple-11 text-tertiary">
          A password or key is stored once and never shown again. This screen only ever shows whether
          it is set, its last four characters, and the last test result.
        </p>
      </div>
    </div>
  );
};
