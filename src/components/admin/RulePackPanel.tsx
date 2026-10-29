import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { rightReason } from '../../lib/rightLabels';
import { InlineError } from '../common/InlineError';
import { Check, Plus, ShieldCheck, Zap, AlertTriangle, RefreshCw, Lock } from '../common/Icons';
import {
  listRulePacks, listRulePackRefusals, saveSignedRulePackArtifact, releaseRulePack, registerSigningKey,
  generateSigningKey, signPack, verifyPack, buildAdhocRule, runAdhocRule,
  type RulePackSummary, type RulePackRefusalRow, type CryptoLike, type AdhocRuleSpec,
} from '../../data/rulePacks';
import { definePack, releasedRules, systeligonPopulationRules } from '../../lib/systeligon';
import { fromHex } from '../../lib/anchoring';
import type { RulePack } from '../../lib/systeligon';
import { ENGINE_NAME } from '../../lib/product';

type LoadState = 'loading' | 'ready' | 'error';

const input = 'h-9 w-full px-3 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none focus:border-accent';

const CONDITIONS: AdhocRuleSpec['condition'][] = ['gt', 'lt', 'eq', 'ne', 'between', 'missing'];

/**
 * Rule-pack management (S10/S11, spec §4/§8; L2). The surface the pack library and the signed OTA
 * path never had: list the packs this org can run, see a pack's rules and version, save a signed
 * pack, release a draft, and read the refusal log — plus the ad-hoc rule builder that turns a source,
 * a condition and a threshold into a versioned rule.
 *
 * The signature is the control (§8): whoever can push a pack can change what the engine concludes, so
 * a pack is signed over its content hash with the org's signing key, and a save the server cannot
 * verify is refused AND logged. The refusal log is shown here so a rejection is never silent.
 *
 * The browser generates the keypair; only the public half is registered. Nothing here is generated
 * text and nothing calls out — it is the deterministic engine's configuration surface.
 */
