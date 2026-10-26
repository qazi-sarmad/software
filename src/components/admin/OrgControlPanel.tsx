import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { hasRight } from '../../lib/rights';
import { listFeatureCatalogue, listTenantEntitlements, type FeatureRow } from '../../data/entitlements';
import {
  acknowledgeConsultation, getActiveConsultation, requestConsultation, type ConsultationSession,
} from '../../data/consultation';
import type { DataResult } from '../../data/db';
import { SetupWizard } from '../common/SetupWizard';
import { TutorialButton } from '../common/TutorialButton';
import { OrgConfigHistory } from './OrgConfigHistory';
import { SuperAdminTutorials } from '../superadmin/SuperAdminTutorials';
import { ChangeControlPanel } from './ChangeControlPanel';
import { ConnectorMonitorPanel } from '../writing/ConnectorMonitorPanel';
import { ReportFormatPanel } from '../writing/ReportFormatPanel';
import { OrgEmailPanel } from './OrgEmailPanel';
import { OrgAutomationPanel } from './OrgAutomationPanel';
import { OrgBrandingPanel } from './OrgBrandingPanel';
import { OrgEscalationPanel } from './OrgEscalationPanel';
import { ExternalAuditorsPanel } from './ExternalAuditorsPanel';
import { OrgHostingPanel } from './OrgHostingPanel';
import { OrgGovernancePanel } from './OrgGovernancePanel';
import { InlineError } from '../common/InlineError';
import { Check, Lock, Zap, Sliders, Users, Shield, History, Database } from '../common/Icons';

type Tab = 'features' | 'branding' | 'email' | 'automation' | 'escalation' | 'setup' | 'consultation' | 'auditors' | 'hosting' | 'governance' | 'history' | 'changes' | 'tutorials' | 'connectors' | 'formats';
type LoadState = 'loading' | 'ready' | 'error';

/** F18: every configuration tab carries its own "Show me how" tutorial key (Appendix A). */
const TAB_TUTORIAL: Record<Tab, { key: string; title: string }> = {
  features: { key: 'oa.features', title: 'OA-04 features' },
  branding: { key: 'oa.branding', title: 'OA-02/03 branding and report format' },
  email: { key: 'oa.email-resend', title: 'OA-11 email sender' },
  automation: { key: 'oa.automation', title: 'OA-12 notification rules' },
  escalation: { key: 'oa.escalation', title: 'OA-13 escalation rules' },
  setup: { key: 'oa.setup-wizard', title: 'OA-01 setup wizard' },
  consultation: { key: 'oa.dual-session', title: 'OA-16 Dual Session' },
  auditors: { key: 'oa.auditors', title: 'OA-14 external auditors' },
  hosting: { key: 'oa.hosting', title: 'OA-15 hosting and database' },
  governance: { key: 'oa.governance', title: 'OA-22 governance settings' },
  history: { key: 'oa.history', title: 'OA-17 configuration history' },
  changes: { key: 'oa.history', title: 'OA-17 change control' },
  tutorials: { key: 'oa.tutorials', title: 'OA-18 tutorial library' },
  connectors: { key: 'oa.connectors', title: 'OA-23 connectors and monitoring' },
  formats: { key: 'oa.formats', title: 'OA-24 report format editor' },
};

/**
 * Org Admin control panel (OA-04 features read-only, OA-01 setup wizard, OA-16 Dual Session).
 *
 * A non-blocking Org Admin surface. OA-04 shows the organisation's effective feature set read-only
 * with "Ask QSCorp to add this" for add-ons: only the Super Admin writes entitlements. The setup
 * wizard persists its state through src/data/setup.ts. The Dual Session tab shows the GL-01 banner
 * and lets the Org Admin end a session.
 */
