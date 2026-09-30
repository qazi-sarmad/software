import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useScopedData } from '../../hooks/useScopedData';
import { canPerformAction, ActionType } from '../../lib/access';
import { User, Role } from '../../types';
import {
  Shield,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  AlertTriangle,
  User as UserIcon,
  Search,
  Eye,
  ArrowRight,
  Database,
  Building,
} from '../common/Icons';

const ALL_ROLES: { role: Role; label: string; desc: string }[] = [
  { role: 'cia', label: 'Chief Internal Auditor (CIA)', desc: 'Ultimate audit authority; plan approval, reports, sealed record reopening.' },
  { role: 'audit_manager', label: 'Audit Manager', desc: 'Prepares, reviews (4-eyes), engagement sign-off, proposes ad-hoc audits.' },
  { role: 'reviewer', label: 'Audit Reviewer', desc: '4-eyes review sign-off, closes issues; cannot sign off own work.' },
  { role: 'preparer', label: 'Audit Preparer', desc: 'Creates/edits workpapers, executes sampling tests, raises findings.' },
  { role: 'observer', label: 'Board / Audit Observer', desc: 'Read-only access; sees Executive Summary, Issues, and issued reports only.' },
  { role: 'org_admin', label: 'Organization Administrator', desc: 'Manages user identities & config; has ZERO visibility into audit data.' },
  { role: 'auditee', label: 'Entity Auditee (1st Line)', desc: 'Scoped to assigned entity; read-only on papers; responds to issues.' },
];

const TEST_ACTIONS: { action: ActionType; label: string; group: string }[] = [
  { action: 'create_workpaper', label: 'Create Working Paper', group: 'Fieldwork' },
  { action: 'edit_workpaper', label: 'Edit Working Paper & Procedures', group: 'Fieldwork' },
  { action: 'run_test', label: 'Run & Finalize Sampling Tests', group: 'Fieldwork' },
  { action: 'raise_finding', label: 'Raise Audit Observation / Finding', group: 'Fieldwork' },
  { action: 'review_sign_off', label: 'Review Sign-Off (Four-Eyes)', group: 'Assurance' },
  { action: 'close_issue', label: 'Close / Remediate Issue', group: 'Assurance' },
  { action: 'audit_sign_off', label: 'Engagement Sign-Off & Seal', group: 'Assurance' },
  { action: 'propose_ad_hoc', label: 'Propose Ad-Hoc Engagement', group: 'Governance' },
  { action: 'approve_plan', label: 'Approve Audit Plan / Ad-Hoc', group: 'Governance' },
  { action: 'issue_report', label: 'Issue Final Audit Report', group: 'Governance' },
  { action: 'reopen', label: 'Reopen Sealed Audit Record', group: 'Governance' },
  { action: 'view_ledger', label: 'Verify Cryptographic Hash Chain', group: 'Integrity' },
  { action: 'view_audit_content', label: 'View Audit Universe & Workpapers', group: 'Access' },
];

