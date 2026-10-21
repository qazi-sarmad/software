import React, { useCallback, useEffect, useState } from 'react';
import {
  deleteFindingSection, getExportRetention, getLifecycleSettings, getUploadLimits, getWorkflowSettings,
  listBiParameters, listFindingSections, listFsliMappings, listMethodologyScales, listNotificationRules,
  saveExportRetention, saveLifecycleSettings, saveUploadLimits, saveWorkflowSettings, setBiParameter,
  upsertFindingSection, upsertFsliMapping, upsertMethodologyScale, upsertNotificationRule,
  FINDING_ROLE_TAGS, PLATFORM_EXTENSIONS, TEAM_ROLES,
  type BiParameterRow, type ExportRetentionSettings, type FindingSectionRow, type FsliMappingRow,
  type LifecycleSettings, type MethodologyScaleRow, type NotificationRuleRow, type UploadLimits,
  type WorkflowSettings,
} from '../../data/governance';
import type { DataResult } from '../../data/db';
import { InlineError } from '../common/InlineError';
import { Plus, X, Check } from '../common/Icons';

type LoadState = 'loading' | 'ready' | 'error';

const resultText = (r: DataResult | null): string =>
  r === null ? '' : r.ok ? 'Saved.' : r.reason;

/**
 * OA-22 governance settings (C3.2-B, spec §10, §12, §14.2, §20, §22, §23).
 *
 * The remaining Org Admin configuration, in a portal and never in JSON: one-stage or two-stage
 * testing with the sign-off role per stage; finding structure (section names and role tags);
 * methodology scales and FSLI mapping; workflow, SLA and escalation; notification rules by role with
 * a supervisor copy; export and retention; the BI check parameters within fixed platform ranges; and
 * the evidence size cap and accepted formats. Every save writes a versioned, logged change through
 * the RPCs in migration 0082.
 */
