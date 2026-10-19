/**
 * Feature → RPC map (F25 enforcement rule 5).
 *
 * Every RPC that belongs to a feature must be listed here with its feature key, so the guard test
 * featureMapCompleteness can prove the mapping is total: a new feature RPC that is not mapped fails
 * the build. This is the app-side mirror of the database's `has_feature` calls.
 */
export const FEATURE_RPC_MAP: Record<string, string> = {
  // board_pack / board_pack_pptx
  board_pack_generate: 'board_pack',
  board_pack_render_pdf: 'board_pack',
  board_pack_render_pptx: 'board_pack_pptx',
  board_pack_snapshot: 'board_pack',
  // certificates / public_verification
  certificate_issue: 'certificates',
  certificate_revoke: 'certificates',
  certificate_supersede: 'certificates',
  verify_certificate: 'public_verification',
  verify_board_pack: 'public_verification',
  // ai_assist / ai_voice_library / ai_board_slides
  ai_assist_suggest: 'ai_assist',
  ai_call_log: 'ai_assist',
  voice_profile_save: 'ai_voice_library',
  voice_term_save: 'ai_voice_library',
  voice_sample_add: 'ai_voice_library',
  ai_board_slides: 'ai_board_slides',
  // patterns
  pattern_clusters: 'patterns',
  pattern_settings_save: 'patterns',
  // time_travel
  engagement_as_of: 'time_travel',
  // escalation / automation_rules
  escalation_evaluate: 'escalation',
  escalation_ack: 'escalation',
  // S6 (F12): the escalation rule save and the Work Queue proposal conversion both gate on the
  // escalation feature.
  escalation_rule_save: 'escalation',
  work_queue_proposal_decide: 'escalation',
  automation_rule_save: 'automation_rules',
  automation_rule_test: 'automation_rules',
  // email adapters
  email_profile_save: 'email_resend',
  email_test_send: 'email_resend',
  email_dispatch_now: 'email_resend',
  // external_auditors
  ext_accept_invite: 'external_auditors',
  ext_list_engagements: 'external_auditors',
  ext_engagement_summary: 'external_auditors',
  // hosting_migration
  hosting_test_connection: 'hosting_migration',
  migration_start: 'hosting_migration',
  migration_resume: 'hosting_migration',
  migration_rollback: 'hosting_migration',
  // branding_custom_fonts / pptx_theme_upload
  branding_save: 'branding_custom_fonts',
  branding_font_upload: 'branding_custom_fonts',
  pptx_theme_extract: 'pptx_theme_upload',
  // S4: the real branding RPCs (0058).
  admin_set_branding: 'branding_custom_fonts',
  admin_upload_pptx_theme: 'pptx_theme_upload',
  // S5: the AI helper that gates on the feature named by its argument. It is the one function in
  // 0059 that calls has_feature directly; its callers inherit the gate. Mapped to ai_assist as the
  // base AI feature (D-S5-ai-featuremap).
  ai_require_org_actor: 'ai_assist',
  // consultation tiers
  consultation_request: 'consultation_config',
  consultation_propose: 'consultation_full_admin',
};

/**
 * The feature a given RPC belongs to, or null when the RPC is not feature-gated. The mapping is
 * exact: a name that differs only by prefix does not match, so an unmapped RPC is caught.
 */
export function featureForRpc(rpc: string): string | null {
  return FEATURE_RPC_MAP[rpc] ?? null;
}

/** The set of feature keys referenced by the map, for a coverage assertion. */
export function mappedFeatureKeys(): string[] {
  return [...new Set(Object.values(FEATURE_RPC_MAP))].sort();
}
