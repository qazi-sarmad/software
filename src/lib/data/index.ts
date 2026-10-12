// This is the only module importing the Supabase SDK. Never use a service-role key here.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuditCase, AuditCommand, AuditEvent, AuditSnapshot, ProvioDataPort } from './contracts';

let client: SupabaseClient | undefined;
function db() {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Configure the Supabase URL and publishable/anon key. Demo fallback is disabled.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(parsed.hostname)) throw new Error('Supabase requires HTTPS.');
  client = createClient(url,key,{ auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  return client;
}
export const auth = {
  session: async () => { const {data,error}=await db().auth.getSession(); if(error) throw error; return data.session; },
  subscribe: (fn: (id: string | null) => void) => db().auth.onAuthStateChange((_event,session)=>fn(session?.user.id ?? null)).data.subscription,
  signIn: async (email: string,password: string) => { const {error}=await db().auth.signInWithPassword({email,password}); if(error) throw error; },
  signOut: async () => { const {error}=await db().auth.signOut({scope: 'local'}); if(error) throw error; },
};
async function rpc<T>(name: string,args?: Record<string,unknown>): Promise<T> {
  const {data,error}=await db().rpc(name,args);
  if(error) {
    const failure = new Error(error.message);
    Object.assign(failure, {definitivelyRejected: /^(?:[0-9A-Z]{5}|PGRST\d+)$/.test(error.code ?? '')});
    throw failure;
  }
  return data as T;
}
async function readAll<T>(table: string, order = 'id'): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db().from(table).select('*').order(order).range(offset, offset + 499);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 500) return rows;
  }
}

export const auditData: ProvioDataPort = {
  async snapshot(): Promise<AuditSnapshot> {
    const [cases,entities,memberships,issued]=await Promise.all([
      readAll<AuditSnapshot['cases'][number]>('audit_cases'),
      readAll<AuditSnapshot['entities'][number]>('audit_entities'),
      readAll<AuditSnapshot['memberships'][number]>('memberships','org_id'),
      rpc<AuditSnapshot['issued']>('issued_audits'),
    ]);
    return {cases,entities,memberships,issued};
  },
  command: (c: AuditCommand) => rpc<AuditCase>('audit_command',{p_case:c.caseId,p_expected:c.expectedVersion,p_key:c.key,p_action:c.action,p_data:c.data}),
  async events(caseId) {
    // Page the chain; Supabase's default 1000-row cap must never silently truncate an export.
    const events: AuditEvent[]=[];
    for(let offset=0;;offset+=500) {
      const {data,error}=await db().from('audit_events').select('*').eq('case_id',caseId).order('seq').range(offset,offset+499);
      if(error) throw new Error(error.message);
      events.push(...(data ?? []));
      if(!data || data.length<500) return events;
    }
  },
  evidence: id => rpc('read_audit_evidence',{p_id:id}),
};
