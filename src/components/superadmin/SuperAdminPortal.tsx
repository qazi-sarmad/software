import React, { useCallback, useEffect, useState } from 'react';
import { platformWhoami } from '../../data/platform';
import { InlineError } from '../common/InlineError';
import { Building, Shield, Users, Zap, Eye, History } from '../common/Icons';
import { SuperAdminTenants } from './SuperAdminTenants';
import { SuperAdminSupport } from './SuperAdminSupport';
import { SuperAdminTrail } from './SuperAdminTrail';
import { SuperAdminConsultation } from './SuperAdminConsultation';
import { SuperAdminFeatures } from './SuperAdminFeatures';
import { SuperAdminRecipients } from './SuperAdminRecipients';
import { SuperAdminTutorials } from './SuperAdminTutorials';
import { SuperAdminSetup } from './SuperAdminSetup';

/**
 * Super Admin portal (C4, spec §24).
 *
 * A full-page, data-blind control plane for QSCorp platform staff. It reads only platform RPCs
 * (platform_* in migrations 0031/0033); every one of them checks the platform_admin role in the
 * database. This is the sole surface that may know about the platform role (D-PLATFORM-RIGHTS);
 * no org-product code imports it. It renders no blocking modal (spec §27.5).
 */
type Tab = 'tenants' | 'support' | 'consultation' | 'features' | 'recipients' | 'tutorials' | 'setup' | 'trail';
type Gate = 'checking' | 'allowed' | 'denied';

export const SuperAdminPortal: React.FC = () => {
  const [gate, setGate] = useState<Gate>('checking');
  const [tab, setTab] = useState<Tab>('tenants');

  useEffect(() => {
    let live = true;
    platformWhoami()
      .then((who) => {
        if (live) setGate(who.isPlatformAdmin ? 'allowed' : 'denied');
      })
      .catch(() => {
        if (live) setGate('denied');
      });
    return () => {
      live = false;
    };
  }, []);

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
    { id: 'support', label: 'Support access', icon: Shield },
    { id: 'consultation', label: 'Dual Session', icon: Users },
    { id: 'features', label: 'Features & plans', icon: Zap },
    { id: 'recipients', label: 'Recipients', icon: Users },
    { id: 'tutorials', label: 'Tutorials', icon: Eye },
    { id: 'setup', label: 'Setup', icon: History },
    { id: 'trail', label: 'Platform trail', icon: History },
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
        <nav className="flex gap-1 mb-6" data-testid="superadmin-tabs">
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

        {tab === 'tenants' && <SuperAdminTenants />}
        {tab === 'support' && <SuperAdminSupport />}
        {tab === 'consultation' && <SuperAdminConsultation />}
        {tab === 'features' && <SuperAdminFeatures />}
        {tab === 'recipients' && <SuperAdminRecipients />}
        {tab === 'tutorials' && <SuperAdminTutorials />}
        {tab === 'setup' && <SuperAdminSetup />}
        {tab === 'trail' && <SuperAdminTrail />}
      </div>
    </div>
  );
};

/** A small shared inline error for the portal panels. */
export const PortalError: React.FC<{ message: string }> = ({ message }) => (
  <InlineError message={message} testId="superadmin-error" />
);
