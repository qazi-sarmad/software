/**
 * Imports data module (7F, spec §19).
 *
 * The three-step wizard (upload -> mapping -> confirm) maps onto start_import / validate_import /
 * commit_import (migration 0042). Validation happens in the database so the org scope is enforced
 * there. Components never import the Supabase client.
 */
import { getClient } from './db';

export type ImportType = 'rcm' | 'entities' | 'users' | 'populations';
export type ImportStatus = 'pending' | 'mapping' | 'validating' | 'done' | 'failed';

export interface ImportJobRow {
  id: string;
  importType: ImportType;
  sourceFilename: string | null;
  status: ImportStatus;
  errorRows: unknown[];
  createdAt: string | null;
  createdBy: string | null;
}

export interface ImportValidation {
  valid: number;
  invalid: number;
  errors: { row: number; field: string; reason: string }[];
}

/** Step 1: create a pending job for the uploaded file. Returns the new job id. */
export async function startImport(importType: ImportType, sourceFilename: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('start_import', {
    p_import_type: importType, p_source_filename: sourceFilename,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/** Step 2: validate mapped rows; returns counts and per-row, per-field errors. */
export async function validateImport(jobId: string, mappedRows: unknown[]): Promise<ImportValidation | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('validate_import', { p_job_id: jobId, p_mapped_rows: mappedRows });
  if (error) throw new Error(error.message);
  if (!data) return null;
  const d = data as Record<string, unknown>;
  return {
    valid: (d.valid as number | null) ?? 0,
    invalid: (d.invalid as number | null) ?? 0,
    errors: (d.errors as ImportValidation['errors'] | null) ?? [],
  };
}

/** Step 3: commit the validated rows. Returns the number of rows written. */
export async function commitImport(jobId: string, mappedRows: unknown[]): Promise<number> {
  const sb = getClient();
  if (!sb) return 0;
  const { data, error } = await sb.rpc('commit_import', { p_job_id: jobId, p_mapped_rows: mappedRows });
  if (error) throw new Error(error.message);
  return (data as number | null) ?? 0;
}

export async function listImportJobs(): Promise<ImportJobRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('import_jobs')
    .select('id, import_type, source_filename, status, error_rows, created_at, created_by')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((j) => ({
    id: j.id as string,
    importType: (j.import_type as ImportType) ?? 'rcm',
    sourceFilename: (j.source_filename as string | null) ?? null,
    status: (j.status as ImportStatus) ?? 'pending',
    errorRows: (j.error_rows as unknown[] | null) ?? [],
    createdAt: (j.created_at as string | null) ?? null,
    createdBy: (j.created_by as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Prior-year import (§19.2). A prior-year item is imported as 'Imported - confirm' and does not count
// toward sign-off until it is confirmed (enforced by sign_planning in migration 0044).
// ---------------------------------------------------------------------------

export type PriorYearItemType = 'risk_control_mapping' | 'scope' | 'procedures' | 'resource_estimates';
export type PriorYearStatus = 'imported_confirm' | 'confirmed' | 'reverted';

export interface PriorYearImportRow {
  id: string;
  engagementId: string;
  itemType: PriorYearItemType;
  sourceEngagementId: string;
  status: PriorYearStatus;
  importedAt: string | null;
  confirmedAt: string | null;
}

/** Copy one item type from a source engagement. Requires manage_engagements; returns the new id. */
export async function importPriorYearItem(
  sourceEngagementId: string, itemType: PriorYearItemType, engagementId: string
): Promise<string | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.rpc('import_prior_year_item', {
    p_source_engagement_id: sourceEngagementId, p_item_type: itemType, p_engagement_id: engagementId,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

export async function confirmPriorYearItem(importId: string): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  const { error } = await sb.rpc('confirm_prior_year_item', { p_import_id: importId });
  if (error) throw new Error(error.message);
}

export async function revertPriorYearItem(importId: string): Promise<void> {
  const sb = getClient();
  if (!sb) return;
  const { error } = await sb.rpc('revert_prior_year_item', { p_import_id: importId });
  if (error) throw new Error(error.message);
}

export async function unconfirmedPriorYearImports(engagementId: string): Promise<number> {
  const sb = getClient();
  if (!sb) return 0;
  const { data, error } = await sb.rpc('unconfirmed_prior_year_imports', { p_engagement_id: engagementId });
  if (error) throw new Error(error.message);
  return (data as number | null) ?? 0;
}

export async function listPriorYearImports(engagementId: string): Promise<PriorYearImportRow[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb
    .from('prior_year_imports')
    .select('id, engagement_id, item_type, source_engagement_id, status, imported_at, confirmed_at')
    .eq('engagement_id', engagementId)
    .order('imported_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({
    id: p.id as string,
    engagementId: p.engagement_id as string,
    itemType: (p.item_type as PriorYearItemType) ?? 'scope',
    sourceEngagementId: p.source_engagement_id as string,
    status: (p.status as PriorYearStatus) ?? 'imported_confirm',
    importedAt: (p.imported_at as string | null) ?? null,
    confirmedAt: (p.confirmed_at as string | null) ?? null,
  }));
}
