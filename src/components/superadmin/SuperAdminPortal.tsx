import React, { useCallback, useEffect, useState } from 'react';
import { platformWhoami, claimPlatformOwnership } from '../../data/platform';
import { InlineError } from '../common/InlineError';
import { Building, Shield, Users, Zap, Eye, History, Send, Database, RefreshCw } from '../common/Icons';
import { SuperAdminTenants } from './SuperAdminTenants';
import { SuperAdminSupport } from './SuperAdminSupport';
import { SuperAdminTrail } from './SuperAdminTrail';
import { SuperAdminConsultation } from './SuperAdminConsultation';
import { SuperAdminFeatures } from './SuperAdminFeatures';
import { SuperAdminRecipients } from './SuperAdminRecipients';
import { SuperAdminTutorials } from './SuperAdminTutorials';
import { SuperAdminSetup } from './SuperAdminSetup';
import { SuperAdminProvisioning } from './SuperAdminProvisioning';
import { SuperAdminEmail } from './SuperAdminEmail';
import { SuperAdminAutomation } from './SuperAdminAutomation';
import { SuperAdminHosting } from './SuperAdminHosting';
import { SuperAdminMigration, DeploymentKitPanel } from './SuperAdminMigration';
import { SuperAdminSecurity } from './SuperAdminSecurity';
import { TutorialButton } from '../common/TutorialButton';

/**
 * Super Admin portal (C4, spec §24).
 *
 * A full-page, data-blind control plane for QSCorp platform staff. It reads only platform RPCs
 * (platform_* in migrations 0031/0033); every one of them checks the platform_admin role in the
 * database. This is the sole surface that may know about the platform role (D-PLATFORM-RIGHTS);
 * no org-product code imports it. It renders no blocking modal (spec §27.5).
 */
type Tab = 'tenants' | 'provisioning' | 'support' | 'consultation' | 'features' | 'recipients' | 'email' | 'automation' | 'tutorials' | 'setup' | 'trail' | 'hosting' | 'migration' | 'security';
type Gate = 'checking' | 'allowed' | 'denied' | 'bootstrap';

/** F18: every platform tab carries its own "Show me how" tutorial key (Appendix A). */
const TAB_TUTORIAL: Record<Tab, { key: string; title: string }> = {
  tenants: { key: 'sa.tenant-hub', title: 'SA-03 tenant hub' },
  provisioning: { key: 'sa.setup-wizard', title: 'SA-16 guided provisioning' },
  support: { key: 'sa.health', title: 'SA-02 platform health' },
  consultation: { key: 'sa.dual-session', title: 'SA-09 Dual Session console' },
  features: { key: 'sa.features', title: 'SA-14 features and plans' },
  recipients: { key: 'sa.recipients', title: 'SA-05 notification recipients' },
  email: { key: 'sa.email-default', title: 'SA-04 email sender profiles' },
  automation: { key: 'sa.automation', title: 'SA-07 automation templates' },
  tutorials: { key: 'sa.tutorials', title: 'SA-13 tutorial library' },
  setup: { key: 'sa.setup-wizard', title: 'SA-01 platform setup wizard' },
  hosting: { key: 'sa.hosting-fit', title: 'SA-10 hosting fit check' },
  migration: { key: 'sa.migration', title: 'SA-12 migration jobs' },
  trail: { key: 'sa.trail', title: 'SA-15 platform trail' },
  security: { key: 'sa.health', title: 'SA-02 platform health' },
};

