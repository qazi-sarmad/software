import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { InlineError } from '../common/InlineError';
import { Select } from '../common/Select';
import {
  listFormatAudiences, listReportFormats, publishReportFormat, saveReportFormat, setFormatAudiences,
  type FormatAudienceRow, type ReportFormatRow,
} from '../../data/writing';
import { listRoles, type RoleRow } from '../../data/admin';
import { REPORT_MODELS } from '../../lib/writing/models';
import { FORMALITY_DEFINITIONS, TONE_DEFINITIONS, VOICES } from '../../lib/writing/registers';
import { buildCanvas } from '../../lib/writing/canvas';
import { resolveHexColour } from '../../lib/render/branding';
import { canRedo, canUndo, initHistory, moveItem, pushHistory, redo, undo, type History } from '../../lib/writing/formatHistory';
import { REPORT_FONT_FAMILIES, REPORT_FONT_NAMES } from '../../lib/render/fonts';
import { FormatCanvas } from './FormatCanvas';
import {
  DEFAULT_FORMAT_LAYOUT, REPORT_PALETTE, RHETORICAL_ROLES, TYPOGRAPHY_LIMITS, applyFormat,
  defaultFormat, formatBodyHash, validateFormat,
  type BlockRole, type FormatBlock, type FormatLayout, type RegisterChoice, type ReportFormat,
} from '../../lib/writing/reportFormat';

type LoadState = 'loading' | 'ready' | 'error';
type Pane = 'layout' | 'blocks' | 'audiences' | 'versions';

const label = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (m) => m.toUpperCase());

const ROLE_OPTIONS: { value: BlockRole; label: string }[] = RHETORICAL_ROLES.map((r) => ({ value: r, label: label(r) }));

/**
 * The interactive report format editor (WRITE-1, owner instruction 2026-10-26).
 *
 * A Canva-style editor for the structure and print layout of a report, held PER CLIENT (one tenant
 * organisation) and VERSIONED. The editor works on a live draft: reorder blocks, hide them, give a
 * block its own register from the set the model allows, and change the print layout, watching the
 * page preview update as the controls change. Nothing here changes a fact: a format is presentation
 * only, so the graph root is identical whatever the format, and only the render hash moves.
 *
 * The roles a client may involve are configurable: the audience tab maps each of the client's own
 * roles to view or edit. The database still decides by RIGHT at call time; the audience list is the
 * client's declared intent, stored as data. No screen accepts JSON.
 */
