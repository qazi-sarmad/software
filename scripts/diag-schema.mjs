/**
 * Temporary diagnostic (not a product script): report which tables/columns the hosted test project
 * actually has, so a schema-drift failure can be told apart from an application defect.
 */
import { createClient } from '@supabase/supabase-js';

const trim = (v) => (v ?? '').replace(/[\r\n\t ]/g, '');
const url = trim(process.env.TEST_SUPABASE_URL ?? process.env.SUPABASE_URL);
const key = trim(process.env.TEST_SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY);
if (!url || !key) { console.log('no credentials'); process.exit(0); }

const sb = createClient(url, key, { auth: { persistSession: false } });

const tables = [
  'sira_models', 'sira_factors', 'sira_emergent_risks', 'sira_carry_forward', 'sira_acceptances',
  'activity_log', 'capability_config', 'evidence_files', 'integrity_alerts',
  'guided_first_run_state', 'tenant_entitlements', 'notifications',
];
for (const t of tables) {
  const { error } = await sb.from(t).select('*').limit(1);
  console.log(`TABLE ${t}: ${error ? 'ERR ' + error.message : 'OK'}`);
}

const columns = [
  ['sira_emergent_risks', 'source_kind'],
  ['sira_emergent_risks', 'source_id'],
  ['sira_emergent_risks', 'proposal_reason'],
];
for (const [t, c] of columns) {
  const { error } = await sb.from(t).select(c).limit(1);
  console.log(`COLUMN ${t}.${c}: ${error ? 'ERR ' + error.message : 'OK'}`);
}

const rpcs = [
  'sira_model_snapshot', 'activity_spine_list', 'sira_acceptance_state',
  'sira_carry_forward_pack', 'integrity_alerts_list', 'capability_library_list',
];
for (const r of rpcs) {
  const { error } = await sb.rpc(r, {});
  console.log(`RPC ${r}: ${error ? 'ERR ' + error.message : 'OK'}`);
}
