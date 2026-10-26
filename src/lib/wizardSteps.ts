/**
 * Wizard step registry (F17, S1).
 *
 * The two guided wizards are data, not code: each step declares its key, title, the plain-language
 * "what this is / why it matters / what happens if you skip" text, the tutorial key (F18), whether
 * it is optional and which feature must be enabled for it to appear. Later slices register their
 * own steps here; the wizard screens render whatever the registry holds for their scope.
 */
import type { SetupScope } from '../data/setup';

export interface WizardStepDef {
  key: string;
  title: string;
  what: string;
  why: string;
  skip: string;
  tutorialKey: string;
  optional: boolean;
  /** When set, the step is hidden unless the org has this feature enabled (F25). */
  requiresFeature?: string;
}

export const ORG_WIZARD_STEPS: WizardStepDef[] = [
  { key: 'org.profile', title: 'Organisation profile and branding', what: 'Your organisation name, logo and report format.', why: 'Everything you issue carries these details.', skip: 'Reports use the platform defaults until you set them.', tutorialKey: 'oa.setup-1', optional: false },
  { key: 'org.features', title: 'Feature enablement', what: 'The features QSCorp has included in your plan.', why: 'Only the features in your plan are shown.', skip: 'You keep only the features already included.', tutorialKey: 'oa.setup-2', optional: false },
  { key: 'org.roles', title: 'Roles and permission defaults', what: 'Which rights each role holds, including who sees the Board Pack.', why: 'Access is decided by rights, not by role names.', skip: 'The seeded defaults stay in place.', tutorialKey: 'oa.setup-3', optional: false },
  { key: 'org.presentation', title: 'Presentation and certificate templates', what: 'Board Pack sections, certificate fields and your PPTX theme.', why: 'These shape every pack and certificate you issue.', skip: 'The platform default template is used.', tutorialKey: 'oa.setup-4', optional: true },
  { key: 'org.escalation', title: 'Escalation and automation rules', what: 'Rules that notify roles when something needs attention.', why: 'Nothing is escalated unless a rule says so.', skip: 'You start from the platform templates later.', tutorialKey: 'oa.setup-5', optional: true },
  { key: 'org.hosting', title: 'Hosting', what: 'Where Provio runs for you.', why: 'It decides where your data lives.', skip: 'You stay with QSCorp hosting.', tutorialKey: 'oa.setup-6', optional: false },
  { key: 'org.email', title: 'Email', what: 'How Provio sends your notifications.', why: 'Without this, notifications wait in the queue.', skip: 'Notifications are queued and not sent.', tutorialKey: 'oa.setup-7', optional: false },
  { key: 'org.golive', title: 'Health check and Go Live', what: 'A short check that everything is set.', why: 'It catches gaps before your team starts.', skip: 'You can run the check again any time.', tutorialKey: 'oa.setup-8', optional: false },
];

export const SA_WIZARD_STEPS: WizardStepDef[] = [
  { key: 'sa.readiness', title: 'Platform readiness check', what: 'Vault, schedules, storage and Edge Functions.', why: 'The platform cannot send or schedule without these.', skip: 'The platform stays partly configured.', tutorialKey: 'sa.setup-1', optional: false },
  { key: 'sa.create-org', title: 'Create the client organisation', what: 'The client name and the email of their first Org Admin.', why: 'Nothing exists for a client until their organisation does.', skip: 'The client cannot sign in or start an audit.', tutorialKey: 'sa.tenant-hub', optional: false },
  { key: 'sa.features', title: 'Feature catalogue and plans', what: 'What you sell and what each plan includes.', why: 'Entitlements are enforced from this catalogue.', skip: 'Only the seeded catalogue is available.', tutorialKey: 'sa.setup-6', optional: false },
  { key: 'sa.email', title: 'Platform email', what: 'The platform sender profile and its credentials.', why: 'It is the fallback sender for every tenant.', skip: 'Tenants without their own sender queue only.', tutorialKey: 'sa.setup-2', optional: false },
  { key: 'sa.invite-cap', title: 'Invitation cap for the client', what: 'How many people one administrator may invite per day.', why: 'It bounds the blast radius of a compromised admin account.', skip: 'The platform default of 20 per day applies.', tutorialKey: 'sa.tenant-hub', optional: true },
  { key: 'sa.first-admin', title: 'Invite the first Org Admin', what: 'Send the invitation that turns the client into a live tenant.', why: 'Until it is accepted the tenant has no administrator.', skip: 'The client cannot administer their own tenant.', tutorialKey: 'sa.setup-3', optional: false },
  { key: 'sa.first-engagement', title: 'Confirm the first engagement can be created', what: 'A read-only check that the client can start an audit.', why: 'It proves the tenant is complete before you hand it over.', skip: 'A gap surfaces later, in front of the client.', tutorialKey: 'sa.setup-8', optional: false },
  { key: 'sa.recipients', title: 'Platform notification recipients', what: 'Who receives platform alerts.', why: 'Platform alerts have no other destination.', skip: 'Platform alerts are logged only.', tutorialKey: 'sa.setup-3', optional: false },
  { key: 'sa.hosting', title: 'Hosting catalogue review', what: 'The stacks, rules and verdicts for the Hosting Fit check.', why: 'It sets expectations before a migration.', skip: 'The seeded rules are used.', tutorialKey: 'sa.setup-4', optional: true },
  { key: 'sa.rules', title: 'Platform default rules and templates', what: 'The rules and message templates every tenant starts from.', why: 'They are the default behaviour for a new tenant.', skip: 'New tenants start with no rules.', tutorialKey: 'sa.setup-5', optional: true },
  { key: 'sa.support', title: 'Time-boxed support access', what: 'Optional read-only access for support, with an expiry.', why: 'It lets you help without a standing grant.', skip: 'Support needs a new grant each time.', tutorialKey: 'sa.health', optional: true },
  { key: 'sa.tutorials', title: 'Tutorial library check', what: 'That every screen has its guided recording.', why: 'The recordings are how clients learn each screen.', skip: 'Missing recordings are listed in the library.', tutorialKey: 'sa.setup-7', optional: true },
  { key: 'sa.golive', title: 'New-tenant defaults and Go Live', what: 'The defaults a new tenant receives.', why: 'It decides what a new client sees on day one.', skip: 'The built-in defaults are used.', tutorialKey: 'sa.setup-8', optional: false },
];

export function wizardSteps(scope: SetupScope): WizardStepDef[] {
  return scope === 'super_admin' ? SA_WIZARD_STEPS : ORG_WIZARD_STEPS;
}

/** The steps to show for an org: optional steps requiring a disabled feature are hidden. */
export function visibleSteps(scope: SetupScope, enabledFeatures: Set<string>): WizardStepDef[] {
  return wizardSteps(scope).filter((s) => !s.requiresFeature || enabledFeatures.has(s.requiresFeature));
}