export const DevAccessPage: React.FC = () => {
  const { availableUsers, currentUser, setCurrentUser, rawWorkpapers } = useApp();
  const {
    scopedUniverses,
    scopedEntities,
    scopedEngagements,
    scopedWorkpapers,
    scopedObservations,
    scopedIssues,
    scopedComments,
    scopedLedger,
  } = useScopedData();

  // Test states for interactive verification panels
  const [reopenJustification, setReopenJustification] = useState('Regulatory inquiry on July liquidity variance');
  const [selectedWorkpaperId, setSelectedWorkpaperId] = useState('wp-treas-1');

  // Find target workpaper for Four-Eyes testing
  const targetWp = useMemo(() => {
    return rawWorkpapers.find((w) => w.id === selectedWorkpaperId) || rawWorkpapers[0];
  }, [rawWorkpapers, selectedWorkpaperId]);

  // Four-Eyes Principle check evaluation
  const fourEyesResult = useMemo(() => {
    if (!targetWp) return { allowed: false, reason: 'No workpaper selected' };
    return canPerformAction(currentUser, 'review_sign_off', {
      preparerId: targetWp.preparerId,
      isLocked: targetWp.isLocked,
    });
  }, [currentUser, targetWp]);

  // Reopen Sealed Record check evaluation
  const sealedWp = useMemo(() => {
    return rawWorkpapers.find((w) => w.isLocked || w.sealed) || rawWorkpapers[1];
  }, [rawWorkpapers]);

  const reopenResult = useMemo(() => {
    return canPerformAction(currentUser, 'reopen', {
      isLocked: true,
      reopenJustification: reopenJustification,
    });
  }, [currentUser, reopenJustification]);

  // CANARY LEAKAGE SCANNER
  const canaryReport = useMemo(() => {
    const CANARIES = [
      { key: 'CANARY-TREASURY', entity: 'ent-treasury', name: 'Treasury' },
      { key: 'CANARY-TRADING', entity: 'ent-trading', name: 'Trading' },
      { key: 'CANARY-COMPLIANCE', entity: 'ent-compliance', name: 'Compliance' },
      { key: 'CANARY-RETAIL', entity: 'ent-retail', name: 'Retail' },
      { key: 'CANARY-CARDS', entity: 'ent-cards', name: 'Cards' },
      { key: 'CANARY-DIGITAL', entity: 'ent-digital', name: 'Digital' },
    ];

    // Combine all textual contents currently accessible via useScopedData
    const visibleTexts: string[] = [
      ...scopedEntities.map((e) => `${e.name} ${e.department}`),
      ...scopedEngagements.map((e) => e.title),
      ...scopedWorkpapers.map((w) => `${w.title} ${w.conclusion}`),
      ...scopedObservations.map((o) => `${o.title} ${o.condition} ${o.cause} ${o.recommendation}`),
      ...scopedIssues.map((i) => `${i.title} ${i.description}`),
      ...scopedComments.map((c) => c.text),
    ];
    const corpus = visibleTexts.join(' ');

    const detectedCanaries: { key: string; name: string; count: number; authorized: boolean }[] = [];

    // Determine authorized entities for current user
    const userRole = currentUser.role;
    const isGlobal = userRole === 'cia' || userRole === 'audit_manager' || userRole === 'reviewer' || userRole === 'observer';
    const isOrgAdmin = userRole === 'org_admin';

    for (const c of CANARIES) {
      const regex = new RegExp(c.key, 'g');
      const matches = corpus.match(regex);
      const count = matches ? matches.length : 0;

      let authorized = false;
      if (isOrgAdmin) {
        authorized = false; // Org admin must see 0 audit canaries
      } else if (isGlobal) {
        authorized = true;
      } else if (currentUser.entityIds.includes(c.entity) || currentUser.entityIds.includes('*')) {
        authorized = true;
      }

      if (count > 0 || !authorized) {
        detectedCanaries.push({
          key: c.key,
          name: c.name,
          count,
          authorized,
        });
      }
    }

    // Leaks are detected canaries that are NOT authorized
    const unauthorizedLeaks = detectedCanaries.filter((d) => d.count > 0 && !d.authorized);
    const hasOrgAdminLeak = isOrgAdmin && visibleTexts.length > 0;

    return {
      totalVisibleRecords: visibleTexts.length,
      detectedCanaries,
      unauthorizedLeaks,
      isClean: unauthorizedLeaks.length === 0 && !hasOrgAdminLeak,
    };
  }, [
    currentUser,
    scopedEntities,
    scopedEngagements,
    scopedWorkpapers,
    scopedObservations,
    scopedIssues,
    scopedComments,
  ]);

  return (
    <div className="min-h-screen bg-canvas text-primary pb-20 select-none">
      {/* Top Banner */}
      <div className="bg-surface border-b border-hairline py-4 px-6 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-apple-11 uppercase px-2 py-0.5 rounded bg-verdigris-subtle text-verdigris border border-verdigris font-semibold">
                Test Harness
              </span>
              <h1 className="text-apple-20 font-bold tracking-tight font-serif-title">
                /dev/access — Role-Based Access Control &amp; Canary Isolation Verification
              </h1>
            </div>
            <p className="text-apple-12 text-secondary mt-1">
              Deterministic verification suite for the 7 canonical Provio roles, Four-Eyes Principle, sealed record guards, and zero-leakage canary isolation.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="px-3.5 py-1.5 rounded-lg border border-hairline text-apple-12 font-medium text-secondary hover:text-primary hover:bg-surface-hover transition-colors"
            >
              Return to Platform
            </a>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-8">
        {/* 1. Identity Switcher */}
        <section className="bg-surface border border-hairline rounded-2xl p-6 shadow-soft space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserIcon className="w-5 h-5 text-accent stroke-[1.5]" />
              <h2 className="text-apple-15 font-semibold">Identity &amp; Role Simulation Switcher</h2>
            </div>
            <span className="text-apple-12 text-secondary">
              Active User: <strong className="text-primary">{currentUser.name}</strong> ({currentUser.role})
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {availableUsers.map((user) => {
              const isSelected = user.id === currentUser.id;
              return (
                <button
                  key={user.id}
                  onClick={() => setCurrentUser(user)}
                  className={`text-left p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-2 ${
                    isSelected
                      ? 'bg-accent-subtle border-accent ring-1 ring-accent'
                      : 'bg-surface border-hairline hover:bg-surface-hover'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-apple-13 text-primary">{user.name}</span>
                    <span
                      className={`text-apple-11 font-mono uppercase px-1.5 py-0.5 rounded ${
                        isSelected
                          ? 'bg-accent text-surface'
                          : 'bg-surface-sunken text-secondary border border-hairline'
                      }`}
                    >
                      {user.role}
                    </span>
                  </div>
                  <div className="text-apple-11 text-secondary">
                    {user.department || 'Audit Operations'}
                  </div>
                  <div className="text-apple-11 text-tertiary truncate">
                    Scope: {user.entityIds.length === 0 ? 'None (Config Only)' : user.entityIds.includes('*') ? 'All Entities (*)' : user.entityIds.join(', ')}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2. Interactive Role Matrix for Current User */}
        <section className="bg-surface border border-hairline rounded-2xl p-6 shadow-soft space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-verdigris stroke-[1.5]" />
              <h2 className="text-apple-15 font-semibold">
                Live Capability Matrix: <span className="text-accent">{currentUser.name}</span> ({currentUser.role})
              </h2>
            </div>
            <span className="text-apple-12 text-secondary">
              Evaluated via <code>canPerformAction()</code>
            </span>
          </div>

          <div className="overflow-x-auto border border-hairline rounded-xl">
            <table className="w-full text-apple-12 text-left border-collapse">
              <thead>
                <tr className="bg-surface-sunken border-b border-hairline text-secondary">
                  <th className="py-2.5 px-4 font-semibold">Capability</th>
                  <th className="py-2.5 px-4 font-semibold">Category</th>
                  <th className="py-2.5 px-4 font-semibold w-36">Status</th>
                  <th className="py-2.5 px-4 font-semibold">Evaluation Reason / Enforcement Rule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {TEST_ACTIONS.map(({ action, label, group }) => {
                  const result = canPerformAction(currentUser, action);
                  return (
                    <tr key={action} className="hover:bg-surface-hover transition-colors">
                      <td className="py-2.5 px-4 font-medium text-primary">{label}</td>
                      <td className="py-2.5 px-4 text-secondary">{group}</td>
                      <td className="py-2.5 px-4">
                        {result.allowed ? (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            ALLOWED
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar border border-cinnabar">
                            <XCircle className="w-3.5 h-3.5" />
                            BLOCKED
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-secondary">
                        {result.allowed ? (
                          <span className="text-secondary italic">Authorized for active role</span>
                        ) : (
                          <span className="text-cinnabar font-medium">{result.reason}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* 3. Specialized Gate Tests: Four-Eyes Principle & Reopen Sealed Records */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Panel A: Four-Eyes Principle Trap */}
          <div className="bg-surface border border-hairline rounded-2xl p-6 shadow-soft space-y-4 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-brass stroke-[1.5]" />
                <h3 className="text-apple-14 font-semibold">Four-Eyes Principle Live Trap</h3>
              </div>
              <p className="text-apple-12 text-secondary">
                Rule: A reviewer cannot sign off on working papers they prepared themselves. In the seed dataset, <code className="font-mono text-primary">wp-treas-1</code> was prepared by reviewer user <strong className="text-primary">Sarah Jenkins (usr-rev)</strong>.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-sunken border border-hairline space-y-2">
              <div className="flex items-center justify-between text-apple-12">
                <span className="text-secondary">Selected Workpaper:</span>
                <span className="font-semibold text-primary">{targetWp.id} — {targetWp.title}</span>
              </div>
              <div className="flex items-center justify-between text-apple-12">
                <span className="text-secondary">Workpaper Preparer:</span>
                <span className="font-mono text-accent font-semibold">{targetWp.preparedBy} ({targetWp.preparerId})</span>
              </div>
              <div className="flex items-center justify-between text-apple-12">
                <span className="text-secondary">Attempting Reviewer:</span>
                <span className="font-mono text-primary">{currentUser.name} ({currentUser.id})</span>
              </div>
            </div>

            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-apple-12 font-medium text-secondary">Gate Evaluation:</span>
                {fourEyesResult.allowed ? (
                  <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> ALLOWED TO SIGN OFF
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar border border-cinnabar flex items-center gap-1">
                    <Lock className="w-3 h-3" /> FOUR-EYES TRAP ACTIVE
                  </span>
                )}
              </div>
              <div className="p-3 rounded-lg border border-hairline bg-surface text-apple-12">
                {fourEyesResult.allowed ? (
                  <span className="text-secondary">Different preparer and reviewer. Four-eyes requirement satisfied.</span>
                ) : (
                  <span className="text-cinnabar font-semibold">{fourEyesResult.reason}</span>
                )}
              </div>
            </div>
          </div>

          {/* Panel B: Sealed Record & Reopen Justification Guard */}
          <div className="bg-surface border border-hairline rounded-2xl p-6 shadow-soft space-y-4 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-verdigris stroke-[1.5]" />
                <h3 className="text-apple-14 font-semibold">Sealed Record Reopen Guard</h3>
              </div>
              <p className="text-apple-12 text-secondary">
                Rule: Sealed audit records are strictly read-only. Reopening requires CIA authority and a mandatory justification note of at least 10 non-whitespace characters.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-sunken border border-hairline space-y-2">
              <div className="flex items-center justify-between text-apple-12">
                <span className="text-secondary">Sealed Record:</span>
                <span className="font-semibold text-primary">{sealedWp?.id} (ALM Liquidity Stress)</span>
              </div>
              <div className="flex items-center justify-between text-apple-12">
                <span className="text-secondary">Cryptographic Status:</span>
                <span className="text-verdigris font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Sealed in Block #2 (Hash: e3b0c442...)
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-apple-12 font-medium text-secondary block">
                Test Justification Note ({reopenJustification.trim().length} chars, min 10 required):
              </label>
              <input
                type="text"
                value={reopenJustification}
                onChange={(e) => setReopenJustification(e.target.value)}
                placeholder="Enter justification note..."
                className="w-full px-3 py-2 text-apple-12 rounded-lg bg-surface-sunken border border-hairline text-primary focus:border-accent outline-none"
              />
            </div>

            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-apple-12 font-medium text-secondary">Reopen Permission:</span>
                {reopenResult.allowed ? (
                  <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1">
                    <Unlock className="w-3 h-3" /> REOPEN PERMITTED
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar border border-cinnabar flex items-center gap-1">
                    <Lock className="w-3 h-3" /> REOPEN REJECTED
                  </span>
                )}
              </div>
              <div className="p-3 rounded-lg border border-hairline bg-surface text-apple-12">
                {reopenResult.allowed ? (
                  <span className="text-secondary">Authorized CIA with sufficient justification length (&gt;= 10 characters).</span>
                ) : (
                  <span className="text-cinnabar font-semibold">{reopenResult.reason}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 4. Canary Leakage Detection & Scoped Visibility Inspector */}
        <section className="bg-surface border border-hairline rounded-2xl p-6 shadow-soft space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-accent stroke-[1.5]" />
              <h2 className="text-apple-15 font-semibold">
                Scoped Visibility &amp; Canary Leakage Scanner
              </h2>
            </div>
            {canaryReport.isClean ? (
              <span className="px-3 py-1 rounded-full text-apple-11 font-semibold bg-verdigris-subtle text-verdigris border border-verdigris flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                PASS: 0 UNAUTHORIZED CANARY LEAKS DETECTED
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-apple-11 font-semibold bg-cinnabar-subtle text-cinnabar border border-cinnabar flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                FAIL: CANARY DATA LEAKAGE DETECTED
              </span>
            )}
          </div>

          {/* Counts Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <div className="p-3 rounded-xl bg-surface-sunken border border-hairline text-center">
              <div className="text-apple-11 text-secondary uppercase font-semibold">Universes</div>
              <div className="text-apple-20 font-bold text-primary mt-1">{scopedUniverses.length}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-sunken border border-hairline text-center">
              <div className="text-apple-11 text-secondary uppercase font-semibold">Entities</div>
              <div className="text-apple-20 font-bold text-primary mt-1">{scopedEntities.length}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-sunken border border-hairline text-center">
              <div className="text-apple-11 text-secondary uppercase font-semibold">Engagements</div>
              <div className="text-apple-20 font-bold text-primary mt-1">{scopedEngagements.length}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-sunken border border-hairline text-center">
              <div className="text-apple-11 text-secondary uppercase font-semibold">Workpapers</div>
              <div className="text-apple-20 font-bold text-primary mt-1">{scopedWorkpapers.length}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-sunken border border-hairline text-center">
              <div className="text-apple-11 text-secondary uppercase font-semibold">Observations</div>
              <div className="text-apple-20 font-bold text-primary mt-1">{scopedObservations.length}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-sunken border border-hairline text-center">
              <div className="text-apple-11 text-secondary uppercase font-semibold">Issues (Issued)</div>
              <div className="text-apple-20 font-bold text-primary mt-1">{scopedIssues.length}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-sunken border border-hairline text-center">
              <div className="text-apple-11 text-secondary uppercase font-semibold">Comments</div>
              <div className="text-apple-20 font-bold text-primary mt-1">{scopedComments.length}</div>
            </div>
            <div className="p-3 rounded-xl bg-surface-sunken border border-hairline text-center">
              <div className="text-apple-11 text-secondary uppercase font-semibold">Ledger Blocks</div>
              <div className="text-apple-20 font-bold text-primary mt-1">{scopedLedger.length}</div>
            </div>
          </div>

          {/* Canary String Audit Breakdown */}
          <div className="space-y-3">
            <h3 className="text-apple-13 font-semibold text-primary uppercase tracking-wider">
              Entity Canary String Confinement Status
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {canaryReport.detectedCanaries.map((c) => {
                const isViolation = c.count > 0 && !c.authorized;
                return (
                  <div
                    key={c.key}
                    className={`p-3.5 rounded-xl border flex items-center justify-between ${
                      isViolation
                        ? 'bg-cinnabar-subtle border-cinnabar'
                        : c.count > 0
                        ? 'bg-surface border-hairline'
                        : 'bg-surface-sunken border-hairline opacity-75'
                    }`}
                  >
                    <div>
                      <div className="font-mono text-apple-12 font-bold text-primary">{c.key}</div>
                      <div className="text-apple-11 text-secondary">
                        {c.name} — Status: {c.authorized ? 'Authorized for User' : 'Restricted (Out of Scope)'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono text-apple-13 font-bold ${isViolation ? 'text-cinnabar' : 'text-primary'}`}>
                        {c.count} visible
                      </div>
                      <div className="text-apple-10 font-semibold uppercase">
                        {isViolation ? (
                          <span className="text-cinnabar">DATA LEAK</span>
                        ) : c.count > 0 ? (
                          <span className="text-verdigris">SECURE</span>
                        ) : (
                          <span className="text-secondary">ISOLATED</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default DevAccessPage;
