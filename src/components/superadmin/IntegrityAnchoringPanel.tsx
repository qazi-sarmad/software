import React, { useCallback, useEffect, useState } from 'react';
import { InlineError } from '../common/InlineError';
import { Check, Plus } from '../common/Icons';
import {
  listTimestampAuthorities, listTrustAnchors, saveTimestampAuthority, saveTrustAnchor, setAnchoringMin,
  type TimestampAuthority, type TrustAnchor,
} from '../../data/integrityAnchoring';
import { listTenants, type TenantRow } from '../../data/platform';

type LoadState = 'loading' | 'ready' | 'error';

const field = 'w-full rounded-xl border border-hairline bg-canvas px-3 py-2 text-apple-12 text-primary';

/**
 * Integrity anchoring administration (Phase 3.5, item A, §17).
 *
 * The timestamp authorities (RFC 3161 servers) that stamp a report's root hash, and the trust anchors
 * their certificates are verified against. Both are platform-level, written only by a platform
 * administrator (enforced in the database). Before this screen the two writer RPCs existed but no
 * screen called them, so the catalogue could not be populated except by hand.
 */
export const IntegrityAnchoringPanel: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authorities, setAuthorities] = useState<TimestampAuthority[]>([]);
  const [anchors, setAnchors] = useState<TrustAnchor[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);

  const [newAuthority, setNewAuthority] = useState({ name: '', url: '', sortOrder: 10, notes: '' });
  const [newAnchor, setNewAnchor] = useState({ name: '', certificateDer: '' });

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [a, t, orgs] = await Promise.all([
        listTimestampAuthorities(), listTrustAnchors(), listTenants(),
      ]);
      setAuthorities(a);
      setAnchors(t);
      setTenants(orgs);
      setState('ready');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the integrity catalogue.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const setMin = async (orgId: string, min: number) => {
    setBusy(true); setResult(null); setLoadError('');
    const res = await setAnchoringMin(orgId, min);
    if (!res.ok) setLoadError(res.reason);
    else setResult(`Minimum authorities set to ${min}.`);
    setBusy(false);
  };

  const addAuthority = async () => {
    setBusy(true); setResult(null); setLoadError('');
    const res = await saveTimestampAuthority(
      null, newAuthority.name, newAuthority.url, true, newAuthority.sortOrder, newAuthority.notes);
    if (!res.ok) setLoadError(res.reason);
    else { setResult('Authority saved.'); setNewAuthority({ name: '', url: '', sortOrder: 10, notes: '' }); await load(); }
    setBusy(false);
  };

  const addAnchor = async () => {
    setBusy(true); setResult(null); setLoadError('');
    const res = await saveTrustAnchor(null, newAnchor.name, newAnchor.certificateDer, true);
    if (!res.ok) setLoadError(res.reason);
    else { setResult('Trust anchor saved.'); setNewAnchor({ name: '', certificateDer: '' }); await load(); }
    setBusy(false);
  };

  if (state === 'loading') {
    return <p className="text-apple-12 text-secondary" data-testid="sa-anchoring-loading">Loading integrity catalogue…</p>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="sa-anchoring-error" />;
  }

  return (
    <div className="space-y-6" data-testid="sa-anchoring">
      <header className="space-y-1">
        <h2 className="text-apple-15 font-semibold text-primary">Integrity anchoring</h2>
        <p className="text-apple-12 text-secondary">
          The timestamp authorities that stamp a sealed report's root hash, and the trust anchors their
          certificates are verified against. Both are platform-wide and write-only for a platform
          administrator.
        </p>
      </header>

      {loadError && <InlineError message={loadError} testId="sa-anchoring-save-error" />}
      {result && <p className="text-apple-12 text-secondary" data-testid="sa-anchoring-result">{result}</p>}

      <section className="space-y-3" data-testid="sa-anchoring-authorities">
        <h3 className="text-apple-14 font-semibold text-primary">Timestamp authorities</h3>
        <ul className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface" data-testid="sa-anchoring-authority-list">
          {authorities.length === 0 && (
            <li className="px-4 py-3 text-apple-12 text-secondary" data-testid="sa-anchoring-authority-empty">
              No authority is configured. Add one so a sealed report can be timestamped.
            </li>
          )}
          {authorities.map((a) => (
            <li key={a.id} className="px-4 py-3 flex items-center justify-between" data-testid={`sa-anchoring-authority-${a.id}`}>
              <span className="text-apple-13 text-primary">{a.name} <span className="text-apple-11 text-tertiary">{a.url}</span></span>
              <span className={`text-apple-11 ${a.enabled ? 'text-verdigris' : 'text-tertiary'}`}>{a.enabled ? 'enabled' : 'disabled'}</span>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-4">
          <input placeholder="Authority name" value={newAuthority.name}
            onChange={(e) => setNewAuthority({ ...newAuthority, name: e.target.value })}
            data-testid="sa-anchoring-authority-name" className={field} />
          <input placeholder="https://tsa.example" value={newAuthority.url}
            onChange={(e) => setNewAuthority({ ...newAuthority, url: e.target.value })}
            data-testid="sa-anchoring-authority-url" className={field} />
          <input type="number" placeholder="Order" value={newAuthority.sortOrder}
            onChange={(e) => setNewAuthority({ ...newAuthority, sortOrder: Number(e.target.value) })}
            data-testid="sa-anchoring-authority-order" className={field} />
          <button type="button" disabled={busy || !newAuthority.name || !newAuthority.url}
            onClick={() => void addAuthority()} data-testid="sa-anchoring-authority-add"
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Add authority
          </button>
        </div>
      </section>

      <section className="space-y-3" data-testid="sa-anchoring-anchors">
        <h3 className="text-apple-14 font-semibold text-primary">Trust anchors</h3>
        <ul className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface" data-testid="sa-anchoring-anchor-list">
          {anchors.length === 0 && (
            <li className="px-4 py-3 text-apple-12 text-secondary" data-testid="sa-anchoring-anchor-empty">
              No trust anchor is configured. Add the certificate a timestamp token is verified against.
            </li>
          )}
          {anchors.map((t) => (
            <li key={t.id} className="px-4 py-3 flex items-center justify-between" data-testid={`sa-anchoring-anchor-${t.id}`}>
              <span className="text-apple-13 text-primary">{t.name}</span>
              <span className={`text-apple-11 ${t.enabled ? 'text-verdigris' : 'text-tertiary'}`}>{t.enabled ? 'enabled' : 'disabled'}</span>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-3">
          <input placeholder="Anchor name" value={newAnchor.name}
            onChange={(e) => setNewAnchor({ ...newAnchor, name: e.target.value })}
            data-testid="sa-anchoring-anchor-name" className={field} />
          <input placeholder="Certificate (DER, base64)" value={newAnchor.certificateDer}
            onChange={(e) => setNewAnchor({ ...newAnchor, certificateDer: e.target.value })}
            data-testid="sa-anchoring-anchor-cert" className={field} />
          <button type="button" disabled={busy || !newAnchor.name || newAnchor.certificateDer.length < 16}
            onClick={() => void addAnchor()} data-testid="sa-anchoring-anchor-add"
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-accent-subtle disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> Add anchor
          </button>
        </div>
      </section>

      <section className="space-y-3" data-testid="sa-anchoring-min">
        <h3 className="text-apple-14 font-semibold text-primary">Minimum authorities per organisation</h3>
        <p className="text-apple-12 text-secondary">
          How many independent timestamp authorities must confirm a sealed report's root before the
          seal counts as anchored. Between 1 and 3; a higher number is stronger evidence and slower.
        </p>
        <ul className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface" data-testid="sa-anchoring-min-list">
          {tenants.length === 0 && (
            <li className="px-4 py-3 text-apple-12 text-secondary" data-testid="sa-anchoring-min-empty">
              No tenant is provisioned yet.
            </li>
          )}
          {tenants.map((t) => (
            <li key={t.id} className="px-4 py-3 flex items-center justify-between" data-testid={`sa-anchoring-min-${t.id}`}>
              <span className="text-apple-13 text-primary">{t.name}</span>
              <span className="flex items-center gap-1">
                {[1, 2, 3].map((n) => (
                  <button key={n} type="button" disabled={busy}
                    onClick={() => void setMin(t.id, n)}
                    data-testid={`sa-anchoring-min-${t.id}-${n}`}
                    className="px-2 py-1 rounded-lg border border-hairline text-apple-12 text-secondary hover:text-primary disabled:opacity-40">
                    {n}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};