export const SuperAdminPortal: React.FC = () => {
  const [gate, setGate] = useState<Gate>('checking');
  const [tab, setTab] = useState<Tab>('tenants');
  // The console is the owner's alone (0103). A platform admin who is not the owner is refused by the
  // database and told nothing here; on a fresh install the bootstrap claims ownership once.
  const [bootstrap, setBootstrap] = useState<{ available: boolean; reason: string }>({ available: false, reason: '' });
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  const resolve = useCallback(() => {
    let live = true;
    platformWhoami()
      .then((who) => {
        if (!live) return;
        if (who.isPlatformOwner) {
          setGate('allowed');
        } else if (who.isPlatformAdmin && !who.ownerExists) {
          // The one-time bootstrap: the visitor holds the platform role and no owner exists yet.
          setBootstrap({ available: true, reason: '' });
          setGate('bootstrap');
        } else {
          setGate('denied');
        }
      })
      .catch(() => {
        if (live) setGate('denied');
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => resolve(), [resolve]);

  const claim = async () => {
    setClaimError(null);
    if (bootstrap.reason.trim().length < 4) {
      setClaimError('Give a short reason for claiming ownership.');
      return;
    }
    setClaiming(true);
    const r = await claimPlatformOwnership(bootstrap.reason.trim());
    setClaiming(false);
    if (r.ok) {
      resolve();
    } else {
      setClaimError(r.reason);
    }
  };

  const goHome = useCallback(() => {
    window.location.href = '/';
  }, []);

  if (gate === 'checking') {
    return (
      <div className="min-h-screen bg-canvas text-primary flex items-center justify-center" data-testid="superadmin-checking">
        <div className="flex items-center gap-2 text-secondary text-apple-13">
          <div className="animate-spin w-4 h-4 border-2 border-accent border-t-transparent rounded-full" />
          <span>Checking platform access…</span>
        </div>
      </div>
    );
  }

  if (gate === 'bootstrap') {
    return (
      <div className="min-h-screen bg-canvas text-primary flex items-center justify-center px-6" data-testid="superadmin-bootstrap">
        <div className="max-w-md w-full space-y-4 p-8 rounded-2xl bg-surface border border-hairline">
          <div className="flex items-center gap-2 text-accent">
            <Shield className="w-5 h-5" />
            <h1 className="text-apple-20 font-bold">Claim platform ownership</h1>
          </div>
          <p className="text-apple-13 text-secondary">
            No owner has been set for this platform yet. Claiming makes this account the sole owner of
            the control plane; the claim can be made only once and cannot be undone in the app.
          </p>
          <label className="block space-y-1">
            <span className="text-apple-12 font-medium text-primary">Reason</span>
            <input
              data-testid="superadmin-bootstrap-reason"
              value={bootstrap.reason}
              onChange={(e) => setBootstrap({ ...bootstrap, reason: e.target.value })}
              className="w-full p-2.5 rounded-xl bg-surface-elevated border border-hairline text-apple-13 text-primary outline-none"
            />
          </label>
          <InlineError message={claimError} testId="superadmin-bootstrap-error" />
          <button
            type="button"
            onClick={() => void claim()}
            disabled={claiming}
            data-testid="superadmin-bootstrap-claim"
            className="px-4 py-2 rounded-xl bg-accent text-white text-apple-13 font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {claiming ? 'Claiming…' : 'Claim ownership'}
          </button>
        </div>
      </div>
    );
  }

  if (gate === 'denied') {
    return (
      <div className="min-h-screen bg-canvas text-primary flex items-center justify-center px-6" data-testid="superadmin-denied">
        <div className="max-w-md w-full space-y-4 p-8 rounded-2xl bg-surface border border-hairline">
          <div className="flex items-center gap-2 text-cinnabar">
            <Shield className="w-5 h-5" />
            <h1 className="text-apple-20 font-bold">Platform portal</h1>
          </div>
          <p className="text-apple-13 text-secondary">
            This area is for QSCorp platform administrators only. Your session does not hold the
            platform role.
          </p>
          <button
            type="button"
            onClick={goHome}
            className="px-4 py-2 rounded-xl bg-accent text-white text-apple-13 font-medium hover:opacity-90 transition-opacity"
          >
            Back to workspace
          </button>
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.FC<{ className?: string }> }[] = [
    { id: 'tenants', label: 'Tenants', icon: Building },
    { id: 'provisioning', label: 'Guided setup', icon: Building },
    { id: 'support', label: 'Support access', icon: Shield },
    { id: 'consultation', label: 'Dual Session', icon: Users },
    { id: 'features', label: 'Features & plans', icon: Zap },
    { id: 'recipients', label: 'Recipients', icon: Users },
    { id: 'email', label: 'Email senders', icon: Send },
    { id: 'automation', label: 'Automation', icon: Zap },
    { id: 'tutorials', label: 'Tutorials', icon: Eye },
    { id: 'setup', label: 'Setup', icon: History },
    { id: 'hosting', label: 'Hosting fit', icon: Database },
    { id: 'migration', label: 'Migration jobs', icon: RefreshCw },
    { id: 'trail', label: 'Platform trail', icon: History },
    { id: 'security', label: 'Security', icon: Shield },
  ];

  return (
    <div className="min-h-screen bg-canvas text-primary" data-testid="superadmin-portal">
      <header className="border-b border-hairline bg-surface">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-accent" />
            <div>
              <h1 className="text-apple-16 font-bold">Platform control plane</h1>
              <p className="text-apple-11 text-tertiary">QSCorp · data-blind tenant administration</p>
            </div>
          </div>
          <button
            type="button"
            onClick={goHome}
            className="text-apple-12 text-secondary hover:text-primary transition-colors"
          >
            Back to workspace
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between gap-2 mb-6">
        <nav className="flex flex-wrap gap-1" data-testid="superadmin-tabs">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                data-testid={`superadmin-tab-${t.id}`}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-apple-13 font-medium transition-colors ${
                  active ? 'bg-accent-subtle text-primary' : 'text-secondary hover:text-primary'
                }`}
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
          screenId={`sa-${tab}`}
        />
        </div>

        {tab === 'tenants' && <SuperAdminTenants />}
        {tab === 'provisioning' && <SuperAdminProvisioning />}
        {tab === 'support' && <SuperAdminSupport />}
        {tab === 'consultation' && <SuperAdminConsultation />}
        {tab === 'features' && <SuperAdminFeatures />}
        {tab === 'recipients' && <SuperAdminRecipients />}
        {tab === 'email' && <SuperAdminEmail />}
        {tab === 'automation' && <SuperAdminAutomation />}
        {tab === 'tutorials' && <SuperAdminTutorials />}
        {tab === 'setup' && <SuperAdminSetup />}
        {tab === 'hosting' && <SuperAdminHosting />}
        {tab === 'migration' && (
          <div className="space-y-4">
            <SuperAdminMigration />
            <DeploymentKitPanel />
          </div>
        )}
        {tab === 'trail' && <SuperAdminTrail />}
        {tab === 'security' && <SuperAdminSecurity />}
      </div>
    </div>
  );
};

/** A small shared inline error for the portal panels. */
export const PortalError: React.FC<{ message: string }> = ({ message }) => (
  <InlineError message={message} testId="superadmin-error" />
);