export const RulePackPanel: React.FC<{ screenId?: string }> = ({ screenId = 'OA-33' }) => {
  const { currentUser } = useApp();
  const canEdit = hasRight(currentUser, 'edit_config');
  const orgId = currentUser.orgId ?? '';

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [packs, setPacks] = useState<RulePackSummary[]>([]);
  const [refusals, setRefusals] = useState<RulePackRefusalRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Key state: generated in the browser, kept in memory for this session. The private key never
  // leaves the component; only the public key is registered.
  const [keyId, setKeyId] = useState<string>(`org-${orgId.slice(0, 8)}-1`);
  const [key, setKey] = useState<{ publicKeyHex: string; privateKey: JsonWebKey } | null>(null);
  const [keyBusy, setKeyBusy] = useState(false);

  // The ad-hoc rule builder draft.
  const [adhoc, setAdhoc] = useState<AdhocRuleSpec>({
    id: 'adhoc.amount_over', version: 1, title: 'Amount over threshold',
    source: 'amount', condition: 'gt', threshold: 0, severity: 'medium',
  });
  const [adhocPreview, setAdhocPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [p, r] = await Promise.all([listRulePacks(), listRulePackRefusals()]);
      setPacks(p);
      setRefusals(r);
      setState('ready');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the rule packs.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const cryptoLike = (): CryptoLike | null => {
    const c = globalThis.crypto;
    if (!c?.subtle) return null;
    return c as unknown as CryptoLike;
  };

  const generateKey = async () => {
    const c = cryptoLike();
    if (!c) { setError('Secure key generation is unavailable in this browser.'); return; }
    setKeyBusy(true);
    setError(null);
    try {
      const k = await generateSigningKey(c);
      setKey(k);
      setNotice('A signing key was generated in this browser. Register it, then sign a pack.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate a signing key.');
    } finally {
      setKeyBusy(false);
    }
  };

  const registerKey = async () => {
    if (!key) { setError('Generate a key first.'); return; }
    setKeyBusy(true);
    setError(null);
    try {
      const res = await registerSigningKey(keyId, key.publicKeyHex);
      if (!res.ok) setError(res.reason);
      else setNotice(`Signing key ${keyId} registered. The previous live key was retired.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not register the key.');
    } finally {
      setKeyBusy(false);
    }
  };

  /** Save the shipped population rules as a signed, versioned pack. */
  const saveShippedPack = async () => {
    const c = cryptoLike();
    if (!c) { setError('Secure signing is unavailable in this browser.'); return; }
    if (!key) { setError('Generate and register a signing key before saving a pack.'); return; }
    setBusy('save');
    setError(null);
    try {
      // Only released rules ship in a pack: a draft never runs, so it is not put in the pack the
      // engine runs. `releasedRules` is the engine's own filter, reused here so the two agree.
      const pack: RulePack = definePack('audit-default', 1, 'population', releasedRules({
        name: 'audit-default', version: 1, target: 'population', rules: systeligonPopulationRules,
      }));
      const signedAt = new Date().toISOString();
      const signed = await signPack(c, pack, keyId, signedAt, key.privateKey);
      // Never send what cannot be verified: check the signature locally first, against the public
      // key we hold. A pack that fails here is not offered to the server at all.
      const verification = await verifyPack(c, signed, fromHex(key.publicKeyHex));
      if (!verification.ok) {
        setError(`The pack did not verify locally (${verification.refusal}); it was not sent. ${verification.reason ?? ''}`);
        return;
      }
      const res = await saveSignedRulePackArtifact(signed, keyId);
      if (!res.ok) { setError(res.reason); await load(); return; }
      setNotice(`Pack audit-default@1 signed (hash ${signed.contentHash.slice(0, 12)}…, ${pack.rules.length} released rule(s)) and saved as a draft. Release it to let the engine run it.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the pack.');
    } finally {
      setBusy(null);
    }
  };

  const release = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const res = await releaseRulePack(id);
      if (!res.ok) setError(res.reason);
      else setNotice('Pack released. The engine may now run it.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not release the pack.');
    } finally {
      setBusy(null);
    }
  };

  const previewAdhoc = () => {
    setError(null);
    try {
      const at = new Date().toISOString();
      // Build the rule from the spec first, so the builder's own validation runs before the preview.
      buildAdhocRule(adhoc, 'draft');
      const result = runAdhocRule(adhoc, [
        { ref: 'r1', values: { amount: 120 } },
        { ref: 'r2', values: { amount: 5 } },
        { ref: 'r3', values: { amount: null } },
      ], at);
      setAdhocPreview(`${result.findings.length} of 3 sample rows match: ${result.findings.map((f) => f.refs.join(',')).join(' | ') || 'none'}`);
    } catch (e) {
      setAdhocPreview(null);
      setError(e instanceof Error ? e.message : 'The ad-hoc rule could not be built.');
    }
  };

  const packHash = useMemo(() => packs.map((p) => p.contentHash.slice(0, 12)), [packs]);

  return (
    <div className="space-y-6" data-testid="rule-pack-panel" data-screen={screenId}>
      <div className="p-4 rounded-xl bg-surface-sunken border border-hairline space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium text-apple-13">
          <ShieldCheck className="w-4 h-4 text-verdigris" />
          <span>{ENGINE_NAME} rule packs</span>
        </div>
        <p className="text-apple-12 text-secondary">
          Signed, versioned rule packs per audit type. A pack is signed over its content hash; a save
          the server cannot verify is refused and logged. A pack ships as a draft and is released
          deliberately.
        </p>
      </div>

      {!canEdit && (
        <p className="text-apple-12 text-secondary" data-testid="rule-pack-rights-note">
          <Lock className="inline w-3.5 h-3.5 mr-1" />
          {rightReason('edit_config')} — you can read this screen, but saving and releasing a pack
          needs <span className="font-mono">edit_config</span>.
        </p>
      )}

      <InlineError message={error} testId="rule-pack-error" onDismiss={() => setError(null)} />
      {notice && (
        <p className="text-apple-12 text-verdigris inline-flex items-center gap-1" data-testid="rule-pack-notice">
          <Check className="w-3.5 h-3.5" /> {notice}
        </p>
      )}

      {state === 'loading' && (
        <p className="text-apple-12 text-secondary" data-testid="rule-pack-loading">Loading rule packs…</p>
      )}
      {state === 'error' && (
        <p className="text-apple-12 text-cinnabar" data-testid="rule-pack-load-error">{loadError}</p>
      )}

      {state === 'ready' && (
        <>
          {/* Signing key */}
          <section className="space-y-2" data-testid="rule-pack-key">
            <h3 className="text-apple-12 font-medium text-primary uppercase">Signing key</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label className="text-apple-11 font-medium text-secondary uppercase" htmlFor="rule-pack-key-id">Key id</label>
                <input id="rule-pack-key-id" data-testid="rule-pack-key-id" className={input}
                  value={keyId} onChange={(e) => setKeyId(e.target.value)} disabled={!canEdit} />
              </div>
              <button type="button" data-testid="rule-pack-key-generate" disabled={!canEdit || keyBusy}
                onClick={() => void generateKey()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50">
                <RefreshCw className="w-3.5 h-3.5" /> Generate key
              </button>
              <button type="button" data-testid="rule-pack-key-register" disabled={!canEdit || keyBusy || !key}
                onClick={() => void registerKey()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium bg-btn-primary-bg text-btn-primary-text disabled:opacity-50">
                <ShieldCheck className="w-3.5 h-3.5" /> Register public key
              </button>
              {key && (
                <span className="text-apple-11 text-secondary font-mono" data-testid="rule-pack-key-fingerprint">
                  pub {key.publicKeyHex.slice(0, 16)}…
                </span>
              )}
            </div>
            <p className="text-apple-11 text-secondary">
              The keypair is generated in this browser. The private key never leaves it; only the public
              key is registered. Registering retires the previous live key.
            </p>
          </section>

          {/* Packs */}
          <section className="space-y-2" data-testid="rule-pack-list-section">
            <div className="flex items-center justify-between">
              <h3 className="text-apple-12 font-medium text-primary uppercase">Packs</h3>
              <button type="button" data-testid="rule-pack-save" disabled={!canEdit || busy === 'save' || !key}
                onClick={() => void saveShippedPack()}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50">
                <Plus className="w-3.5 h-3.5" /> {busy === 'save' ? 'Saving…' : 'Save shipped pack as draft'}
              </button>
            </div>
            {packs.length === 0 ? (
              <p className="text-apple-12 text-secondary" data-testid="rule-pack-empty">
                No packs yet. Save the shipped population rules as a draft, then release it.
              </p>
            ) : (
              <div className="border border-hairline rounded-xl overflow-hidden bg-surface">
                <table className="w-full text-left border-collapse text-apple-12">
                  <thead>
                    <tr className="border-b border-hairline bg-surface-sunken text-secondary">
                      <th className="p-3 font-medium">Pack</th>
                      <th className="p-3 font-medium">Version</th>
                      <th className="p-3 font-medium">Target</th>
                      <th className="p-3 font-medium">Content hash</th>
                      <th className="p-3 font-medium">State</th>
                      <th className="p-3 font-medium" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {packs.map((p, i) => (
                      <tr key={p.id} data-testid={`rule-pack-row-${i}`} className="hover:bg-surface-hover">
                        <td className="p-3 text-primary font-medium">{p.name}</td>
                        <td className="p-3 font-mono text-secondary">v{p.version}</td>
                        <td className="p-3 text-secondary">{p.target}</td>
                        <td className="p-3 font-mono text-secondary">{packHash[i]}…</td>
                        <td className="p-3">
                          {p.released ? (
                            <span className="text-apple-11 font-semibold uppercase text-verdigris" data-testid={`rule-pack-released-${i}`}>released</span>
                          ) : (
                            <span className="text-apple-11 font-semibold uppercase text-secondary" data-testid={`rule-pack-draft-${i}`}>draft</span>
                          )}
                        </td>
                        <td className="p-3">
                          {!p.released && (
                            <button type="button" data-testid={`rule-pack-release-${i}`} disabled={!canEdit || busy === p.id}
                              onClick={() => void release(p.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-apple-11 font-medium border border-hairline text-primary hover:bg-surface-hover disabled:opacity-50">
                              <Zap className="w-3 h-3" /> Release
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Ad-hoc builder */}
          <section className="space-y-2" data-testid="rule-pack-adhoc">
            <h3 className="text-apple-12 font-medium text-primary uppercase">Ad-hoc rule builder</h3>
            <div className="grid grid-cols-2 gap-3 max-w-2xl">
              <label className="space-y-1 text-apple-11 text-secondary uppercase">Rule id
                <input data-testid="rule-pack-adhoc-id" className={input} value={adhoc.id}
                  onChange={(e) => setAdhoc((a) => ({ ...a, id: e.target.value }))} />
              </label>
              <label className="space-y-1 text-apple-11 text-secondary uppercase">Source attribute
                <input data-testid="rule-pack-adhoc-source" className={input} value={adhoc.source}
                  onChange={(e) => setAdhoc((a) => ({ ...a, source: e.target.value }))} />
              </label>
              <label className="space-y-1 text-apple-11 text-secondary uppercase">Condition
                <select data-testid="rule-pack-adhoc-condition" className={input} value={adhoc.condition}
                  onChange={(e) => setAdhoc((a) => ({ ...a, condition: e.target.value as AdhocRuleSpec['condition'] }))}>
                  {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-apple-11 text-secondary uppercase">Threshold
                <input data-testid="rule-pack-adhoc-threshold" type="number" className={input} value={adhoc.threshold}
                  onChange={(e) => setAdhoc((a) => ({ ...a, threshold: Number(e.target.value) }))} />
              </label>
              <label className="space-y-1 text-apple-11 text-secondary uppercase">Severity
                <select data-testid="rule-pack-adhoc-severity" className={input} value={adhoc.severity}
                  onChange={(e) => setAdhoc((a) => ({ ...a, severity: e.target.value as AdhocRuleSpec['severity'] }))}>
                  {['info', 'low', 'medium', 'high'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" data-testid="rule-pack-adhoc-preview" onClick={previewAdhoc}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-apple-12 font-medium border border-hairline text-primary hover:bg-surface-hover">
                <Zap className="w-3.5 h-3.5" /> Preview over sample rows
              </button>
              {adhocPreview && (
                <span className="text-apple-11 text-secondary font-mono" data-testid="rule-pack-adhoc-result">{adhocPreview}</span>
              )}
            </div>
            <p className="text-apple-11 text-secondary">
              The preview runs the built rule over three fixed sample rows so the condition is checked
              before it is saved. A built rule is an ordinary versioned rule: its findings cite its id
              and version like any shipped rule.
            </p>
          </section>

          {/* Refusal log */}
          <section className="space-y-2" data-testid="rule-pack-refusals">
            <h3 className="text-apple-12 font-medium text-primary uppercase inline-flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-cinnabar" /> Refused saves
            </h3>
            {refusals.length === 0 ? (
              <p className="text-apple-12 text-secondary" data-testid="rule-pack-refusals-empty">
                No pack has been refused for this organisation.
              </p>
            ) : (
              <ul className="space-y-1" data-testid="rule-pack-refusal-list">
                {refusals.map((r) => (
                  <li key={r.id} className="text-apple-12 text-secondary" data-testid={`rule-pack-refusal-${r.id}`}>
                    <span className="font-mono text-primary">{r.name}@v{r.version}</span> — {r.reason}
                    {r.detail ? `: ${r.detail}` : ''} · {r.createdAt}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};
