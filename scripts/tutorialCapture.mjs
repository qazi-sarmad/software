/**
 * Tutorial capture map (C4).
 *
 * Where each Appendix A key's screen lives, and how to get to it. The recorder uses this to open the
 * key's real screen before driving its steps, so a recording shows the actual control.
 *
 * This file holds NAVIGATION only. It never holds a testid: every step target comes from
 * src/lib/tutorialKeys.json, which is derived from docs/ACP-UI-CONTRACT.md, so the contract stays the
 * one source of truth and the owner's UI replacement cannot silently break a step.
 */

/** The Org Admin control-plane tab each OA key lives on. */
const ORG_TAB = {
  'oa.setup-wizard': 'setup', 'oa.setup-1': 'setup', 'oa.setup-2': 'setup', 'oa.setup-3': 'setup',
  'oa.setup-4': 'setup', 'oa.setup-5': 'setup', 'oa.setup-6': 'setup', 'oa.setup-7': 'setup',
  'oa.setup-8': 'setup', 'oa.setup-9': 'setup', 'oa.golive': 'setup',
  'oa.profile': 'branding', 'oa.branding': 'branding', 'oa.pptx-theme': 'branding',
  'oa.boardpack-config': 'branding', 'oa.certificate-config': 'branding',
  'oa.features': 'features', 'oa.ai': 'ai', 'oa.ai-test': 'ai', 'oa.ai-usecases': 'ai',
  'oa.voice': 'ai', 'oa.templates': 'automation', 'oa.automation': 'automation',
  'oa.templates-email': 'automation', 'oa.escalation': 'escalation',
  'oa.email-resend': 'email', 'oa.email-microsoft': 'email', 'oa.email-smtp': 'email',
  'oa.email-test': 'email', 'oa.auditors': 'auditors', 'oa.auditor-matrix': 'auditors',
  'oa.hosting': 'hosting', 'oa.migration': 'hosting', 'oa.deployment-kit': 'hosting',
  'oa.retire-old': 'hosting', 'oa.history': 'history', 'oa.tutorials': 'tutorials',
  'oa.invite': 'tutorials', 'oa.patterns-config': 'features', 'oa.dual-session': 'consultation',
};

/** The platform console tab each SA key lives on. */
const SA_TAB = {
  'sa.setup-wizard': 'setup', 'sa.setup-1': 'setup', 'sa.setup-2': 'setup', 'sa.setup-3': 'setup',
  'sa.setup-4': 'setup', 'sa.setup-5': 'setup', 'sa.setup-6': 'setup', 'sa.setup-7': 'setup',
  'sa.setup-8': 'setup', 'sa.setup-9': 'setup',
  'sa.health': 'support', 'sa.tenant-hub': 'tenants', 'sa.dual-session': 'consultation',
  'sa.email-resend': 'email', 'sa.email-microsoft': 'email', 'sa.email-smtp': 'email',
  'sa.email-default': 'email', 'sa.email-force-tenant': 'email',
  'sa.recipients': 'recipients', 'sa.ai-models': 'ai', 'sa.ai-denylist': 'ai',
  'sa.automation': 'automation', 'sa.templates': 'automation',
  'sa.hosting-fit': 'hosting', 'sa.hosting-rules': 'hosting', 'sa.migration': 'migration',
  'sa.tutorials': 'tutorials', 'sa.features': 'features', 'sa.plans': 'features',
  'sa.trail': 'trail',
};

/** Where a key's screen is, as a plan the recorder follows. */
export function captureFor(def) {
  const { key, screenId } = def;
  if (screenId.startsWith('SA-')) {
    return { kind: 'superadmin', tab: SA_TAB[key] ?? 'tenants' };
  }
  if (screenId.startsWith('OA-')) {
    if (key === 'oa.roles' || key === 'oa.invite') return { kind: 'people' };
    // OA-09 is the "Sections" tab inside the Dashboard Board Pack panel, not an Org Control tab.
    if (key === 'oa.boardpack-config') return { kind: 'dashboard', boardpackConfig: true };
    // OA-10 sits beside the certificate panel in the Audit File window.
    if (key === 'oa.certificate-config') return { kind: 'audit-file', view: 'certificate' };
    // OA-21 is the "Settings" sub-view of the Issues & CAP Register Patterns view.
    if (key === 'oa.patterns-config') return { kind: 'issues', view: 'patterns', sub: 'settings' };
    return { kind: 'org', tab: ORG_TAB[key] ?? 'features' };
  }
  if (screenId.startsWith('GL-')) return { kind: 'org', tab: 'consultation' };
  if (screenId.startsWith('WK-')) {
    // WK-05 and WK-09 are Audit File window views, not Dashboard blocks.
    if (key === 'oa.certificate') return { kind: 'audit-file', view: 'certificate' };
    if (key === 'oa.timetravel') return { kind: 'audit-file', view: 'as_of' };
    // WK-10 is the Patterns view of the Issues & CAP Register.
    if (key === 'oa.patterns') return { kind: 'issues', view: 'patterns' };
    // WK-08 renders in the Work Queue tab.
    if (key === 'oa.escalation-cards') return { kind: 'work-queue' };
    // WK-07 renders inside the observation editor the Issues register opens.
    if (key === 'oa.ai-assist') return { kind: 'issues-observation' };
    // WK-06 is the public verification page, outside the auth guard.
    if (key === 'oa.verify') {
      return { kind: 'public', path: '/verify/00000000-0000-0000-0000-000000000000' };
    }
    return { kind: 'dashboard' };
  }
  if (screenId.startsWith('TUT-')) return { kind: 'dashboard' };
  if (screenId.startsWith('EX-')) {
    // EX-01 is the invitation acceptance page, not the portal home.
    if (key === 'ex.accept') return { kind: 'external-accept', path: '/external/accept?token=invite' };
    return { kind: 'external' };
  }
  return { kind: 'dashboard' };
}

export const CAPTURE_KINDS = [
  'superadmin', 'org', 'people', 'dashboard', 'external',
  'audit-file', 'issues', 'issues-observation', 'work-queue', 'public', 'external-accept',
];
