/**
 * AI data module (F8). Every call goes through a typed function here; components never import the
 * database client. Only self-hosted, tenant-controlled endpoints are ever configured (L2).
 */
import { callRpc, getClient } from './db';

export interface AiModel {
  id: string;
  name: string;
  modelRef: string;
  status: string;
  notes?: string | null;
}

export interface DenyPattern {
  id: string;
  pattern: string;
  label?: string | null;
}

export interface AiUseCase {
  useCase: string;
  enabled: boolean;
  systemPrompt?: string | null;
  temperature: number;
  topP: number;
  maxTokens?: number | null;
}

export interface VoiceProfile {
  tone: string;
  person: string;
  length: string;
  customInstructions?: string | null;
}

export interface VoiceTerm {
  id: string;
  preferredPhrase?: string | null;
  avoidPhrase?: string | null;
  glossaryTerm?: string | null;
  definition?: string | null;
}

export interface VoiceSample {
  id: string;
  kind: string;
  title?: string | null;
  text: string;
  source?: string | null;
}

const NOT_CONFIGURED = 'The data module is not configured.';

// --- platform (Super Admin) -----------------------------------------------------------------

export async function listAiModels(): Promise<AiModel[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('ai_models').select('id, name, model_ref, status, notes').order('name');
  if (error || !data) return [];
  return data.map((r) => ({
    id: String(r.id), name: String(r.name), modelRef: String(r.model_ref),
    status: String(r.status), notes: (r.notes as string) ?? null,
  }));
}

export function addAiModel(name: string, modelRef: string, notes?: string) {
  return callRpc('ai_model_add', { p_name: name, p_model_ref: modelRef, p_notes: notes ?? null });
}

export function updateAiModel(id: string, name: string, modelRef: string, status: string) {
  return callRpc('ai_model_update', { p_id: id, p_name: name, p_model_ref: modelRef, p_status: status });
}

export function removeAiModel(id: string) {
  return callRpc('ai_model_remove', { p_id: id });
}

export function setTenantModel(orgId: string, modelId: string, useCase: string | null) {
  return callRpc('ai_tenant_set_model', { p_org: orgId, p_model_id: modelId, p_use_case: useCase });
}

export async function listDenyPatterns(): Promise<DenyPattern[]> {
  const sb = getClient();
  if (!sb) return [];
  const { data, error } = await sb.from('ai_endpoint_denylist').select('id, pattern, label').order('pattern');
  if (error || !data) return [];
  return data.map((r) => ({ id: String(r.id), pattern: String(r.pattern), label: (r.label as string) ?? null }));
}

export function addDenyPattern(pattern: string, label?: string) {
  return callRpc('ai_denylist_add', { p_pattern: pattern, p_label: label ?? null });
}

export function removeDenyPattern(id: string) {
  return callRpc('ai_denylist_remove', { p_id: id });
}

/** Ask the server whether a URL is a vendor-hosted host (F8). Returns false when unconfigured. */
export async function isEndpointDenied(url: string): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { data, error } = await sb.rpc('ai_endpoint_denied', { p_url: url });
  if (error) return false;
  return Boolean(data);
}

// --- org (Org Admin) ------------------------------------------------------------------------

export async function listUseCases(orgId: string): Promise<AiUseCase[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.from('ai_use_cases')
    .select('use_case, enabled, system_prompt, temperature, top_p, max_tokens').eq('org_id', orgId);
  if (error || !data) return [];
  return data.map((r) => ({
    useCase: String(r.use_case), enabled: Boolean(r.enabled),
    systemPrompt: (r.system_prompt as string) ?? null,
    temperature: Number(r.temperature), topP: Number(r.top_p),
    maxTokens: (r.max_tokens as number) ?? null,
  }));
}

export function saveUseCase(
  orgId: string, useCase: string, enabled: boolean, systemPrompt: string,
  temperature: number, topP: number, maxTokens?: number | null
) {
  return callRpc('ai_use_case_save', {
    p_org: orgId, p_use_case: useCase, p_enabled: enabled, p_system_prompt: systemPrompt,
    p_temperature: temperature, p_top_p: topP, p_max_tokens: maxTokens ?? null,
  });
}

export function setEndpoint(orgId: string, url: string | null, accessMode: 'server' | 'browser', secretId?: string | null) {
  return callRpc('ai_set_endpoint', { p_org: orgId, p_url: url, p_access_mode: accessMode, p_secret_id: secretId ?? null });
}

export async function getVoiceProfile(orgId: string): Promise<VoiceProfile | null> {
  const sb = getClient();
  if (!sb || !orgId) return null;
  const { data, error } = await sb.from('org_voice_profile')
    .select('tone, person, length, custom_instructions').eq('org_id', orgId).maybeSingle();
  if (error || !data) return null;
  return {
    tone: String(data.tone), person: String(data.person), length: String(data.length),
    customInstructions: (data.custom_instructions as string) ?? null,
  };
}

export function saveVoiceProfile(orgId: string, tone: string, person: string, length: string, custom: string) {
  return callRpc('ai_voice_profile_save', {
    p_org: orgId, p_tone: tone, p_person: person, p_length: length, p_custom: custom,
  });
}

export async function listVoiceTerms(orgId: string): Promise<VoiceTerm[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.from('org_voice_terms')
    .select('id, preferred_phrase, avoid_phrase, glossary_term, definition').eq('org_id', orgId);
  if (error || !data) return [];
  return data.map((r) => ({
    id: String(r.id), preferredPhrase: (r.preferred_phrase as string) ?? null,
    avoidPhrase: (r.avoid_phrase as string) ?? null,
    glossaryTerm: (r.glossary_term as string) ?? null, definition: (r.definition as string) ?? null,
  }));
}

export function addVoiceTerm(orgId: string, preferred: string, avoid: string, term: string, definition: string) {
  return callRpc('ai_voice_term_add', {
    p_org: orgId, p_preferred: preferred, p_avoid: avoid, p_term: term, p_definition: definition,
  });
}

export async function listVoiceSamples(orgId: string): Promise<VoiceSample[]> {
  const sb = getClient();
  if (!sb || !orgId) return [];
  const { data, error } = await sb.from('org_voice_samples')
    .select('id, kind, title, text, source').eq('org_id', orgId);
  if (error || !data) return [];
  return data.map((r) => ({
    id: String(r.id), kind: String(r.kind), title: (r.title as string) ?? null,
    text: String(r.text ?? ''), source: (r.source as string) ?? null,
  }));
}

export function addVoiceSample(orgId: string, kind: string, title: string, text: string, source: string) {
  return callRpc('ai_voice_sample_add', {
    p_org: orgId, p_kind: kind, p_title: title, p_text: text, p_source: source,
  });
}

/** Save a wording suggestion. It stays out of the record until a user accepts it (F8). */
export async function saveSuggestion(
  orgId: string, useCase: string, recordType: string, recordId: string,
  text: string, flagged: { token: string; context: string }[]
): Promise<{ ok: true; id: string } | { ok: false; reason: string }> {
  const sb = getClient();
  if (!sb) return { ok: false, reason: NOT_CONFIGURED };
  const { data, error } = await sb.rpc('ai_suggestion_save', {
    p_org: orgId, p_use_case: useCase, p_record_type: recordType, p_record_id: recordId,
    p_text: text, p_flagged: flagged,
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: String(data) };
}

export function decideSuggestion(id: string, status: 'accepted' | 'edited' | 'rejected', acceptedText?: string) {
  return callRpc('ai_suggestion_decide', { p_id: id, p_status: status, p_accepted_text: acceptedText ?? null });
}
