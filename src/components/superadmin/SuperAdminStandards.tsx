import React, { useCallback, useEffect, useState } from 'react';
import {
  listStandardsCatalogue, listStandardsSubscriptions, registerPlatformSigningKey,
  publishStandardsPack, rolloutStandardsPack, buildSignedStandardsPack, generateSigningKey,
  SHIPPED_RULES, type CatalogueRow, type RolloutOutcome,
} from '../../data/standards';
import { STANDARDS_CATALOGUE, type StandardsSubscription } from '../../lib/systeligon/standards';
import type { CryptoLike } from '../../lib/anchoring';
import { listTenants, type TenantRow } from '../../data/platform';
import { InlineError } from '../common/InlineError';
import { Check, Lock, Shield } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * SA-21 standards distribution (D16). The platform catalogue of signed standards packs, a publish
 * action that signs the shipped rule library with the platform key, and a rollout to entitled tenants
 * that shows the per-tenant outcome (applied / skipped-not-entitled / skipped-pinned).
 *
 * Only the platform registers a signing key or rolls a pack out; the server re-checks the platform
 * role. Nothing is shown as applied unless the server said so.
 */
export const SuperAdminStandards: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [catalogue, setCatalogue] = useState<CatalogueRow[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [subs, setSubs] = useState<StandardsSubscription[]>([]);
  const [packId, setPackId] = useState(STANDARDS_CATALOGUE[0].packId);
  const [version, setVersion] = useState('1');
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<'publish' | 'rollout' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; reason?: string; lines?: string[] } | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [cat, ts, s] = await Promise.all([
        listStandardsCatalogue(), listTenants(), listStandardsSubscriptions(),
      ]);
      setCatalogue(cat);
      setTenants(ts);
      setSubs(s);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the standards catalogue.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const publish = async () => {
    const v = Number(version);
    if (!Number.isInteger(v) || v < 1) {
      setResult({ ok: false, reason: 'Enter a version of 1 or more.' });
      return;
    }
    const c = globalThis.crypto as unknown as CryptoLike;
    if (!c?.subtle) {
      setResult({ ok: false, reason: 'This browser cannot sign a standards pack.' });
      return;
    }
    setBusy('publish');
    setResult(null);
    try {
      const key = await generateSigningKey(c);
      const keyId = `platform-${Date.now()}`;
      const reg = await registerPlatformSigningKey(keyId, key.publicKeyHex);
      if (!reg.ok) { setResult({ ok: false, reason: reg.reason }); return; }
      const built = await buildSignedStandardsPack(
        c, packId, v, keyId, new Date().toISOString(), key.privateKey);
      if (!built.ok) { setResult({ ok: false, reason: built.reason }); return; }
      if (!built.verification.ok) {
        setResult({ ok: false, reason: built.verification.reason ?? 'the pack did not verify' });
        return;
      }
      const pub = await publishStandardsPack(built.signed, keyId);
      if (!pub.ok) { setResult({ ok: false, reason: pub.reason }); return; }
      setResult({ ok: true, lines: [`Published ${packId} v${v} (${built.signed.contentHash.slice(0, 12)}…)`] });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const rollOut = async () => {
    const v = Number(version);
    const orgIds = tenants.filter((t) => chosen[t.id]).map((t) => t.id);
    if (orgIds.length === 0) {
      setResult({ ok: false, reason: 'Choose at least one tenant to roll out to.' });
      return;
    }
    setBusy('rollout');
    setResult(null);
    const r = await rolloutStandardsPack(packId, v, orgIds);
    setBusy(null);
    if (!r.ok) { setResult({ ok: false, reason: r.reason }); return; }
    const name = (id: string) => tenants.find((t) => t.id === id)?.name ?? id;
    setResult({
      ok: true,
      lines: [
        `Applied to ${r.data.applied} of ${orgIds.length} tenants.`,
        ...r.data.results.map((o: RolloutOutcome) => `${name(o.orgId)}: ${o.outcome}`),
      ],
    });
    await load();
  };

  if (state === 'loading') {
    return <div className="py-12 text-center text-secondary text-apple-13" data-testid="superadmin-standards-loading">Loading standards…</div>;
  }
  if (state === 'error') {
    return (
      <div className="space-y-3">
        <InlineError message={loadError} testId="superadmin-standards-error" />
        <button type="button" onClick={() => void load()} className="text-apple-12 text-accent hover:underline">Retry</button>
      </div>
    );
  }

  const shipped = STANDARDS_CATALOGUE.filter((d) => d.shipped);
  const latestByPack = new Map<string, CatalogueRow>();
  for (const row of catalogue) {
    const cur = latestByPack.get(row.packId);
    if (!cur || row.version > cur.version) latestByPack.set(row.packId, row);
  }

  return (
    <div className="space-y-6" data-testid="superadmin-standards">
      {result && (
        result.ok
          ? <div className="rounded-xl border border-hairline bg-surface p-3 text-apple-12 text-secondary space-y-1" data-testid="superadmin-standards-result">
              {(result.lines ?? []).map((l) => <div key={l}>{l}</div>)}
            </div>
          : <InlineError message={result.reason ?? 'Refused.'} testId="superadmin-standards-result" />
      )}

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <h3 className="text-apple-14 font-semibold text-primary flex items-center gap-2"><Shield className="w-4 h-4" /> Standards catalogue</h3>
        <p className="text-apple-12 text-secondary">
          Each rule base is a signed, versioned pack. Only a published version can be rolled out.
        </p>
        <table className="w-full text-apple-12" data-testid="superadmin-standards-catalogue">
          <thead className="text-secondary">
            <tr>
              <th className="text-left py-1 font-semibold">Pack</th>
              <th className="text-left py-1 font-semibold">Discipline</th>
              <th className="text-left py-1 font-semibold">Published</th>
              <th className="text-left py-1 font-semibold">Sources</th>
            </tr>
          </thead>
          <tbody>
            {STANDARDS_CATALOGUE.map((d) => {
              const latest = latestByPack.get(d.packId);
              return (
                <tr key={d.packId} className="border-t border-hairline" data-testid={`standards-catalogue-${d.packId}`}>
                  <td className="py-1.5 text-primary font-medium">{d.title}</td>
                  <td className="py-1.5 text-secondary">{d.discipline}</td>
                  <td className="py-1.5 text-secondary">
                    {latest
                      ? `v${latest.version}`
                      : <span className="text-tertiary inline-flex items-center gap-1"><Lock className="w-3 h-3" /> not published</span>}
                  </td>
                  <td className="py-1.5 text-tertiary">{d.sources.map((s) => `${s.doc} (${s.edition})`).join('; ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <h3 className="text-apple-14 font-semibold text-primary">Publish a standards version</h3>
        <p className="text-apple-12 text-secondary">
          Signs the shipped rule library with the platform key and registers the version. A shipped
          version is immutable; a change is a new version.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Pack</span>
            <select
              aria-label="Pack to publish"
              data-testid="standards-publish-pack"
              value={packId}
              onChange={(e) => setPackId(e.target.value)}
              className="block px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary"
            >
              {shipped.map((d) => <option key={d.packId} value={d.packId}>{d.title}</option>)}
            </select>
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Version</span>
            <input
              type="number" min={1} value={version} aria-label="Version to publish"
              data-testid="standards-publish-version"
              onChange={(e) => setVersion(e.target.value)}
              className="block w-24 px-2 py-1 rounded-lg border border-hairline bg-canvas text-primary"
            />
          </label>
          <button
            type="button" disabled={busy !== null} onClick={() => void publish()}
            data-testid="standards-publish"
            className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-50"
          >
            {busy === 'publish' ? 'Publishing…' : 'Sign & publish'}
          </button>
          <span className="text-apple-11 text-tertiary" data-testid="standards-shipped-rules">{SHIPPED_RULES.length} released rules</span>
        </div>
      </div>

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-3">
        <h3 className="text-apple-14 font-semibold text-primary">Roll out to tenants</h3>
        <p className="text-apple-12 text-secondary">
          A tenant that does not pay for the pack is skipped and recorded — never silently applied.
        </p>
        {tenants.length === 0 ? (
          <div className="py-6 text-center text-secondary text-apple-13" data-testid="superadmin-standards-empty">
            There are no tenants yet.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-3" data-testid="standards-rollout-tenants">
              {tenants.map((t) => (
                <label key={t.id} className="inline-flex items-center gap-2 text-apple-12 text-secondary">
                  <input
                    type="checkbox"
                    checked={Boolean(chosen[t.id])}
                    onChange={(e) => setChosen((prev) => ({ ...prev, [t.id]: e.target.checked }))}
                    aria-label={`Roll out to ${t.name}`}
                    data-testid={`standards-rollout-${t.id}`}
                  />
                  {t.name}
                </label>
              ))}
            </div>
            <button
              type="button" disabled={busy !== null} onClick={() => void rollOut()}
              data-testid="standards-rollout"
              className="px-3 py-1.5 rounded-lg border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-50"
            >
              {busy === 'rollout' ? 'Rolling out…' : 'Roll out'}
            </button>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
        <h3 className="text-apple-14 font-semibold text-primary flex items-center gap-2"><Check className="w-4 h-4" /> Subscribed versions</h3>
        {subs.length === 0 ? (
          <div className="py-4 text-secondary text-apple-12" data-testid="standards-subscriptions-empty">
            No pack has been rolled out to this tenant yet.
          </div>
        ) : (
          <table className="w-full text-apple-12" data-testid="standards-subscriptions">
            <thead className="text-secondary">
              <tr>
                <th className="text-left py-1 font-semibold">Pack</th>
                <th className="text-left py-1 font-semibold">Version</th>
                <th className="text-left py-1 font-semibold">State</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.packId} className="border-t border-hairline" data-testid={`standards-subscription-${s.packId}`}>
                  <td className="py-1.5 text-primary">{s.packId}</td>
                  <td className="py-1.5 text-secondary">v{s.version}</td>
                  <td className="py-1.5 text-secondary">{s.pinned ? 'pinned' : 'following'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