export const OrgControlPanel: React.FC = () => {
  const { currentUser } = useApp();
  const canEdit = hasRight(currentUser, 'edit_config');
  const [tab, setTab] = useState<Tab>('features');
  const [state, setState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');
  const [catalogue, setCatalogue] = useState<FeatureRow[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteResult, setInviteResult] = useState<DataResult | null>(null);
  const [session, setSession] = useState<ConsultationSession | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setLoadError('');
    try {
      const cats = await listFeatureCatalogue();
      setCatalogue(cats);
      const orgId = currentUser.orgId ?? '';
      const ents = orgId ? await listTenantEntitlements(orgId) : [];
      setEnabled(new Set(ents.filter((e) => e.enabled).map((e) => e.featureKey)));
      setState('ready');
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the control plane.');
      setState('error');
    }
  }, [currentUser.orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const invite = useCallback(async () => {
    if (!currentUser.orgId) return;
    setInviteBusy(true);
    setInviteResult(null);
    const r = await requestConsultation(currentUser.orgId, 'full_admin', 4);
    setInviteBusy(false);
    setInviteResult(r);
    if (r.ok) setSession(await getActiveConsultation(currentUser.orgId));
  }, [currentUser.orgId]);

  const acknowledge = useCallback(async () => {
    if (!session) return;
    setInviteBusy(true);
    const r = await acknowledgeConsultation(session.id);
    setInviteBusy(false);
    setInviteResult(r);
    if (r.ok && currentUser.orgId) setSession(await getActiveConsultation(currentUser.orgId));
  }, [session, currentUser.orgId]);

  useEffect(() => {
    if (tab !== 'consultation' || !currentUser.orgId) return;
    let live = true;
    getActiveConsultation(currentUser.orgId)
      .then((s) => {
        if (live) setSession(s);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tab, currentUser.orgId]);

  if (!canEdit) {
    return (
      <div className="p-6" data-testid="org-control-no-right">
        <InlineError message="You need the Edit configuration right to open the control plane." testId="org-control-denied" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4" data-testid="org-control-panel">
      <div className="flex items-center justify-between gap-2">
        <nav className="flex flex-wrap gap-1" data-testid="org-control-tabs">
        {([
          { id: 'features', label: 'Features', icon: Zap },
          { id: 'branding', label: 'Branding', icon: Sliders },
          { id: 'email', label: 'Email', icon: Check },
          { id: 'automation', label: 'Rules', icon: Zap },
          { id: 'escalation', label: 'Escalation', icon: Shield },
          { id: 'setup', label: 'Setup', icon: Sliders },
          { id: 'consultation', label: 'Dual Session', icon: Users },
          { id: 'auditors', label: 'External auditors', icon: Shield },
          { id: 'hosting', label: 'Hosting', icon: Database },
          { id: 'governance', label: 'Governance', icon: Sliders },
          { id: 'history', label: 'History', icon: History },
          { id: 'changes', label: 'Change control', icon: Shield },
          { id: 'tutorials', label: 'Tutorials', icon: History },
          { id: 'connectors', label: 'Connectors', icon: Database },
          { id: 'formats', label: 'Report formats', icon: Sliders },
        ] as { id: Tab; label: string; icon: React.FC<{ className?: string }> }[]).map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              data-testid={`org-control-tab-${t.id}`}
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-apple-13 font-medium transition-colors ${tab === t.id ? 'bg-accent-subtle text-primary' : 'text-secondary hover:text-primary'}`}
            >
              <Icon className="w-4 h-4 stroke-[1.5]" />
              {t.label}
            </button>
          );
        })}
        </nav>
        <TutorialButton
          tutorialKey={TAB_TUTORIAL[tab].key}
          title={TAB_TUTORIAL[tab].title}
          screenId={`org-${tab}`}
        />
      </div>

      {tab === 'features' && (
        <div data-testid="org-features">
          <InlineError message={state === 'error' ? loadError : null} testId="org-features-error" />
          {state === 'loading' ? (
            <div className="py-8 text-center text-secondary text-apple-13" data-testid="org-features-loading">Loading features…</div>
          ) : (
            <div className="rounded-2xl border border-hairline bg-surface p-4 space-y-2">
              <h3 className="text-apple-14 font-semibold text-primary">Your features</h3>
              <p className="text-apple-12 text-secondary">
                This is what your plan includes. Only QSCorp can change it — ask them to add an
                add-on.
              </p>
              <ul className="divide-y divide-hairline" data-testid="org-features-list">
                {catalogue.map((f) => {
                  const on = enabled.has(f.key);
                  return (
                    <li key={f.key} className="flex items-center justify-between py-2" data-testid={`org-feature-${f.key}`}>
                      <div>
                        <div className="text-apple-13 text-primary">{f.label}</div>
                        <div className="text-apple-11 text-tertiary">{f.description}</div>
                      </div>
                      <span className={`inline-flex items-center gap-1 text-apple-12 ${on ? 'text-accent' : 'text-tertiary'}`}>
                        {on ? <Check className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                        {on ? 'included' : f.priceClass === 'add_on' ? 'Ask QSCorp to add this' : 'not included'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'auditors' && <ExternalAuditorsPanel orgId={currentUser.orgId ?? ''} />}
      {tab === 'branding' && <OrgBrandingPanel />}
      {tab === 'email' && <OrgEmailPanel />}
      {tab === 'automation' && <OrgAutomationPanel />}
      {tab === 'escalation' && <OrgEscalationPanel orgId={currentUser.orgId ?? ''} />}
      {tab === 'setup' && (
        <div data-testid="org-setup">
          <SetupWizard scope="org_admin" enabledFeatures={[...enabled]} />
        </div>
      )}

      {tab === 'consultation' && (
        <div data-testid="org-consultation" className="space-y-3">
          <h3 className="text-apple-14 font-semibold text-primary">QSCorp consultation</h3>
          <p className="text-apple-12 text-secondary">
            When QSCorp is helping you, a banner appears at the top of every screen. You can end the
            session at any time. A consultation never gives QSCorp access to your audit content.
          </p>
          <p className="text-apple-12 text-secondary">
            Inviting QSCorp gives them tier 2 (full admin help) for up to 4 hours. In tier 2 every
            change they make is only a proposal until you approve it here.
          </p>
          {session && (
            <div className="rounded-xl border border-hairline bg-surface px-4 py-3 space-y-1" data-testid="org-consultation-session">
              <div className="text-apple-12 text-primary">
                {session.status === 'requested'
                  ? 'QSCorp has asked to help with your configuration.'
                  : 'QSCorp is helping you right now.'}{' '}
                ({session.kind === 'full_admin' ? 'tier 2' : 'tier 1'})
              </div>
              {session.status === 'requested' && session.initiatedBySide === 'platform' && (
                <button
                  type="button"
                  disabled={inviteBusy}
                  onClick={() => void acknowledge()}
                  data-testid="org-consultation-acknowledge"
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
                >
                  <Shield className="w-3.5 h-3.5" /> Acknowledge
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={inviteBusy || !currentUser.orgId}
              onClick={() => void invite()}
              data-testid="org-consultation-invite"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-accent text-white text-apple-12 font-medium hover:opacity-90 disabled:opacity-50"
            >
              <Users className="w-3.5 h-3.5" /> Invite QSCorp (tier 2)
            </button>
            <InlineError message={inviteResult && !inviteResult.ok ? inviteResult.reason : null} testId="org-consultation-result" />
          </div>
        </div>
      )}

      {tab === 'connectors' && <ConnectorMonitorPanel />}
      {tab === 'formats' && <ReportFormatPanel />}
      {tab === 'hosting' && <OrgHostingPanel />}
      {tab === 'governance' && <OrgGovernancePanel />}
      {tab === 'history' && <OrgConfigHistory />}
      {tab === 'changes' && <ChangeControlPanel mode="settings" />}
      {tab === 'tutorials' && (
        <div data-testid="org-tutorials">
          <SuperAdminTutorials audience="org_admin" />
        </div>
      )}
    </div>
  );
};
