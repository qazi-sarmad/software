/**
 * Org settings data module (C3, spec §11.2, §14.4, §16).
 *
 * The only place the Org Admin Settings screens talk to the database for the sampling table,
 * severity levels and email provider shape. Components never import the Supabase client. Reads use
 * RLS-scoped selects; every write goes through an RPC in migration 0032, which requires edit_config.
 */
import { callRpc, getClient, type DataResult } from './db';


export interface SeverityLevelRow {
  id: string;
  name: string;
  colorToken: string;
  rank: number;
}

export interface EmailSettingsRow {
  provider: 'stub' | 'resend' | 'graph';
  fromAddress: string | null;
}

const NOT_CONFIGURED = 'The settings module is not configured.';

/** The design-token colours a severity level may use (migration 0030 CHECK). */
export const SEVERITY_COLOR_TOKENS = [
  '--accent-primary', '--accent-primary-subtle', '--accent-cinnabar', '--accent-cinnabar-subtle',
  '--accent-brass', '--accent-brass-subtle', '--accent-verdigris', '--accent-verdigris-subtle',
  '--accent-verdigris-text',
] as const;

export const EMAIL_PROVIDERS = ['stub', 'resend', 'graph'] as const;

export async function listSeverityLevels(): Promise<SeverityLevelRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('severity_levels')
    .select('id, name, color_token, rank')
    .order('rank');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    colorToken: r.color_token as string,
    rank: r.rank as number,
  }));
}

export function upsertSeverityLevel(
  name: string, colorToken: string, rank: number, id: string | null = null
): Promise<DataResult> {
  return callRpc(
    'admin_upsert_severity_level',
    { p_name: name, p_color_token: colorToken, p_rank: rank, p_id: id },
    NOT_CONFIGURED
  );
}

export function deleteSeverityLevel(id: string): Promise<DataResult> {
  return callRpc('admin_delete_severity_level', { p_id: id }, NOT_CONFIGURED);
}

export async function getEmailSettings(): Promise<EmailSettingsRow | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.from('email_settings').select('provider, from_address').maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    provider: data.provider as 'stub' | 'resend' | 'graph',
    fromAddress: (data.from_address as string | null) ?? null,
  };
}

export function setEmailProvider(provider: string, fromAddress: string | null = null): Promise<DataResult> {
  return callRpc(
    'admin_set_email_provider',
    { p_provider: provider, p_from_address: fromAddress },
    NOT_CONFIGURED
  );
}