export const OrgGovernancePanel: React.FC = () => {
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [lifecycle, setLifecycle] = useState<LifecycleSettings | null>(null);
  const [workflow, setWorkflow] = useState<WorkflowSettings | null>(null);
  const [retention, setRetention] = useState<ExportRetentionSettings | null>(null);
  const [uploads, setUploads] = useState<UploadLimits | null>(null);
  const [sections, setSections] = useState<FindingSectionRow[]>([]);
  const [scales, setScales] = useState<MethodologyScaleRow[]>([]);
  const [fsli, setFsli] = useState<FsliMappingRow[]>([]);
  const [rules, setRules] = useState<NotificationRuleRow[]>([]);
  const [bi, setBi] = useState<BiParameterRow[]>([]);
  const [newSection, setNewSection] = useState({ roleTag: 'condition', label: '', position: 0, required: true });
  const [newScale, setNewScale] = useState({ key: '', label: '' });
  const [newFsli, setNewFsli] = useState({ code: '', label: '', category: '' });
  const [newRule, setNewRule] = useState({ eventKey: '', recipients: 'cia', supervisorCopy: true });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DataResult | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const [lc, wf, ret, up, sec, sc, fm, nr, bip] = await Promise.all([
        getLifecycleSettings(), getWorkflowSettings(), getExportRetention(), getUploadLimits(),
        listFindingSections(), listMethodologyScales(), listFsliMappings(), listNotificationRules(),
        listBiParameters(),
      ]);
      setLifecycle(lc); setWorkflow(wf); setRetention(ret); setUploads(up);
      setSections(sec); setScales(sc); setFsli(fm); setRules(nr); setBi(bip);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the governance settings.');
      setState('error');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (fn: () => Promise<DataResult>) => {
    setBusy(true);
    setResult(null);
    const r = await fn();
    setBusy(false);
    setResult(r);
    if (r.ok) await load();
    return r;
  };

  if (state === 'loading') {
    return <p className="text-sm opacity-70" data-testid="oa-governance-loading">Loading the governance settings…</p>;
  }
  if (state === 'error') {
    return <InlineError message={loadError} testId="oa-governance-error" />;
  }
  if (!lifecycle || !workflow || !retention || !uploads) {
    return <p className="text-sm opacity-70" data-testid="oa-governance-empty">No settings are available yet.</p>;
  }

  const field = 'w-full px-3 py-2 rounded-xl border border-hairline bg-canvas text-primary text-apple-13';
  const heading = 'text-apple-14 font-semibold text-primary';

  return (
    <div className="space-y-4" data-testid="oa-governance">
      {result && (
        <p className={`text-apple-12 ${result.ok ? 'text-verdigris' : 'text-cinnabar'}`} data-testid="oa-governance-result">
          {resultText(result)}
        </p>
      )}

      {/* §10.2, §10.4 — one-stage or two-stage testing and the sign-off role per stage. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="oa-governance-lifecycle">
        <h3 className={heading}>Engagement lifecycle</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Testing stages</span>
            <select
              value={lifecycle.testingMode}
              onChange={(e) => setLifecycle({ ...lifecycle, testingMode: e.target.value as LifecycleSettings['testingMode'] })}
              data-testid="oa-governance-testing-mode"
              className={field}
            >
              <option value="two_stage">Two-stage (DEA + OET)</option>
              <option value="one_stage">One-stage (OET only)</option>
            </select>
          </label>
          {(['signoffRolePlanning', 'signoffRoleTesting', 'signoffRoleConclusion'] as const).map((k) => (
            <label key={k} className="text-apple-12 text-secondary space-y-1">
              <span>Sign-off role — {k.replace('signoffRole', '')}</span>
              <select
                value={lifecycle[k]}
                onChange={(e) => setLifecycle({ ...lifecycle, [k]: e.target.value })}
                data-testid={`oa-governance-signoff-${k.replace('signoffRole', '').toLowerCase()}`}
                className={field}
              >
                {TEAM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          ))}
          <label className="flex items-center gap-2 text-apple-12 text-secondary">
            <input
              type="checkbox"
              checked={lifecycle.reportOpinionRequired}
              onChange={(e) => setLifecycle({ ...lifecycle, reportOpinionRequired: e.target.checked })}
              data-testid="oa-governance-opinion-required"
            />
            <span>The overall opinion is required at Conclusion</span>
          </label>
        </div>
        <button
          type="button" disabled={busy} onClick={() => void run(() => saveLifecycleSettings(lifecycle))}
          data-testid="oa-governance-lifecycle-save"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
        >
          <Check className="w-3.5 h-3.5" /> Save lifecycle settings
        </button>
      </section>

      {/* §14.2 — finding structure: names and role tags. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="oa-governance-findings">
        <h3 className={heading}>Finding structure</h3>
        <p className="text-apple-12 text-secondary">
          Every section carries one role tag. The tag, never the name, drives the readability check, so
          a section can be renamed freely.
        </p>
        <ul className="space-y-1" data-testid="oa-governance-findings-list">
          {sections.length === 0 && <li className="text-apple-12 text-secondary" data-testid="oa-governance-findings-empty">No sections are configured; the defaults apply.</li>}
          {sections.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded-xl border border-hairline px-3 py-2" data-testid={`oa-governance-section-${s.roleTag}`}>
              <span className="text-apple-13 text-primary">{s.label} <span className="text-apple-12 text-secondary">({s.roleTag}{s.required ? ', required' : ''})</span></span>
              <button type="button" disabled={busy} onClick={() => void run(() => deleteFindingSection(s.id))}
                data-testid={`oa-governance-section-delete-${s.roleTag}`} className="text-cinnabar hover:opacity-80">
                <X className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-4">
          <select value={newSection.roleTag} onChange={(e) => setNewSection({ ...newSection, roleTag: e.target.value })}
            data-testid="oa-governance-section-tag" className={field}>
            {FINDING_ROLE_TAGS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="Section name" value={newSection.label}
            onChange={(e) => setNewSection({ ...newSection, label: e.target.value })}
            data-testid="oa-governance-section-label" className={field} />
          <input type="number" placeholder="Order" value={newSection.position}
            onChange={(e) => setNewSection({ ...newSection, position: Number(e.target.value) })}
            data-testid="oa-governance-section-position" className={field} />
          <button type="button" disabled={busy || !newSection.label}
            onClick={() => void run(() => upsertFindingSection(newSection.roleTag, newSection.label, newSection.position, newSection.required))}
            data-testid="oa-governance-section-add"
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-accent-subtle disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Add section
          </button>
        </div>
      </section>

      {/* §23 — methodology scales and FSLI mapping. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="oa-governance-methodology">
        <h3 className={heading}>Methodology</h3>
        <ul className="space-y-1" data-testid="oa-governance-scales-list">
          {scales.map((s) => (
            <li key={s.id} className="text-apple-13 text-primary" data-testid={`oa-governance-scale-${s.key}`}>
              {s.label} <span className="text-apple-12 text-secondary">({s.points.length} points)</span>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-3">
          <input placeholder="Scale key" value={newScale.key} onChange={(e) => setNewScale({ ...newScale, key: e.target.value })}
            data-testid="oa-governance-scale-key" className={field} />
          <input placeholder="Scale label" value={newScale.label} onChange={(e) => setNewScale({ ...newScale, label: e.target.value })}
            data-testid="oa-governance-scale-label" className={field} />
          <button type="button" disabled={busy || !newScale.key}
            onClick={() => void run(() => upsertMethodologyScale(newScale.key, newScale.label || newScale.key, []))}
            data-testid="oa-governance-scale-add"
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-accent-subtle disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Add scale
          </button>
        </div>
        <ul className="space-y-1" data-testid="oa-governance-fsli-list">
          {fsli.map((f) => (
            <li key={f.id} className="text-apple-13 text-primary" data-testid={`oa-governance-fsli-${f.code}`}>
              {f.code} — {f.label}{f.category ? ` (${f.category})` : ''}
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-4">
          <input placeholder="FSLI code" value={newFsli.code} onChange={(e) => setNewFsli({ ...newFsli, code: e.target.value })}
            data-testid="oa-governance-fsli-code" className={field} />
          <input placeholder="FSLI label" value={newFsli.label} onChange={(e) => setNewFsli({ ...newFsli, label: e.target.value })}
            data-testid="oa-governance-fsli-label" className={field} />
          <input placeholder="Category" value={newFsli.category} onChange={(e) => setNewFsli({ ...newFsli, category: e.target.value })}
            data-testid="oa-governance-fsli-category" className={field} />
          <button type="button" disabled={busy || !newFsli.code || !newFsli.label}
            onClick={() => void run(() => upsertFsliMapping(newFsli.code, newFsli.label, newFsli.category || null))}
            data-testid="oa-governance-fsli-add"
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-accent-subtle disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Add mapping
          </button>
        </div>
      </section>

      {/* §7.1, §23 — workflow, SLA and escalation. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="oa-governance-workflow">
        <h3 className={heading}>Workflow, SLA and escalation</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-apple-12 text-secondary space-y-1">
            <span>SLA (hours)</span>
            <input type="number" value={workflow.slaHours}
              onChange={(e) => setWorkflow({ ...workflow, slaHours: Number(e.target.value) })}
              data-testid="oa-governance-sla-hours" className={field} />
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Escalate after (hours)</span>
            <input type="number" value={workflow.escalationHours}
              onChange={(e) => setWorkflow({ ...workflow, escalationHours: Number(e.target.value) })}
              data-testid="oa-governance-escalation-hours" className={field} />
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Escalate to role</span>
            <input value={workflow.escalationRole}
              onChange={(e) => setWorkflow({ ...workflow, escalationRole: e.target.value })}
              data-testid="oa-governance-escalation-role" className={field} />
          </label>
        </div>
        <button type="button" disabled={busy} onClick={() => void run(() => saveWorkflowSettings(workflow))}
          data-testid="oa-governance-workflow-save"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50">
          <Check className="w-3.5 h-3.5" /> Save workflow settings
        </button>
      </section>

      {/* §22 — notification rules by role, with a supervisor copy. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="oa-governance-notifications">
        <h3 className={heading}>Notification rules</h3>
        <ul className="space-y-1" data-testid="oa-governance-rules-list">
          {rules.length === 0 && <li className="text-apple-12 text-secondary" data-testid="oa-governance-rules-empty">No rules are configured; the platform defaults apply.</li>}
          {rules.map((r) => (
            <li key={r.id} className="text-apple-13 text-primary" data-testid={`oa-governance-rule-${r.eventKey}`}>
              {r.eventKey} → {r.recipientRoles.join(', ')} {r.supervisorCopy ? '(supervisor copied)' : ''} {r.enabled ? '' : '(off)'}
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-4">
          <input placeholder="Event key" value={newRule.eventKey} onChange={(e) => setNewRule({ ...newRule, eventKey: e.target.value })}
            data-testid="oa-governance-rule-event" className={field} />
          <input placeholder="Roles, comma-separated" value={newRule.recipients}
            onChange={(e) => setNewRule({ ...newRule, recipients: e.target.value })}
            data-testid="oa-governance-rule-roles" className={field} />
          <label className="flex items-center gap-2 text-apple-12 text-secondary">
            <input type="checkbox" checked={newRule.supervisorCopy}
              onChange={(e) => setNewRule({ ...newRule, supervisorCopy: e.target.checked })}
              data-testid="oa-governance-rule-supervisor" />
            <span>Copy the supervisor</span>
          </label>
          <button type="button" disabled={busy || !newRule.eventKey}
            onClick={() => void run(() => upsertNotificationRule(
              newRule.eventKey, newRule.recipients.split(',').map((s) => s.trim()).filter(Boolean), newRule.supervisorCopy, true))}
            data-testid="oa-governance-rule-add"
            className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-accent-subtle disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" /> Add rule
          </button>
        </div>
      </section>

      {/* §12 — BI parameters within fixed platform ranges. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="oa-governance-bi">
        <h3 className={heading}>Analyst parameters</h3>
        <p className="text-apple-12 text-secondary">
          Each check is tuned within a range the platform fixes. The organisation chooses a value inside
          the range; the deterministic logic is unchanged.
        </p>
        <ul className="space-y-2" data-testid="oa-governance-bi-list">
          {bi.map((b) => (
            <li key={b.checkKey} className="grid gap-2 sm:grid-cols-3 items-center" data-testid={`oa-governance-bi-${b.checkKey}`}>
              <span className="text-apple-13 text-primary">{b.label} <span className="text-apple-12 text-secondary">({b.minValue}–{b.maxValue})</span></span>
              <input type="number" step="any" value={b.value ?? b.defaultValue}
                onChange={(e) => setBi(bi.map((x) => x.checkKey === b.checkKey ? { ...x, value: Number(e.target.value) } : x))}
                data-testid={`oa-governance-bi-value-${b.checkKey}`} className={field} />
              <button type="button" disabled={busy}
                onClick={() => void run(() => setBiParameter(b.checkKey, b.value ?? b.defaultValue))}
                data-testid={`oa-governance-bi-save-${b.checkKey}`}
                className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-hairline text-apple-12 text-primary hover:bg-accent-subtle disabled:opacity-50">
                <Check className="w-3.5 h-3.5" /> Save
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* §20 — evidence size cap and accepted formats. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="oa-governance-uploads">
        <h3 className={heading}>Evidence upload limits</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Maximum file size (MB)</span>
            <input type="number" value={uploads.maxFileMb}
              onChange={(e) => setUploads({ ...uploads, maxFileMb: Number(e.target.value) })}
              data-testid="oa-governance-max-file-mb" className={field} />
          </label>
          <div className="text-apple-12 text-secondary space-y-1">
            <span>Accepted formats</span>
            <div className="flex flex-wrap gap-2 pt-1">
              {PLATFORM_EXTENSIONS.map((ext) => (
                <label key={ext} className="flex items-center gap-1">
                  <input type="checkbox" checked={uploads.allowedExtensions.includes(ext)}
                    onChange={(e) => setUploads({
                      ...uploads,
                      allowedExtensions: e.target.checked
                        ? [...uploads.allowedExtensions, ext]
                        : uploads.allowedExtensions.filter((x) => x !== ext),
                    })}
                    data-testid={`oa-governance-ext-${ext}`} />
                  <span>.{ext}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <button type="button" disabled={busy}
          onClick={() => void run(() => saveUploadLimits(uploads.maxFileMb, uploads.allowedExtensions))}
          data-testid="oa-governance-uploads-save"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50">
          <Check className="w-3.5 h-3.5" /> Save upload limits
        </button>
      </section>

      {/* §23 — export and retention. */}
      <section className="rounded-2xl border border-hairline bg-surface p-4 space-y-3" data-testid="oa-governance-retention">
        <h3 className={heading}>Export and retention</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Export schedule</span>
            <select value={retention.exportSchedule}
              onChange={(e) => setRetention({ ...retention, exportSchedule: e.target.value as ExportRetentionSettings['exportSchedule'] })}
              data-testid="oa-governance-export-schedule" className={field}>
              <option value="manual">Manual</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Activity retention (days)</span>
            <input type="number" value={retention.activityRetentionDays}
              onChange={(e) => setRetention({ ...retention, activityRetentionDays: Number(e.target.value) })}
              data-testid="oa-governance-activity-retention" className={field} />
          </label>
          <label className="text-apple-12 text-secondary space-y-1">
            <span>Population retention (months)</span>
            <input type="number" value={retention.populationRetentionMonths}
              onChange={(e) => setRetention({ ...retention, populationRetentionMonths: Number(e.target.value) })}
              data-testid="oa-governance-population-retention" className={field} />
          </label>
        </div>
        <button type="button" disabled={busy} onClick={() => void run(() => saveExportRetention(retention))}
          data-testid="oa-governance-retention-save"
          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50">
          <Check className="w-3.5 h-3.5" /> Save export and retention
        </button>
      </section>
    </div>
  );
};
