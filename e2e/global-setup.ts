import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Synthetic test data only. Fixed ids make every run idempotent.
const ORG_A = '02af9314-9781-5bde-b8a7-d46bfee07783';
const ORG_B = 'bb3f7e0e-c6db-5121-a9e0-2e102e1fa2ab';
const A_U1 = 'f011bd6c-12ce-5b8f-b945-a5f67d65482d';
const B_U1 = '9da6011b-49ea-5779-ac15-170b23ec123a';
const B_U2 = '3dd4b6f1-9f4b-57d9-a846-336993d97ec3';

/** Platform staff login (spec §24). No org membership; the access-token hook stamps platform_admin. */
const PLATFORM_EMAIL = 'platform.admin@provio-test.invalid';

const ROLE_NAMES: [string, string][] = [
  ['CIA', 'cia'],
  ['Audit Manager', 'audit_manager'],
  ['Reviewer', 'reviewer'],
  ['Preparer', 'preparer'],
  ['Observer', 'observer'],
  ['Org Admin', 'org_admin'],
  ['Auditee', 'auditee'],
];

// The seed rights matrix from migration 0050_rights_extended.sql (fifteen keys; 0012 grew into it).
// these rights (caller_has_right), so the synthetic roles must carry them, not an empty map.
const RIGHTS_BY_ROLE: Record<string, Record<string, boolean>> = {
  org_admin: { manage_users: true, manage_roles: true, edit_config: true, manage_engagements: false, approve_plan: false, review_and_approve: false, perform_work: false, can_reopen: false, view_all_scopes: false, read_only: false, manage_team: false, view_board_pack: false, generate_board_pack: false, use_ai_assist: false, view_insights: false },
  cia: { manage_roles: true, edit_config: true, manage_engagements: true, approve_plan: true, review_and_approve: true, perform_work: true, can_reopen: true, view_all_scopes: true, view_board_pack: true, generate_board_pack: true, use_ai_assist: true, view_insights: true },
  audit_manager: { manage_engagements: true, review_and_approve: true, perform_work: true, view_all_scopes: true, view_board_pack: true, use_ai_assist: true, view_insights: true },
  observer: { read_only: true, view_all_scopes: true, view_board_pack: true },
  reviewer: { review_and_approve: true, perform_work: true, use_ai_assist: true },
  preparer: { perform_work: true, use_ai_assist: true },
  auditee: { read_only: true },
};

/** The full fifteen-key matrix, false-filled, so every role row carries every key (as 0050 does). */
function rightsFor(slug: string): Record<string, boolean> {
  const keys = ['manage_users', 'manage_roles', 'edit_config', 'manage_engagements', 'approve_plan', 'review_and_approve', 'perform_work', 'can_reopen', 'view_all_scopes', 'read_only', 'manage_team', 'view_board_pack', 'generate_board_pack', 'use_ai_assist', 'view_insights'];
  const held = RIGHTS_BY_ROLE[slug] ?? {};
  return Object.fromEntries(keys.map((k) => [k, held[k] === true]));
}

const ROLE_IDS_A: Record<string, string> = {
  cia: '954c1587-4b41-59de-8048-5f7437b3c8e1',
  audit_manager: 'a1f462bc-86c4-516a-a980-3087b287d5eb',
  reviewer: 'ade6edbf-e500-55a2-a177-c224efb64acc',
  preparer: '07aa7052-46f3-5496-98fd-f68d6265351c',
  observer: '444fb3b5-0738-5509-9e43-358b43f2a44e',
  org_admin: '23a796a4-07e7-5274-b84e-e774c3ff7408',
  auditee: '85fec51d-7e1d-580a-8818-06bce3ac2316',
};
const ROLE_IDS_B: Record<string, string> = {
  cia: 'b5ef3ed3-df29-523e-8769-3510329ddcfb',
  audit_manager: '692fdf37-afdd-5b1f-85b0-5c66ad6e961b',
  reviewer: 'eef9f340-c392-5a6d-840d-2201b4a9f57f',
  preparer: 'ff3c89b5-ae39-51a2-8d8a-f53e4d649506',
  observer: '6b853306-8505-56e2-acba-b93be2cf3a31',
  org_admin: '86cf699a-aa09-5459-93fb-0c06ae27fd51',
  auditee: '28e2428f-e5be-551d-a7bf-7ccdde32445b',
};

