import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

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

// The seed rights matrix from migration 0012_rights_closed.sql. The database decides access from
// these rights (caller_has_right), so the synthetic roles must carry them, not an empty map.
const RIGHTS_BY_ROLE: Record<string, Record<string, boolean>> = {
  org_admin: { manage_users: true, manage_roles: true, edit_config: true },
  cia: { manage_roles: true, edit_config: true, manage_engagements: true, approve_plan: true, review_and_approve: true, perform_work: true, can_reopen: true, view_all_scopes: true },
  audit_manager: { manage_engagements: true, review_and_approve: true, perform_work: true, view_all_scopes: true },
  observer: { read_only: true, view_all_scopes: true },
  reviewer: { review_and_approve: true, perform_work: true },
  preparer: { perform_work: true },
  auditee: { read_only: true },
};

/** The full eleven-key matrix, false-filled, so every role row carries every key (as 0012 does). */
function rightsFor(slug: string): Record<string, boolean> {
  const keys = ['manage_users', 'manage_roles', 'edit_config', 'manage_engagements', 'approve_plan', 'review_and_approve', 'perform_work', 'can_reopen', 'view_all_scopes', 'read_only', 'manage_team'];
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

const USERS = [
  { email: 'ayesha.khan@provio-test.invalid', name: 'Ayesha Khan', org: ORG_A, role: 'org_admin', roleIds: ROLE_IDS_A, universes: [A_U1] },
  { email: 'bilal.ahmed@provio-test.invalid', name: 'Bilal Ahmed', org: ORG_A, role: 'preparer', roleIds: ROLE_IDS_A, universes: [A_U1] },
  { email: 'hamza.qureshi@provio-test.invalid', name: 'Hamza Qureshi', org: ORG_B, role: 'org_admin', roleIds: ROLE_IDS_B, universes: [B_U1, B_U2] },
  { email: 'sana.iqbal@provio-test.invalid', name: 'Sana Iqbal', org: ORG_B, role: 'reviewer', roleIds: ROLE_IDS_B, universes: [B_U1, B_U2] },
  { email: 'fatima.rehman@provio-test.invalid', name: 'Fatima Rehman', org: ORG_B, role: 'preparer', roleIds: ROLE_IDS_B, universes: [B_U1] },
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

  const password = generatePassword();
  process.env.E2E_PASSWORD = password;
  process.env.E2E_EMAIL = 'ayesha.khan@provio-test.invalid';

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

  for (const u of USERS) {
    const authId = await findOrCreateUser(sb, u.email);
    must('setPassword ' + u.email, await sb.auth.admin.updateUserById(authId, { password }));
    must('org_members ' + u.email, await sb.from('org_members').upsert({
      org_id: u.org,
      user_id: authId,
      role_id: u.roleIds[u.role],
      display_name: u.name,
    }, { onConflict: 'org_id,user_id' }));
  }

  // Platform staff (spec §24): no org membership, so the access-token hook stamps platform_admin.
  const platformId = await findOrCreateUser(sb, PLATFORM_EMAIL);
  must('setPassword ' + PLATFORM_EMAIL, await sb.auth.admin.updateUserById(platformId, { password }));
  must('platform_admins', await sb.from('platform_admins').upsert({ user_id: platformId }, { onConflict: 'user_id' }));

  const members = must('members', await sb.from('org_members').select('org_id, user_id, display_name').in('org_id', [ORG_A, ORG_B]));
  const authIdFor = (email: string, org: string) => {
    const u = USERS.find((x) => x.email === email && x.org === org)!;
    return members.data!.find((m) => m.org_id === org && m.display_name === u.name)!.user_id as string;
  };

  must('delete scopes', await sb.from('user_scopes').delete().in('org_id', [ORG_A, ORG_B]));
  const scopes = USERS.flatMap((u) =>
    u.universes.map((universe) => ({ org_id: u.org, user_id: authIdFor(u.email, u.org), universe_id: universe, entity_id: null, engagement_id: null })),
  );
  must('insert scopes', await sb.from('user_scopes').insert(scopes));

  // Leave no residue (M5): the invite cap counts events per org and per user per day, so a run
  // that created members would otherwise change the cap the next run observes.
  must('delete invite_cap_events', await sb.from('invite_cap_events').delete().in('org_id', [ORG_A, ORG_B]));
}