export const ReportFormatPanel: React.FC<{ prefix?: string }> = ({ prefix = 'wk-format' }) => {
  const { currentUser } = useApp();
  const orgId = currentUser.orgId ?? '';
  const canEdit = hasRight(currentUser, 'edit_config');

  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pane, setPane] = useState<Pane>('blocks');

  const [versions, setVersions] = useState<ReportFormatRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');

  // The live draft the editor mutates. It starts from the newest version of the selected format.
  const [draft, setDraft] = useState<ReportFormat | null>(null);
  const [audiences, setAudiences] = useState<FormatAudienceRow[]>([]);
  // Undo/redo for the draft (WP-C2). Each edit pushes the previous draft; undo/redo move the cursor.
  const [history, setHistory] = useState<History<ReportFormat> | null>(null);

  const load = useCallback(async () => {
    if (!orgId) { setState('ready'); return; }
    setState('loading');
    setLoadError('');
    try {
      const [f, r] = await Promise.all([listReportFormats(orgId), listRoles()]);
      setVersions(f);
      setRoles(r);
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the report formats.');
      setState('error');
    }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);

  /** The formats grouped by key, newest version first, so the picker shows one row per format. */
  const keys = useMemo(() => {
    const seen: string[] = [];
    for (const v of versions) if (!seen.includes(v.formatKey)) seen.push(v.formatKey);
    return seen;
  }, [versions]);

  // When the list loads or the picked key changes, seed the draft from the newest version.
  useEffect(() => {
    if (!keys.length) { setDraft(null); return; }
    const key = keys.includes(selectedKey) ? selectedKey : keys[0];
    if (key !== selectedKey) { setSelectedKey(key); return; }
    const newest = versions.filter((v) => v.formatKey === key).sort((a, z) => z.version - a.version)[0];
    if (!newest) { setDraft(null); return; }
    setDraft({
      id: newest.id, orgId, formatKey: newest.formatKey, version: newest.version, label: newest.label,
      status: newest.status, modelId: newest.modelId,
      blocks: (newest.blocks as FormatBlock[]) ?? [],
      layout: { ...DEFAULT_FORMAT_LAYOUT, ...(newest.layout as Partial<FormatLayout>) },
      defaultLocale: newest.defaultLocale, audiences: [], createdBy: '', createdAt: newest.createdAt,
      bodyHash: newest.bodyHash,
    });
    setHistory(null);
    void listFormatAudiences(newest.id).then(setAudiences).catch(() => setAudiences([]));
  }, [keys, selectedKey, versions, orgId]);

  /** The model the draft targets, and the plan its sections come from. */
  const model = useMemo(() => REPORT_MODELS.find((m) => m.modelId === draft?.modelId) ?? REPORT_MODELS[0], [draft?.modelId]);

  /** The plan sections as the editor needs them, in plan order. */
  const plan = useMemo(() => model.plan.sections.map((s) => ({ key: s.id, role: s.role, label: s.heading })), [model]);

  const scope = useMemo(() => ({
    modelId: model.modelId,
    sectionIds: plan.map((p) => p.key),
    defaultLocale: model.defaultLocale,
    allowedRegisters: model.allowedRegisters as RegisterChoice[],
  }), [model, plan]);

  const issues = useMemo(() => (draft ? validateFormat(draft, scope) : []), [draft, scope]);
  const applied = useMemo(
    () => (draft ? applyFormat(draft, plan, model.defaultRegister as RegisterChoice) : null),
    [draft, plan, model.defaultRegister],
  );

  /** The live page model the canvas draws (WP-C2). Pure: the same draft always yields the same page. */
  const canvasPage = useMemo(
    () => (draft ? buildCanvas({ format: draft, plan, modelDefault: model.defaultRegister as RegisterChoice }) : null),
    [draft, plan, model.defaultRegister],
  );

  const mutate = (patch: Partial<ReportFormat>) => setDraft((d) => {
    if (!d) return d;
    const next = { ...d, ...patch };
    setHistory((h) => pushHistory(h ?? initHistory(d), next));
    return next;
  });

  const undoEdit = () => {
    if (!history) return;
    const next = undo(history);
    setHistory(next);
    setDraft(next.present);
  };

  const redoEdit = () => {
    if (!history) return;
    const next = redo(history);
    setHistory(next);
    setDraft(next.present);
  };

  /** Reorder blocks by dragging one block key onto another (WP-C2). */
  const reorderBlocks = (fromKey: string, toKey: string) => {
    if (!draft) return;
    const from = draft.blocks.findIndex((b) => b.key === fromKey);
    const to = draft.blocks.findIndex((b) => b.key === toKey);
    if (from < 0 || to < 0) return;
    mutate({ blocks: moveItem(draft.blocks, from, to) });
  };

  const moveBlock = (index: number, delta: number) => {
    if (!draft) return;
    const next = [...draft.blocks];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    mutate({ blocks: next });
  };

  const setBlock = (index: number, patch: Partial<FormatBlock>) => {
    if (!draft) return;
    mutate({ blocks: draft.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)) });
  };

  const addMissingSections = () => {
    if (!draft) return;
    const present = new Set(draft.blocks.map((b) => b.key));
    const add = plan.filter((p) => !present.has(p.key))
      .map((p) => ({ key: p.key, label: p.label, role: p.role, visible: true, register: null }));
    mutate({ blocks: [...draft.blocks, ...add] });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setResult(null);
    const bodyHash = await formatBodyHash({
      orgId, formatKey: draft.formatKey, version: draft.version, label: draft.label, status: draft.status,
      modelId: draft.modelId, blocks: draft.blocks, layout: draft.layout, defaultLocale: draft.defaultLocale,
      audiences: audiences.map((a) => ({ roleSlug: a.roleSlug, canView: a.canView, canEdit: a.canEdit })),
    });
    const r = await saveReportFormat(orgId, draft.formatKey, draft.modelId, draft.label, draft.blocks, draft.layout as unknown as Record<string, unknown>, draft.defaultLocale, bodyHash);
    setBusy(false);
    if (r.ok) {
      setResult(`Saved ${draft.formatKey}.`);
      await load();
    } else {
      setResult(r.reason ?? 'The save was refused.');
    }
  };

  const publish = async () => {
    if (!draft) return;
    setBusy(true);
    setResult(null);
    const r = await publishReportFormat(draft.id, issues.length);
    setBusy(false);
    setResult(r.ok ? `Published ${draft.formatKey} v${draft.version}.` : (r.reason ?? 'The publish was refused.'));
    if (r.ok) await load();
  };

  const saveAudiences = async () => {
    if (!draft) return;
    setBusy(true);
    setResult(null);
    const r = await setFormatAudiences(draft.id, audiences);
    setBusy(false);
    setResult(r.ok ? 'Audiences saved.' : (r.reason ?? 'The audience change was refused.'));
  };

  const toggleAudience = (roleSlug: string, field: 'canView' | 'canEdit') => {
    setAudiences((list) => {
      const has = list.find((a) => a.roleSlug === roleSlug);
      if (!has) {
        return field === 'canEdit'
          ? [...list, { roleSlug, canView: true, canEdit: true }]
          : [...list, { roleSlug, canView: true, canEdit: false }];
      }
      return list.map((a) => (a.roleSlug === roleSlug ? { ...a, [field]: !a[field], canView: field === 'canView' ? !a.canView : true } : a));
    });
  };

  if (state === 'loading') {
    return <div className="py-8 text-center text-apple-13 text-secondary" data-testid={`${prefix}-loading`}>Loading report formats…</div>;
  }
  if (state === 'error') {
    return (
      <div className="p-4 space-y-2" data-testid={`${prefix}-error`}>
        <InlineError message={loadError} testId={`${prefix}-error-message`} />
        <button type="button" className="text-apple-12 underline text-secondary" data-testid={`${prefix}-retry`} onClick={() => void load()}>Retry</button>
      </div>
    );
  }
  if (!draft) {
    return (
      <div className="p-4 space-y-2" data-testid={`${prefix}-empty`}>
        <div className="text-apple-13 text-primary">No report format yet.</div>
        <button type="button" className="text-apple-12 underline text-secondary" data-testid={`${prefix}-create-default`}
          onClick={() => {
            const base = defaultFormat(orgId, 'default', model.modelId, plan, model.defaultLocale, DEFAULT_FORMAT_LAYOUT);
            setDraft({ ...base, id: '', createdAt: '', createdBy: '', bodyHash: '' });
            setSelectedKey('default');
          }}>Start a format from the model default</button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={`${prefix}-panel`}>
      <div className="p-4 rounded-2xl bg-surface border border-hairline grid grid-cols-2 gap-3 md:grid-cols-4" data-testid={`${prefix}-controls`}>
        <label className="space-y-1 text-apple-11 text-secondary">
          Format
          <Select ariaLabel="Report format" value={selectedKey} testId={`${prefix}-format-pick`}
            options={keys.map((k) => ({ value: k, label: k }))}
            onChange={(v) => setSelectedKey(v)} />
        </label>
        <label className="space-y-1 text-apple-11 text-secondary">
          Report model
          <Select ariaLabel="Report model" value={draft.modelId} testId={`${prefix}-model-pick`}
            options={REPORT_MODELS.map((m) => ({ value: m.modelId, label: `${m.modelId} · ${m.title}` }))}
            onChange={(v) => {
              const m = REPORT_MODELS.find((x) => x.modelId === v)!;
              mutate({
                modelId: v,
                blocks: m.plan.sections.map((s) => ({ key: s.id, label: s.heading, role: s.role, visible: true, register: null })),
              });
            }} />
        </label>
        <label className="space-y-1 text-apple-11 text-secondary">
          Default locale
          <Select ariaLabel="Default locale" value={draft.defaultLocale} testId={`${prefix}-locale-pick`}
            options={[{ value: 'en-GB', label: 'en-GB (UK)' }, { value: 'en-US', label: 'en-US (US)' }]}
            onChange={(v) => mutate({ defaultLocale: v as 'en-GB' | 'en-US' })} />
        </label>
        <label className="space-y-1 text-apple-11 text-secondary">
          Label
          <input className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
            data-testid={`${prefix}-label-input`} value={draft.label}
            onChange={(e) => mutate({ label: e.target.value })} />
        </label>
      </div>

      <div className="flex items-center gap-3 flex-wrap text-apple-11 text-secondary" data-testid={`${prefix}-status`}>
        <span data-testid={`${prefix}-version`}>Version {draft.version}</span>
        <span data-testid={`${prefix}-status-value`}>{label(draft.status)}</span>
        <span data-testid={`${prefix}-issues`}>{issues.length === 0 ? 'Valid for its model.' : `${issues.length} issue(s)`}</span>
        {draft.status === 'published' && <span data-testid={`${prefix}-published-note`}>A published version is immutable; saving creates the next version.</span>}
      </div>

      <div className="flex items-center gap-2 flex-wrap" data-testid={`${prefix}-pane-tabs`}>
        {(['blocks', 'layout', 'audiences', 'versions'] as Pane[]).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={pane === id} data-testid={`${prefix}-pane-${id}`}
            className={`px-3 py-1 rounded-xl text-apple-12 ${pane === id ? 'bg-accent-subtle text-primary' : 'text-secondary hover:text-primary'}`}
            onClick={() => setPane(id)}>{label(id)}</button>
        ))}
      </div>

      {pane === 'blocks' && (
        <div className="space-y-2" data-testid={`${prefix}-blocks`}>
          {draft.blocks.map((b, i) => (
            <div key={b.key} className="p-3 rounded-xl border border-hairline bg-surface grid grid-cols-2 gap-2 md:grid-cols-5 items-center" data-testid={`${prefix}-block-${b.key}`}>
              <span className="text-apple-13 text-primary" data-testid={`${prefix}-block-${b.key}-key`}>{b.label || b.key}</span>
              <Select ariaLabel={`Role for ${b.key}`} value={b.role} testId={`${prefix}-block-${b.key}-role`}
                options={ROLE_OPTIONS} onChange={(v) => setBlock(i, { role: v as BlockRole })} />
              <Select ariaLabel={`Register for ${b.key}`} value={b.register ? `${b.register.formality}-${b.register.tone}-${b.register.voice}` : 'default'}
                testId={`${prefix}-block-${b.key}-register`}
                options={[{ value: 'default', label: 'Model default' }, ...model.allowedRegisters.map((r) => ({
                  value: `${r.formality}-${r.tone}-${r.voice}`,
                  label: `F${r.formality} ${FORMALITY_DEFINITIONS[r.formality].name} · T${r.tone} ${TONE_DEFINITIONS[r.tone].name} · ${r.voice}`,
                }))]}
                onChange={(v) => {
                  if (v === 'default') { setBlock(i, { register: null }); return; }
                  const [f, t, voice] = v.split('-');
                  setBlock(i, { register: { formality: Number(f) as 1 | 2 | 3 | 4 | 5, tone: Number(t) as 1 | 2 | 3 | 4 | 5, voice: voice as 'active' | 'passive' } });
                }} />
              <label className="inline-flex items-center gap-2 text-apple-12 text-secondary">
                <input type="checkbox" checked={b.visible} data-testid={`${prefix}-block-${b.key}-visible`}
                  onChange={(e) => setBlock(i, { visible: e.target.checked })} />
                Visible
              </label>
              <span className="flex gap-2">
                <button type="button" className="text-apple-12 underline text-secondary" data-testid={`${prefix}-block-${b.key}-up`} onClick={() => moveBlock(i, -1)}>Up</button>
                <button type="button" className="text-apple-12 underline text-secondary" data-testid={`${prefix}-block-${b.key}-down`} onClick={() => moveBlock(i, 1)}>Down</button>
              </span>
            </div>
          ))}
          {plan.some((p) => !draft.blocks.some((b) => b.key === p.key)) && (
            <button type="button" className="text-apple-12 underline text-secondary" data-testid={`${prefix}-add-missing`} onClick={addMissingSections}>
              Add the sections this model defines but the format omits
            </button>
          )}
          {issues.length > 0 && (
            <ul className="text-apple-11 text-cinnabar space-y-1" data-testid={`${prefix}-issue-list`}>
              {issues.map((it) => <li key={`${it.code}-${it.field}`} data-testid={`${prefix}-issue-${it.code}`}>{it.field}: {it.message}</li>)}
            </ul>
          )}
        </div>
      )}

      {pane === 'layout' && (
        <div className="space-y-3" data-testid={`${prefix}-layout`}>
          <div className="flex items-center gap-2 flex-wrap" data-testid={`${prefix}-history-bar`}>
            <button type="button" disabled={!history || !canUndo(history)} data-testid={`${prefix}-undo`}
              className="px-2 py-1 rounded-lg bg-surface-hover text-apple-12 text-primary disabled:opacity-40"
              onClick={undoEdit}>Undo</button>
            <button type="button" disabled={!history || !canRedo(history)} data-testid={`${prefix}-redo`}
              className="px-2 py-1 rounded-lg bg-surface-hover text-apple-12 text-primary disabled:opacity-40"
              onClick={redoEdit}>Redo</button>
            <span className="text-apple-11 text-secondary" data-testid={`${prefix}-history-depth`}>
              {history ? `${history.past.length} undo · ${history.future.length} redo` : 'no edits yet'}
            </span>
          </div>

          <div className="p-4 rounded-2xl border border-hairline bg-surface grid grid-cols-2 gap-3 md:grid-cols-4" data-testid={`${prefix}-layout-grid`}>
            <label className="space-y-1 text-apple-11 text-secondary">
              Page size
              <Select ariaLabel="Page size" value={draft.layout.pageSize} testId={`${prefix}-layout-page-size`}
                options={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }]}
                onChange={(v) => mutate({ layout: { ...draft.layout, pageSize: v as 'A4' | 'Letter' } })} />
            </label>
            {([['marginTopMm', 'Top margin'], ['marginRightMm', 'Right margin'], ['marginBottomMm', 'Bottom margin'], ['marginLeftMm', 'Left margin']] as const).map(([k, name]) => (
              <label key={k} className="space-y-1 text-apple-11 text-secondary">
                {name} (mm)
                <input type="number" min={0} className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
                  data-testid={`${prefix}-layout-${k}`} value={draft.layout[k]}
                  onChange={(e) => mutate({ layout: { ...draft.layout, [k]: Number(e.target.value) } })} />
              </label>
            ))}
            <label className="space-y-1 text-apple-11 text-secondary">
              Heading font
              <Select ariaLabel="Heading font" value={draft.layout.fontHeading} testId={`${prefix}-layout-font-heading`}
                options={REPORT_FONT_NAMES.map((f) => ({ value: f, label: f }))}
                onChange={(v) => mutate({ layout: { ...draft.layout, fontHeading: v } })} />
            </label>
            <label className="space-y-1 text-apple-11 text-secondary">
              Body font
              <Select ariaLabel="Body font" value={draft.layout.fontBody} testId={`${prefix}-layout-font-body`}
                options={REPORT_FONT_NAMES.map((f) => ({ value: f, label: f }))}
                onChange={(v) => mutate({ layout: { ...draft.layout, fontBody: v } })} />
            </label>
            <label className="space-y-1 text-apple-11 text-secondary">
              Body size (pt)
              <input type="number" min={TYPOGRAPHY_LIMITS.fontSizePt.min} max={TYPOGRAPHY_LIMITS.fontSizePt.max}
                className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
                data-testid={`${prefix}-layout-font-size`} value={draft.layout.fontSizePt}
                onChange={(e) => mutate({ layout: { ...draft.layout, fontSizePt: Number(e.target.value) } })} />
            </label>
            <label className="space-y-1 text-apple-11 text-secondary">
              Heading size (%)
              <input type="number" min={TYPOGRAPHY_LIMITS.headingScalePct.min} max={TYPOGRAPHY_LIMITS.headingScalePct.max}
                className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
                data-testid={`${prefix}-layout-heading-scale`} value={draft.layout.headingScalePct}
                onChange={(e) => mutate({ layout: { ...draft.layout, headingScalePct: Number(e.target.value) } })} />
            </label>
            <label className="space-y-1 text-apple-11 text-secondary">
              Line height (%)
              <input type="number" min={TYPOGRAPHY_LIMITS.lineHeightPct.min} max={TYPOGRAPHY_LIMITS.lineHeightPct.max}
                className="w-full px-2 py-1 rounded-lg bg-surface-hover text-apple-13 text-primary"
                data-testid={`${prefix}-layout-line-height`} value={draft.layout.lineHeightPct}
                onChange={(e) => mutate({ layout: { ...draft.layout, lineHeightPct: Number(e.target.value) } })} />
            </label>
            <label className="space-y-1 text-apple-11 text-secondary">
              Body weight
              <Select ariaLabel="Body weight" value={String(draft.layout.fontWeightBody)} testId={`${prefix}-layout-weight-body`}
                options={TYPOGRAPHY_LIMITS.fontWeight.map((w) => ({ value: String(w), label: String(w) }))}
                onChange={(v) => mutate({ layout: { ...draft.layout, fontWeightBody: Number(v) } })} />
            </label>
            <label className="space-y-1 text-apple-11 text-secondary">
              Heading weight
              <Select ariaLabel="Heading weight" value={String(draft.layout.fontWeightHeading)} testId={`${prefix}-layout-weight-heading`}
                options={TYPOGRAPHY_LIMITS.fontWeight.map((w) => ({ value: String(w), label: String(w) }))}
                onChange={(v) => mutate({ layout: { ...draft.layout, fontWeightHeading: Number(v) } })} />
            </label>
            <label className="inline-flex items-center gap-2 text-apple-12 text-secondary mt-5">
              <input type="checkbox" checked={draft.layout.showFooter} data-testid={`${prefix}-layout-footer`}
                onChange={(e) => mutate({ layout: { ...draft.layout, showFooter: e.target.checked } })} />
              Print the footer line with the hashes
            </label>
          </div>

          <div className="p-4 rounded-2xl border border-hairline bg-surface space-y-3" data-testid={`${prefix}-colours`}>
            <div className="text-apple-12 text-primary">Colours</div>
            {([['colourPrimary', 'Primary'], ['colourAccent', 'Accent'], ['colourText', 'Text'], ['colourBackground', 'Background']] as const).map(([key, name]) => (
              <div key={key} className="flex items-center gap-2 flex-wrap" data-testid={`${prefix}-colour-${key}`}>
                <span className="w-24 text-apple-12 text-secondary">{name}</span>
                <input type="color" aria-label={`${name} colour`} value={resolveHexColour(draft.layout[key])}
                  data-testid={`${prefix}-colour-${key}-input`}
                  onChange={(e) => mutate({ layout: { ...draft.layout, [key]: e.target.value.toUpperCase() } })} />
                {REPORT_PALETTE.map((p) => (
                  <button key={p.value} type="button" title={p.name} aria-label={`${name}: ${p.name}`}
                    data-testid={`${prefix}-colour-${key}-swatch-${p.name.toLowerCase().replace(/\s+/g, '-')}`}
                    className="w-5 h-5 rounded-md border border-hairline"
                    style={{ background: p.value }} onClick={() => mutate({ layout: { ...draft.layout, [key]: p.value } })} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {pane === 'audiences' && (
        <div className="p-4 rounded-2xl border border-hairline bg-surface space-y-2" data-testid={`${prefix}-audiences`}>
          <div className="text-apple-12 text-primary">Which of this client's roles may view or edit the format</div>
          <div className="text-apple-11 text-secondary" data-testid={`${prefix}-audiences-note`}>
            The database still decides by right at call time. This list is the client's declared intent, stored as data.
          </div>
          {roles.length === 0 && <div className="text-apple-12 text-secondary" data-testid={`${prefix}-audiences-empty`}>No roles to map.</div>}
          {roles.map((role) => {
            const a = audiences.find((x) => x.roleSlug === role.slug);
            return (
              <div key={role.slug} className="flex items-center gap-4 text-apple-12 text-secondary" data-testid={`${prefix}-audience-${role.slug}`}>
                <span className="w-40 text-primary">{role.name} ({role.slug})</span>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={a?.canView ?? false} data-testid={`${prefix}-audience-${role.slug}-view`}
                    onChange={() => toggleAudience(role.slug, 'canView')} />
                  View
                </label>
                <label className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={a?.canEdit ?? false} data-testid={`${prefix}-audience-${role.slug}-edit`}
                    onChange={() => toggleAudience(role.slug, 'canEdit')} />
                  Edit
                </label>
              </div>
            );
          })}
          <button type="button" disabled={!canEdit || busy} className="text-apple-12 underline text-secondary disabled:opacity-50"
            data-testid={`${prefix}-audiences-save`} onClick={() => void saveAudiences()}>Save audiences</button>
        </div>
      )}

      {pane === 'versions' && (
        <div className="space-y-2" data-testid={`${prefix}-versions`}>
          {versions.filter((v) => v.formatKey === draft.formatKey).map((v) => (
            <div key={v.id} className="p-3 rounded-xl border border-hairline bg-surface flex items-center gap-3 text-apple-12 text-secondary" data-testid={`${prefix}-version-${v.version}`}>
              <span className="text-primary">v{v.version}</span>
              <span>{label(v.status)}</span>
              <span>{v.label}</span>
              <span className="text-apple-11">{v.bodyHash.slice(0, 16)}…</span>
              <button type="button" className="underline" data-testid={`${prefix}-version-${v.version}-load`}
                onClick={() => setSelectedKey(v.formatKey)}>Load</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2" data-testid={`${prefix}-preview`}>
        <div className="p-4 rounded-2xl border border-hairline bg-surface space-y-2">
          <div className="text-apple-12 text-primary">Page preview</div>
          <div className="text-apple-11 text-secondary" data-testid={`${prefix}-preview-summary`}>
            {applied?.blocks.length ?? 0} block(s) shown · {applied?.hidden.length ?? 0} hidden
          </div>
          <ol className="space-y-1 text-apple-12 text-secondary" data-testid={`${prefix}-preview-blocks`}>
            {applied?.blocks.map((b) => (
              <li key={b.key} data-testid={`${prefix}-preview-${b.key}`}>
                {b.label} — F{b.register.formality} {FORMALITY_DEFINITIONS[b.register.formality].name} · T{b.register.tone} · {b.register.voice}
              </li>
            ))}
          </ol>
          {applied && applied.hidden.length > 0 && (
            <div className="text-apple-11 text-secondary" data-testid={`${prefix}-preview-hidden`}>Hidden: {applied.hidden.join(', ')}</div>
          )}
          <div className="text-apple-11 text-secondary" data-testid={`${prefix}-preview-registers`}>
            Registers in use: {VOICES.join(', ')}
          </div>
        </div>
        <div className="space-y-2" data-testid={`${prefix}-canvas-pane`}>
          <div className="text-apple-12 text-primary">Live page</div>
          <div className="text-apple-11 text-secondary" data-testid={`${prefix}-canvas-summary`}>
            {canvasPage ? `${canvasPage.pageSize} · ${canvasPage.blocks.length} block(s)${canvasPage.overflowsFirstPage ? ' · continues past page 1' : ''}` : 'no page'}
          </div>
          {canvasPage && (
            <FormatCanvas
              page={canvasPage}
              colours={{
                primary: draft.layout.colourPrimary, accent: draft.layout.colourAccent,
                text: draft.layout.colourText, background: draft.layout.colourBackground,
              }}
              fonts={{ heading: draft.layout.fontHeading, body: draft.layout.fontBody }}
              onReorder={reorderBlocks}
              prefix={`${prefix}-canvas`}
            />
          )}
          <div className="text-apple-11 text-secondary">Drag a block onto another to reorder the report.</div>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" disabled={!canEdit || busy} className="px-3 py-1 rounded-xl bg-accent-subtle text-apple-13 text-primary disabled:opacity-50"
          data-testid={`${prefix}-save`} onClick={() => void save()}>Save draft</button>
        <button type="button" disabled={!canEdit || busy || issues.length > 0} className="px-3 py-1 rounded-xl bg-accent-subtle text-apple-13 text-primary disabled:opacity-50"
          data-testid={`${prefix}-publish`} onClick={() => void publish()}>Publish version</button>
        {result && <span className="text-apple-12 text-secondary" data-testid={`${prefix}-result`}>{result}</span>}
        {!canEdit && <span className="text-apple-12 text-secondary" data-testid={`${prefix}-readonly`}>Read-only: you need the Edit configuration right.</span>}
      </div>
    </div>
  );
};