// The `universes` list becomes the user's user_scopes rows. Audit-side accounts (bilal, sana,
// fatima) intentionally carry no scope row: an empty scope list is the "all universes" path, which
// is what lets them reach the seeded audit records the UI specs exercise. The two org admins keep
// a scope row so the RLS spec still observes non-empty user_scopes for its own org.
const USERS = [
  { email: 'ayesha.khan@provio-test.invalid', name: 'Ayesha Khan', org: ORG_A, role: 'org_admin', roleIds: ROLE_IDS_A, universes: [A_U1] },
  { email: 'bilal.ahmed@provio-test.invalid', name: 'Bilal Ahmed', org: ORG_A, role: 'preparer', roleIds: ROLE_IDS_A, universes: [] },
  // Audit manager: holds manage_engagements, which the Phase 7 import/activity/prior-year flows need.
  { email: 'zara.malik@provio-test.invalid', name: 'Zara Malik', org: ORG_A, role: 'audit_manager', roleIds: ROLE_IDS_A, universes: [] },
  { email: 'hamza.qureshi@provio-test.invalid', name: 'Hamza Qureshi', org: ORG_B, role: 'org_admin', roleIds: ROLE_IDS_B, universes: [B_U1, B_U2] },
  { email: 'sana.iqbal@provio-test.invalid', name: 'Sana Iqbal', org: ORG_B, role: 'reviewer', roleIds: ROLE_IDS_B, universes: [] },
  { email: 'fatima.rehman@provio-test.invalid', name: 'Fatima Rehman', org: ORG_B, role: 'preparer', roleIds: ROLE_IDS_B, universes: [] },
];

function must<T extends { error: { message: string } | null }>(label: string, result: T): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result;
}

function generatePassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(24), (b) => chars[b % chars.length]).join('');
}

async function findOrCreateUser(sb: SupabaseClient, email: string): Promise<string> {
  const list = must('listUsers', await sb.auth.admin.listUsers({ page: 1, perPage: 1000 }));
  const existing = list.data.users.find((u) => u.email === email);
  if (existing) return existing.id;
  const created = must('createUser ' + email, await sb.auth.admin.createUser({ email, email_confirm: true, password: 'placeholder-replaced-below' }));
  return created.data.user!.id;
}

