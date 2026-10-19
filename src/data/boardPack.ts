/**
 * Board Pack data module (F10, S7). Every call goes through a typed function here; components never
 * import the database client (rule M8). The snapshot is built and hashed in the database; this module
 * reads it, turns it into rows through src/lib/boardPack.ts, and calls the generator.
 */
import { callRpc, getClient, type DataResult } from './db';
import type {
  BoardPackRow,
  BoardPackSection,
  BoardPackSnapshot,
} from '../lib/boardPack';

const NOT_CONFIGURED = 'The Board Pack module is not configured.';

export type BoundaryKind = 'since_last' | 'custom' | 'since_meeting';

export interface OrgSettingsExtra {
  appBaseUrl: string;
  lastBoardMeetingDate: string | null;
  certificateAutoIssue: boolean;
  publicVerifyShowTitle: boolean;
  aiRetentionDays: number;
}

interface RawSettings {
  app_base_url: string | null;
  last_board_meeting_date: string | null;
  certificate_auto_issue: boolean;
  public_verify_show_title: boolean;
  ai_retention_days: number;
}

/** The tenant-level settings the Board Pack and the certificate read (app_base_url and friends). */
export async function getOrgSettingsExtra(orgId: string): Promise<OrgSettingsExtra | null> {
  const sb = getClient();
  if (!sb || !orgId) return null;
  const { data, error } = await sb.rpc('org_settings_extra_get', { p_org: orgId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as RawSettings | undefined;
  if (!raw) return null;
  return {
    appBaseUrl: raw.app_base_url ?? '',
    lastBoardMeetingDate: raw.last_board_meeting_date,
    certificateAutoIssue: raw.certificate_auto_issue,
    publicVerifyShowTitle: raw.public_verify_show_title,
    aiRetentionDays: raw.ai_retention_days,
  };
}

/** Save tenant-level settings. Needs edit_config (or an active consultation session). */
export function saveOrgSettingsExtra(orgId: string, fields: Partial<{
  appBaseUrl: string; lastBoardMeetingDate: string | null; certificateAutoIssue: boolean;
  publicVerifyShowTitle: boolean; aiRetentionDays: number;
}>): Promise<DataResult> {
  return callRpc('org_settings_extra_save', {
    p_org: orgId,
    p_fields: {
      app_base_url: fields.appBaseUrl,
      last_board_meeting_date: fields.lastBoardMeetingDate,
      certificate_auto_issue: fields.certificateAutoIssue,
      public_verify_show_title: fields.publicVerifyShowTitle,
      ai_retention_days: fields.aiRetentionDays,
    },
  }, NOT_CONFIGURED);
}

export interface GenerateOptions {
  scopeKey?: string;
  boundaryKind?: BoundaryKind;
  from?: string | null;
  to?: string | null;
}

interface RawPackRow {
  id: string;
  scope_key: string;
  scope_description: string | null;
  boundary_kind: string;
  from_ts: string | null;
  to_ts: string | null;
  generated_by: string | null;
  generated_at: string;
  data_hash: string;
  status: string;
  ledger_entry_id: string | null;
  previous_pack_id: string | null;
}

interface RawSection {
  section_key: string;
  label: string;
  ordinal: number;
  enabled: boolean;
  visible_roles: string[] | null;
}

function toRow(r: RawPackRow): BoardPackRow {
  return {
    id: r.id,
    scopeKey: r.scope_key,
    scopeDescription: r.scope_description ?? r.scope_key,
    boundaryKind: r.boundary_kind,
    fromTs: r.from_ts,
    toTs: r.to_ts,
    generatedBy: r.generated_by,
    generatedAt: r.generated_at,
    dataHash: r.data_hash,
    status: r.status,
    ledgerEntryId: r.ledger_entry_id,
    previousPackId: r.previous_pack_id,
  };
}

/** The pack history for a scope (or every scope when none is given). Needs view_board_pack. */
export async function listBoardPacks(orgId: string, scopeKey?: string | null): Promise<BoardPackRow[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.rpc('board_pack_list', { p_org: orgId, p_scope_key: scopeKey ?? null });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawPackRow[]).map(toRow);
}

/** One pack with its snapshot, or null when it is not visible to the caller. */
export async function getBoardPack(packId: string): Promise<{ row: BoardPackRow; snapshot: BoardPackSnapshot } | null> {
  const sb = getClient();
  if (!sb || !packId) return null;
  const { data, error } = await sb.rpc('board_pack_get', { p_id: packId });
  if (error) throw new Error(error.message);
  const raw = (Array.isArray(data) ? data[0] : data) as
    | (RawPackRow & { snapshot: BoardPackSnapshot })
    | undefined;
  if (!raw) return null;
  return {
    row: toRow({ ...raw, scope_description: raw.scope_description ?? null } as RawPackRow),
    snapshot: raw.snapshot ?? {},
  };
}

/** Generate a pack. Needs generate_board_pack, the board_pack feature and a set app_base_url. */
export function generateBoardPack(orgId: string, opts: GenerateOptions = {}): Promise<DataResult> {
  return callRpc('board_pack_generate', {
    p_org: orgId,
    p_scope_key: opts.scopeKey ?? 'org',
    p_boundary_kind: opts.boundaryKind ?? 'since_last',
    p_from: opts.from ?? null,
    p_to: opts.to ?? null,
  }, NOT_CONFIGURED);
}

/** The configured section list, in order. Falls back to the F10 defaults when unset. */
export async function listBoardPackSections(orgId: string): Promise<BoardPackSection[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb
    .from('board_pack_sections')
    .select('section_key,label,ordinal,enabled,visible_roles')
    .eq('org_id', orgId)
    .order('ordinal', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RawSection[]).map((s) => ({
    sectionKey: s.section_key,
    label: s.label,
    ordinal: s.ordinal,
    enabled: s.enabled,
    visibleRoles: s.visible_roles ?? [],
  }));
}

/** Save the section list (reorder, enable or disable, role visibility). Needs edit_config. */
export function saveBoardPackSections(
  orgId: string,
  sections: { sectionKey: string; ordinal: number; enabled: boolean; visibleRoles: string[]; label?: string }[]
): Promise<DataResult> {
  return callRpc('board_pack_sections_save', {
    p_org: orgId,
    p_sections: sections.map((s) => ({
      section_key: s.sectionKey,
      ordinal: s.ordinal,
      enabled: s.enabled,
      visible_roles: s.visibleRoles,
      label: s.label,
    })),
  }, NOT_CONFIGURED);
}