export default async function globalSetup() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error('E2E setup needs SUPABASE_URL and SUPABASE_SECRET_KEY');
  const sb = createClient(url, secret, { auth: { persistSession: false } });

  const passwords: Record<string, string> = {};
  const passwordFor = (email: string) => (passwords[email] ??= generatePassword());

  must('orgs', await sb.from('orgs').upsert([
    { id: ORG_A, name: 'Synthetic Org A (Lahore, single universe)', is_demo: true },
    { id: ORG_B, name: 'Synthetic Org B (Karachi, two universes)', is_demo: true },
  ], { onConflict: 'id' }));

  const roles = [
    ...ROLE_NAMES.map(([name, slug]) => ({ id: ROLE_IDS_A[slug], org_id: ORG_A, name, slug, is_seed: true, rights: rightsFor(slug) })),
    ...ROLE_NAMES.map(([name, slug]) => ({ id: ROLE_IDS_B[slug], org_id: ORG_B, name, slug, is_seed: true, rights: rightsFor(slug) })),
  ];
  must('roles', await sb.from('roles').upsert(roles, { onConflict: 'id' }));

  must('universes', await sb.from('universes').upsert([
    { id: A_U1, org_id: ORG_A, name: 'Operations Audit (Test)', domain: 'Operations' },
    { id: B_U1, org_id: ORG_B, name: 'Financial Audit (Test)', domain: 'Finance' },
    { id: B_U2, org_id: ORG_B, name: 'IT Audit (Test)', domain: 'Technology' },
  ], { onConflict: 'id' }));

  must('entities', await sb.from('entities').upsert([
    { id: '6130452d-1288-53a3-a1d0-b66e34cd7d69', org_id: ORG_A, universe_id: A_U1, name: 'Lahore Plant (Test)', kind: 'process', approved: true },
    { id: 'c5166c65-1481-56c9-b3d6-b9a9bf42bd66', org_id: ORG_A, universe_id: A_U1, name: 'Procurement (Test)', kind: 'process', approved: true },
    { id: '5c54c4d4-791e-56bf-a328-521b1d3b316f', org_id: ORG_A, universe_id: A_U1, name: 'Payroll (Test)', kind: 'process', approved: true },
    { id: '78b72d04-5134-5b50-8d42-48a306809c07', org_id: ORG_B, universe_id: B_U1, name: 'Treasury (Test)', kind: 'process', approved: true },
    { id: '353c19f3-dfe5-585e-aea0-78da873140fb', org_id: ORG_B, universe_id: B_U1, name: 'Accounts Payable (Test)', kind: 'process', approved: true },
    { id: 'aaf9bde0-512f-53b2-beef-def76ff6ca80', org_id: ORG_B, universe_id: B_U2, name: 'Access Management (Test)', kind: 'process', approved: true },
  ], { onConflict: 'id' }));

  // R6a precondition. The database seeds a default SIRA model per org (migration 0019's insert trigger
  // plus its backfill), but an org created inside this run would not have one until the next migration
  // pass, so the harness seeds it explicitly and idempotently. phase3.spec still asserts the SIRA
  // inspector's empty state: the SIRA tab opens that inspector with a null model regardless of the DB.
  const SIRA_FACTORS: [string, string, number, number][] = [
    ['inherent_risk', 'Inherent risk', 1, 1],
    ['complexity', 'Complexity', 1, 2],
    ['regulatory_exposure', 'Regulatory exposure', 1, 3],
    ['prior_findings', 'Prior findings', 1, 4],
    ['time_since_audit', 'Time since last audit', 1, 5],
    ['materiality', 'Materiality', 1, 6],
  ];
  const SIRA_SCALES = ['Very low', 'Low', 'Medium', 'High', 'Very high'];
  const SIRA_BANDS: [string, number, number, number][] = [
    ['Low', 0, 25, 1],
    ['Medium', 25, 50, 2],
    ['High', 50, 75, 3],
    ['Critical', 75, 100, 4],
  ];
  for (const org of [ORG_A, ORG_B]) {
    must('sira_models', await sb.from('sira_models').upsert({ org_id: org }, { onConflict: 'org_id' }));
    must('sira_factors', await sb.from('sira_factors').upsert(
      SIRA_FACTORS.map(([key, label, weight, ordinal]) => ({ org_id: org, key, label, weight, ordinal })),
      { onConflict: 'org_id,key' }));
    must('sira_scales', await sb.from('sira_scales').upsert(
      SIRA_SCALES.map((label, i) => ({ org_id: org, point: i + 1, label })),
      { onConflict: 'org_id,point' }));
    must('sira_bands', await sb.from('sira_bands').upsert(
      SIRA_BANDS.map(([name, min_score, max_score, ordinal]) => ({ org_id: org, name, min_score, max_score, ordinal })),
      { onConflict: 'org_id,name' }));
  }

  for (const u of USERS) {
    const authId = await findOrCreateUser(sb, u.email);
    must('setPassword ' + u.email, await sb.auth.admin.updateUserById(authId, { password: passwordFor(u.email) }));
    must('org_members ' + u.email, await sb.from('org_members').upsert({
      org_id: u.org,
      user_id: authId,
      role_id: u.roleIds[u.role],
      display_name: u.name,
    }, { onConflict: 'org_id,user_id' }));
  }

  // Platform staff (spec §24): no org membership, so the access-token hook stamps platform_admin.
  const platformId = await findOrCreateUser(sb, PLATFORM_EMAIL);
  must('setPassword ' + PLATFORM_EMAIL, await sb.auth.admin.updateUserById(platformId, { password: passwordFor(PLATFORM_EMAIL) }));
  must('platform_admins', await sb.from('platform_admins').upsert({ user_id: platformId }, { onConflict: 'user_id' }));

  // R6c: hand each spec the password for the account it signs in as. The file lives under the
  // git-ignored e2e/.auth/ and is regenerated every run, so no password is ever committed.
  mkdirSync(join(process.cwd(), 'e2e', '.auth'), { recursive: true });
  writeFileSync(
    join(process.cwd(), 'e2e', '.auth', 'passwords.json'),
    JSON.stringify(passwords, null, 2)
  );

  const members = must('members', await sb.from('org_members').select('org_id, user_id, display_name').in('org_id', [ORG_A, ORG_B]));
  const authIdFor = (email: string, org: string) => {
    const u = USERS.find((x) => x.email === email && x.org === org)!;
    return members.data!.find((m) => m.org_id === org && m.display_name === u.name)!.user_id as string;
  };

  must('delete scopes', await sb.from('user_scopes').delete().in('org_id', [ORG_A, ORG_B]));
  // Scope rows are what RLS and the scope assertions observe. The audit-side e2e users (bilal,
  // sana, fatima) are deliberately left UNscoped: an empty universeIds list is the documented
  // "all universes in the org" path in src/lib/access.ts, which is how they reach the seeded
  // audit records. Scoping them to a synthetic universe id (not present in the tenant seed data)
  // would filter every seeded record out. ayesha and hamza keep a scope row so rls.spec's
  // non-vacuous "own org rows" check still holds.
  const scopes = USERS.filter((u) => u.universes.length > 0).flatMap((u) =>
    u.universes.map((universe) => ({ org_id: u.org, user_id: authIdFor(u.email, u.org), universe_id: universe, entity_id: null, engagement_id: null })),
  );
  must('insert scopes', await sb.from('user_scopes').insert(scopes));

  // Leave no residue (M5): the invite cap counts events per org and per user per day, so a run
  // that created members would otherwise change the cap the next run observes. The live invitations
  // go with them (S3): a leftover row would make a later run's token look used.
  must('delete auth_invites', await sb.from('auth_invites').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete invite_cap_events', await sb.from('invite_cap_events').delete().in('org_id', [ORG_A, ORG_B]));

  // Phase 4 workspace residue (4I). The testing workspace writes populations, samples, workpaper
  // rows and analysis results; a run must not change what the next run observes. Ordered so children
  // go before parents (sample rows -> samples -> populations).
  must('delete workpaper_rows', await sb.from('workpaper_rows').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete sample_rows', await sb.from('sample_rows').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete samples', await sb.from('samples').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete population_rows', await sb.from('population_rows').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete populations', await sb.from('populations').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete analysis_results', await sb.from('analysis_results').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete planning_sections', await sb.from('planning_sections').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete planning_suggestion_decisions', await sb.from('planning_suggestion_decisions').delete().in('org_id', [ORG_A, ORG_B]));

  // Phase 5 workspace residue (5G). Findings, observations, issues, the conclusion record and the
  // document extractions written by a run must not change what the next run observes (M5).
  must('delete findings', await sb.from('findings').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete observations', await sb.from('observations').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete issues', await sb.from('issues').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete conclusion_records', await sb.from('conclusion_records').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete document_extractions', await sb.from('document_extractions').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete evidence_files', await sb.from('evidence_files').delete().in('org_id', [ORG_A, ORG_B]));

  // Phase 6 residue (6H). A run that composes a report writes report_versions/report_blocks, and a
  // comment or CAP write leaves rows behind; clear them so the next run observes the same start (M5).
  must('delete report_comments', await sb.from('report_comments').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete report_blocks', await sb.from('report_blocks').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete report_versions', await sb.from('report_versions').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete caps', await sb.from('caps').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete email_queue', await sb.from('email_queue').delete().in('org_id', [ORG_A, ORG_B]));

  // Phase 7 residue (7G). The export panel records exports_log rows, the import wizard writes
  // import_jobs/prior_year_imports, and the activity-log view can archive a period. Clear them so
  // the next run observes the same starting state (M5).
  must('delete exports_log', await sb.from('exports_log').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete prior_year_imports', await sb.from('prior_year_imports').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete import_jobs', await sb.from('import_jobs').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete archive_jobs', await sb.from('archive_jobs').delete().in('org_id', [ORG_A, ORG_B]));

  // ACP residue (S1.c, M5). A Dual Session leaves sessions and proposals; an entitlement toggle
  // leaves an entitlement row; a wizard run leaves setup_state and tutorial_views rows. Clear them
  // so the next run observes the same starting state. consultation_events and
  // tenant_entitlement_versions are append-only by trigger (L5) and are deliberately left in place;
  // the specs never assert on their counts.
  must('delete consultation_proposals', await sb.from('consultation_proposals').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete consultation_sessions', await sb.from('consultation_sessions').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete tutorial_views', await sb.from('tutorial_views').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete setup_state', await sb.from('setup_state').delete().in('org_id', [ORG_A, ORG_B]));
  must('delete tenant_entitlements', await sb.from('tenant_entitlements').delete().in('org_id', [ORG_A, ORG_B]));
}
