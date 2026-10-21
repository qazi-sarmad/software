# RPC authority review (C1.3)

Every `security definer` function executable by `authenticated`, as the database at migration 0073
reports it. The review question for each is the same: *can an Org B caller use it to read or write
an Org A object?*

Columns:

- **org** — how the organisation is derived. `jwt` = from the caller's JWT claim only;
  `p_org+guard` = the argument is checked against the caller's org by `provio_org_guard`;
  `object->guard` = the org is read from the row named by an id argument, then guarded;
  `platform` = platform administrator only; `scope` = an engagement or universe scope check;
  `n/a` = the function takes no organisation or object handle.
- **gate** — the right, feature or scope the function checks in addition to the org guard.
- **writes** — the tables the function inserts, updates or deletes.
- **cross-org test** — the SQL test that exercises the function.

The durable regression is `supabase/tests/82_rpc_authority.sql`: it calls each of the 29 functions
marked *fixed in 0073* as an Org B user with an Org A handle and asserts refusal, then proves no Org A
row was written and that the org's own member and a platform administrator are still served.

| function | org | gate | writes | cross-org test | C1.3 |
|---|---|---|---|---|---|
| `acknowledge_ethics` | jwt | jwt/scope | — | 29_deployment_gate.sql, 31_adversarial_phase3.sql | — |
| `acknowledge_planning_discrepancy` | jwt | jwt/scope | — | 33_planning.sql, 38_phase4_acceptance.sql | — |
| `add_plan_item` | jwt | jwt/scope | — | 28_audit_plan.sql, 29_deployment_gate.sql, 31_adversarial_phase3.sql | — |
| `add_report_comment` | jwt | jwt/scope | — | 46_report_comments.sql, 49_freeze_issuance.sql | — |
| `admin_assert_org` | jwt | right | — | NONE | — |
| `admin_create_role` | n/a | jwt/scope | — | 24_admin_rpcs.sql | — |
| `admin_delete_role` | n/a | jwt/scope | — | 24_admin_rpcs.sql | — |
| `admin_delete_sampling_row` | jwt | jwt/scope | — | 41_org_admin_settings.sql | — |
| `admin_delete_severity_level` | jwt | jwt/scope | — | 41_org_admin_settings.sql | — |
| `admin_grant_scope` | jwt | jwt/scope | — | 24_admin_rpcs.sql | — |
| `admin_log_change` | p_org+guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `admin_next_version` | p_org+guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `admin_provision_member` | jwt | jwt/scope | — | 24_admin_rpcs.sql | — |
| `admin_require_right` | n/a | right | — | NONE | — |
| `admin_revoke_scope` | jwt | jwt/scope | — | 24_admin_rpcs.sql | — |
| `admin_set_branding` | jwt | jwt/scope | — | 68_branding.sql | — |
| `admin_set_email_provider` | n/a | jwt/scope | — | 41_org_admin_settings.sql | — |
| `admin_set_engagement_gate` | n/a | jwt/scope | — | 29_deployment_gate.sql, 30_combined_approval.sql | — |
| `admin_set_entity_approval` | n/a | jwt/scope | — | 25_universes_entities.sql, 31_adversarial_phase3.sql | — |
| `admin_set_invite_cap` | n/a | jwt/scope | — | 24_admin_rpcs.sql | — |
| `admin_set_member_manager` | jwt | jwt/scope | — | 24_admin_rpcs.sql | — |
| `admin_set_member_role` | jwt | jwt/scope | — | 24_admin_rpcs.sql, 64_acp_control_plane.sql | — |
| `admin_set_org_setting` | n/a | jwt/scope | — | 24_admin_rpcs.sql | — |
| `admin_set_org_settings_extra` | n/a | jwt/scope | — | 64_acp_control_plane.sql, 69_ai.sql | — |
| `admin_set_plan_approval` | n/a | jwt/scope | — | 28_audit_plan.sql | — |
| `admin_set_sira_aggregation` | n/a | jwt/scope | — | 26_sira_model.sql | — |
| `admin_set_sira_band` | n/a | jwt/scope | — | 26_sira_model.sql | — |
| `admin_snapshot_sira_model` | jwt | jwt/scope | — | NONE | — |
| `admin_update_role_rights` | n/a | jwt/scope | — | 19_rights_closed.sql, 24_admin_rpcs.sql | — |
| `admin_upload_branding_asset` | jwt | jwt/scope | — | 68_branding.sql | — (app-facing) |
| `admin_upload_pptx_theme` | jwt | jwt/scope | — | NONE | — |
| `admin_upsert_sampling_row` | jwt | jwt/scope | — | 41_org_admin_settings.sql | — |
| `admin_upsert_severity_level` | jwt | jwt/scope | — | 41_org_admin_settings.sql | — |
| `admin_upsert_sira_factor` | n/a | jwt/scope | — | 26_sira_model.sql | — |
| `ai_call_log` | jwt | jwt/scope | — | 69_ai.sql, 74_feature_gates.sql | — |
| `ai_denylist_add` | n/a | jwt/scope | — | 69_ai.sql | — |
| `ai_denylist_remove` | jwt | jwt/scope | — | NONE | — |
| `ai_endpoint_denied` | n/a | jwt/scope | — | 69_ai.sql | — (app-facing) |
| `ai_gateway_authorise` | jwt | jwt/scope | — | 76_ai_gateway_authorise.sql | — |
| `ai_model_add` | n/a | jwt/scope | — | 69_ai.sql | — |
| `ai_model_remove` | jwt | jwt/scope | — | NONE | — |
| `ai_model_update` | jwt | jwt/scope | — | NONE | — |
| `ai_purge_expired` | n/a | jwt/scope | — | 69_ai.sql | — |
| `ai_require_org_actor` | jwt | right | — | NONE | — |
| `ai_set_endpoint` | jwt | jwt/scope | — | 69_ai.sql | — |
| `ai_suggestion_decide` | jwt | jwt/scope | — | 69_ai.sql | — |
| `ai_suggestion_save` | jwt | jwt/scope | — | 69_ai.sql | — (app-facing) |
| `ai_tenant_set_model` | jwt | jwt/scope | — | 69_ai.sql | — |
| `ai_use_case_save` | jwt | jwt/scope | — | 69_ai.sql | — |
| `ai_voice_profile_save` | jwt | jwt/scope | — | NONE | — |
| `ai_voice_sample_add` | jwt | jwt/scope | — | NONE | — |
| `ai_voice_term_add` | jwt | jwt/scope | — | NONE | — |
| `append_ledger_entry` | p_org+guard | jwt/scope | — | 09_ledger_chain.sql, 82_rpc_authority.sql | fixed in 0073 |
| `approve_plan` | jwt | jwt/scope | — | 00_lib.sql, 19_rights_closed.sql, 23_rights_rls.sql, 25_universes_entities.sql, 27_sira_cycles.sql, 28_audit_plan.sql, 29_deployment_gate.sql, 30_combined_approval.sql, 31_adversarial_phase3.sql, 49_freeze_issuance.sql, 55_phase6_acceptance.sql | — |
| `archive_activity_period` | jwt | jwt/scope | — | 52_activity_archival.sql, 56_phase7_acceptance.sql | — |
| `assert_engagement_writable` | jwt | right | — | NONE | — |
| `assign_team_role` | jwt | jwt/scope | — | 20_engagement_team.sql, 29_deployment_gate.sql, 31_adversarial_phase3.sql, 59_team_role_rights_blind.sql | — |
| `automation_rule_list` | p_org+guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `automation_rule_save` | jwt | jwt/scope | — | 66_secrets_email_automation.sql, 74_feature_gates.sql | — |
| `automation_rule_test` | jwt | jwt/scope | — | 66_secrets_email_automation.sql, 74_feature_gates.sql | — (app-facing) |
| `automation_rule_version_write` | p_org+guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `board_pack_generate` | jwt | jwt/scope | — | 71_board_pack.sql | — |
| `board_pack_get` | object->guard | jwt/scope | — | 71_board_pack.sql, 82_rpc_authority.sql | fixed in 0073 |
| `board_pack_list` | p_org+guard | jwt/scope | — | 71_board_pack.sql, 82_rpc_authority.sql | fixed in 0073 |
| `board_pack_sections_save` | jwt | jwt/scope | — | 71_board_pack.sql, 74_feature_gates.sql | — |
| `board_pack_sections_seed` | jwt | jwt/scope | — | 71_board_pack.sql | — (app-facing) |
| `board_pack_snapshot` | jwt | jwt/scope | — | 71_board_pack.sql, 74_feature_gates.sql | — |
| `caller_has_right` | n/a | jwt/scope | — | 19_rights_closed.sql | — |
| `can_read_all_scopes` | n/a | jwt/scope | — | 23_rights_rls.sql | — |
| `certificate_config_get` | jwt | jwt/scope | — | NONE | — (app-facing) |
| `certificate_config_save` | jwt | jwt/scope | — | 74_feature_gates.sql | — |
| `certificate_config_seed` | jwt | jwt/scope | — | 72_certificate.sql | — |
| `certificate_get` | jwt | jwt/scope | — | NONE | — (app-facing) |
| `certificate_issue` | jwt | jwt/scope | — | 72_certificate.sql | — |
| `certificate_list` | jwt | jwt/scope | — | 72_certificate.sql | — (app-facing) |
| `certificate_revoke` | jwt | jwt/scope | — | 72_certificate.sql, 74_feature_gates.sql | — |
| `check_cap_reconciliation` | jwt | jwt/scope | — | 47_cap_register.sql | — (app-facing) |
| `check_planning_reconciliation` | jwt | jwt/scope | — | 33_planning.sql, 63_planning_reconciliation_detail.sql | — (app-facing) |
| `check_readability` | jwt | jwt/scope | — | 39_findings_observations.sql | — |
| `close_cap` | jwt | jwt/scope | — | 47_cap_register.sql, 55_phase6_acceptance.sql | — |
| `commit_import` | jwt | jwt/scope | — | 51_imports.sql, 56_phase7_acceptance.sql | — (app-facing) |
| `compose_report` | jwt | jwt/scope | — | 45_report_drafting.sql, 46_report_comments.sql, 47_cap_register.sql, 49_freeze_issuance.sql, 55_phase6_acceptance.sql | — |
| `compute_report_summary` | jwt | jwt/scope | — | 45_report_drafting.sql | — (app-facing) |
| `compute_sample` | jwt | jwt/scope | — | 35_sampling_engine.sql, 38_phase4_acceptance.sql | — |
| `conclusion_chain` | n/a | jwt/scope | — | NONE | — |
| `config_actor_ok` | jwt | jwt/scope | — | NONE | — |
| `config_area_notify` | n/a | jwt/scope | — | NONE | — |
| `config_history_list` | n/a | jwt/scope | — | 65_config_history.sql | — (app-facing) |
| `config_write_mode` | jwt | jwt/scope | — | 64_acp_control_plane.sql | — |
| `confirm_prior_year_item` | jwt | jwt/scope | — | 53_prior_year_import.sql, 56_phase7_acceptance.sql | — (app-facing) |
| `consultation_acknowledge` | n/a | jwt/scope | — | 64_acp_control_plane.sql, 65_config_history.sql | — |
| `consultation_active` | p_org+guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `consultation_decide_proposal` | n/a | jwt/scope | — | 64_acp_control_plane.sql | — |
| `consultation_end` | n/a | jwt/scope | — | 64_acp_control_plane.sql, 65_config_history.sql | — |
| `consultation_propose` | n/a | jwt/scope | — | 64_acp_control_plane.sql | — |
| `consultation_request` | jwt | jwt/scope | — | 64_acp_control_plane.sql, 65_config_history.sql | — |
| `consultation_sweep` | n/a | jwt/scope | — | NONE | — |
| `create_issue` | jwt | jwt/scope | — | NONE | — |
| `create_observation` | jwt | jwt/scope | — | 39_findings_observations.sql, 54_phase5_acceptance.sql | — |
| `create_plan` | jwt | jwt/scope | — | 28_audit_plan.sql, 29_deployment_gate.sql, 31_adversarial_phase3.sql | — |
| `create_sira_cycle` | jwt | jwt/scope | — | 27_sira_cycles.sql | — |
| `custom_access_token_hook` | n/a | jwt/scope | — | 16_auth_hook.sql, 18_auth_hook_claims.sql, 75_external_auditors.sql | — |
| `cycle_summary` | jwt | jwt/scope | — | 27_sira_cycles.sql | — |
| `dblink_connect_u` | n/a | jwt/scope | — | NONE | — |
| `dblink_connect_u` | n/a | jwt/scope | — | NONE | — |
| `decide_adhoc_item` | n/a | jwt/scope | — | 28_audit_plan.sql | — |
| `decide_combined_deployment` | n/a | jwt/scope | — | 30_combined_approval.sql, 31_adversarial_phase3.sql | — |
| `decide_emergent_risk` | jwt | jwt/scope | — | 27_sira_cycles.sql | — |
| `decide_entity` | jwt | jwt/scope | — | 25_universes_entities.sql | — |
| `decide_planning_suggestion` | jwt | jwt/scope | — | NONE | — |
| `deploy_engagement` | jwt | jwt/scope | — | 29_deployment_gate.sql, 31_adversarial_phase3.sql | — (app-facing) |
| `deployment_request_status` | n/a | jwt/scope | — | 30_combined_approval.sql | — |
| `email_expire_stale` | n/a | jwt/scope | — | 73_email_dispatch.sql | — |
| `email_force_profile` | jwt | jwt/scope | — | 66_secrets_email_automation.sql | — |
| `email_profile_save` | jwt | jwt/scope | — | 66_secrets_email_automation.sql | — |
| `email_profile_test_result` | jwt | jwt/scope | — | 66_secrets_email_automation.sql | — |
| `email_resolve_profile` | p_org+guard | jwt/scope | — | 66_secrets_email_automation.sql, 82_rpc_authority.sql | fixed in 0073 |
| `email_sender_profiles_list` | p_org+guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `email_set_default_profile` | jwt | jwt/scope | — | 66_secrets_email_automation.sql | — |
| `emit_event` | p_org+guard | jwt/scope | — | 66_secrets_email_automation.sql, 70_escalation.sql, 74_feature_gates.sql, 82_rpc_authority.sql | fixed in 0073 |
| `engagement_as_of` | jwt | jwt/scope | — | 77_time_travel_patterns.sql, 79_time_travel_events_guard.sql | — (app-facing) |
| `engagement_as_of_events` | jwt | jwt/scope | — | 79_time_travel_events_guard.sql | — (app-facing) |
| `engagement_root_hash` | object->guard | jwt/scope | — | 72_certificate.sql, 82_rpc_authority.sql | fixed in 0073 |
| `entity_approval_config` | p_org+guard | jwt/scope | — | 25_universes_entities.sql, 82_rpc_authority.sql | fixed in 0073 |
| `entity_decision_granted` | jwt | jwt/scope | — | NONE | — |
| `entity_history` | jwt | jwt/scope | — | 25_universes_entities.sql | — (app-facing) |
| `escalate_overdue_deployment_requests` | n/a | jwt/scope | — | 30_combined_approval.sql, 31_adversarial_phase3.sql | — |
| `escalation_evaluate` | jwt | jwt/scope | — | 70_escalation.sql, 74_feature_gates.sql | — |
| `escalation_event_list` | jwt | jwt/scope | — | 70_escalation.sql | — (app-facing) |
| `escalation_rule_save` | jwt | jwt/scope | — | 70_escalation.sql | — |
| `ethics_status` | jwt | jwt/scope | — | 29_deployment_gate.sql | — (app-facing) |
| `export_activity_log` | jwt | jwt/scope | — | 50_exports.sql | — |
| `export_audit_plan` | jwt | jwt/scope | — | 50_exports.sql | — |
| `export_cap_register` | jwt | jwt/scope | — | 50_exports.sql | — |
| `export_engagement_bundle` | jwt | jwt/scope | — | 50_exports.sql | — |
| `export_full_tenant` | jwt | jwt/scope | — | 50_exports.sql, 56_phase7_acceptance.sql | — |
| `export_ledger` | jwt | jwt/scope | — | 50_exports.sql | — |
| `export_sira_results` | jwt | jwt/scope | — | 50_exports.sql | — |
| `export_workpaper` | jwt | jwt/scope | — | 50_exports.sql, 56_phase7_acceptance.sql | — |
| `ext_engagement_summary` | scope | external scope | — | 75_external_auditors.sql | — (app-facing) |
| `ext_latest_board_pack` | scope | external scope | — | NONE | — (app-facing) |
| `ext_latest_certificate` | scope | external scope | — | NONE | — (app-facing) |
| `ext_list_engagements` | scope | external scope | — | 75_external_auditors.sql | — (app-facing) |
| `ext_me` | scope | external scope | — | 75_external_auditors.sql | — (app-facing) |
| `ext_verify_certificate` | scope | external scope | — | NONE | — (app-facing) |
| `external_access_log_list` | scope | external scope | — | NONE | — (app-facing) |
| `external_actor_ok` | scope | external scope | — | 75_external_auditors.sql | — |
| `external_auditor_grants_save` | scope | external scope | — | NONE | — |
| `external_auditor_invite` | scope | external scope | — | 75_external_auditors.sql | — |
| `external_auditor_list` | scope | external scope | — | 75_external_auditors.sql | — (app-facing) |
| `external_auditor_revoke` | scope | external scope | — | 75_external_auditors.sql | — |
| `external_has_permission` | scope | external scope | — | NONE | — |
| `freeze_report` | jwt | jwt/scope | — | 49_freeze_issuance.sql, 55_phase6_acceptance.sql | — |
| `get_branding` | jwt | jwt/scope | — | 68_branding.sql | — (app-facing) |
| `get_org_settings_extra` | p_org+guard | jwt/scope | — | 64_acp_control_plane.sql, 82_rpc_authority.sql | fixed in 0073 |
| `get_sample_size` | jwt | jwt/scope | — | 35_sampling_engine.sql | — (app-facing) |
| `get_user_preference` | n/a | jwt/scope | — | 32_user_preferences.sql | — (app-facing) |
| `grant_support_access` | scope | jwt/scope | — | 40_platform_control_plane.sql, 57_phase8_acceptance.sql | — |
| `graph_app_save` | jwt | jwt/scope | — | 73_email_dispatch.sql | — |
| `graph_client_id` | n/a | jwt/scope | — | 73_email_dispatch.sql | — |
| `has_feature` | jwt | jwt/scope | — | 64_acp_control_plane.sql, 68_branding.sql, 74_feature_gates.sql | — |
| `has_scope` | jwt | jwt/scope | — | NONE | — |
| `hosting_connection_list` | jwt | jwt/scope | — | 78_hosting_fit_migration.sql | — (app-facing) |
| `hosting_connection_save` | jwt | jwt/scope | — | 78_hosting_fit_migration.sql | — (app-facing) |
| `hosting_connection_set_secret` | jwt | jwt/scope | — | 78_hosting_fit_migration.sql | — (app-facing) |
| `hosting_connection_test_result` | object->guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `hosting_fit_get` | n/a | jwt/scope | — | 78_hosting_fit_migration.sql | — (app-facing) |
| `hosting_fit_rule_save` | n/a | jwt/scope | — | 78_hosting_fit_migration.sql | — (app-facing) |
| `hosting_fit_seed` | n/a | jwt/scope | — | NONE | — |
| `import_prior_year_item` | jwt | jwt/scope | — | 53_prior_year_import.sql, 56_phase7_acceptance.sql | — (app-facing) |
| `invite_status` | jwt | jwt/scope | — | 67_invite_acceptance.sql | — (app-facing) |
| `invite_user_capped` | n/a | jwt/scope | — | 22_invite_cap.sql, 62_admin_invite_email.sql, 67_invite_acceptance.sql | — (app-facing) |
| `is_cia` | n/a | jwt/scope | — | 23_rights_rls.sql | — |
| `is_engagement_sealed` | object->guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `is_org_admin` | n/a | jwt/scope | — | 23_rights_rls.sql | — |
| `issue_report` | jwt | jwt/scope | — | 49_freeze_issuance.sql | — |
| `latest_published_sira_cycle` | jwt | jwt/scope | — | NONE | — |
| `link_finding` | jwt | jwt/scope | — | NONE | — |
| `list_feature_catalogue` | n/a | jwt/scope | — | NONE | — (app-facing) |
| `list_plans` | n/a | jwt/scope | — | NONE | — (app-facing) |
| `list_tenant_entitlements` | p_org+guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `list_tutorials` | n/a | jwt/scope | — | 64_acp_control_plane.sql, 80_tutorial_registry.sql | — (app-facing) |
| `lock_population` | jwt | jwt/scope | — | 34_population_gate.sql, 38_phase4_acceptance.sql | — |
| `lock_sample` | jwt | jwt/scope | — | 35_sampling_engine.sql | — |
| `log_export` | jwt | jwt/scope | — | 50_exports.sql, 56_phase7_acceptance.sql | — (app-facing) |
| `migration_job_advance` | jwt | jwt/scope | — | NONE | — |
| `migration_job_create` | jwt | jwt/scope | — | 78_hosting_fit_migration.sql | — (app-facing) |
| `migration_job_list` | jwt | jwt/scope | — | 78_hosting_fit_migration.sql | — (app-facing) |
| `migration_step_upsert` | jwt | jwt/scope | — | NONE | — |
| `missing_readability_sections` | jwt | jwt/scope | — | 39_findings_observations.sql | — (app-facing) |
| `notification_template_list` | p_org+guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `notification_template_save` | jwt | jwt/scope | — | NONE | — |
| `open_report_comment_count` | jwt | jwt/scope | — | 46_report_comments.sql, 49_freeze_issuance.sql | — (app-facing) |
| `org_required_sections` | p_org+guard | right | — | 82_rpc_authority.sql | fixed in 0073 |
| `org_settings_extra_get` | jwt | jwt/scope | — | NONE | — (app-facing) |
| `org_settings_extra_save` | jwt | jwt/scope | — | NONE | — |
| `orgs_seed_engagement_gate` | n/a | jwt/scope | — | NONE | — |
| `orgs_seed_invite_cap` | n/a | jwt/scope | — | NONE | — |
| `orgs_seed_plan_approval` | n/a | jwt/scope | — | NONE | — |
| `orgs_seed_sira_model` | n/a | jwt/scope | — | NONE | — |
| `pattern_findings` | jwt | jwt/scope | — | 77_time_travel_patterns.sql | — (app-facing) |
| `pattern_settings_get` | jwt | jwt/scope | — | 77_time_travel_patterns.sql | — (app-facing) |
| `pattern_settings_save` | jwt | jwt/scope | — | 77_time_travel_patterns.sql | — (app-facing) |
| `pattern_settings_seed` | jwt | jwt/scope | — | NONE | — |
| `plan_approval_config` | p_org+guard | jwt/scope | — | 28_audit_plan.sql, 82_rpc_authority.sql | fixed in 0073 |
| `plan_history` | jwt | jwt/scope | — | 28_audit_plan.sql | — (app-facing) |
| `planning_reconciliation_detail` | jwt | jwt/scope | — | 63_planning_reconciliation_detail.sql | — (app-facing) |
| `planning_signed_off` | jwt | jwt/scope | — | 33_planning.sql, 38_phase4_acceptance.sql, 53_prior_year_import.sql | — (app-facing) |
| `platform_add_recipient` | platform | platform admin | — | 64_acp_control_plane.sql | — |
| `platform_enable_ai` | platform | platform admin | — | 40_platform_control_plane.sql, 57_phase8_acceptance.sql, 60_platform_admin_blind.sql, 69_ai.sql | — |
| `platform_get_invite_caps` | platform | platform admin | — | 42_platform_read_apis.sql | — (app-facing) |
| `platform_grant_support_access` | platform | platform admin | — | 40_platform_control_plane.sql, 57_phase8_acceptance.sql, 60_platform_admin_blind.sql | — |
| `platform_list_recipients` | platform | platform admin | — | 64_acp_control_plane.sql | — (app-facing) |
| `platform_list_support_grants` | platform | platform admin | — | 42_platform_read_apis.sql | — (app-facing) |
| `platform_list_tenants` | platform | platform admin | — | 42_platform_read_apis.sql | — (app-facing) |
| `platform_list_trail` | platform | platform admin | — | 42_platform_read_apis.sql | — (app-facing) |
| `platform_remove_recipient` | platform | platform admin | — | NONE | — |
| `platform_revoke_support_access` | platform | platform admin | — | 40_platform_control_plane.sql, 60_platform_admin_blind.sql | — |
| `platform_set_entitlement` | platform | platform admin | — | 64_acp_control_plane.sql, 69_ai.sql, 70_escalation.sql, 71_board_pack.sql, 72_certificate.sql, 74_feature_gates.sql, 75_external_auditors.sql, 76_ai_gateway_authorise.sql, 77_time_travel_patterns.sql, 78_hosting_fit_migration.sql, 79_time_travel_events_guard.sql | — |
| `platform_set_feature_flag` | platform | platform admin | — | 40_platform_control_plane.sql, 57_phase8_acceptance.sql, 60_platform_admin_blind.sql | — |
| `platform_set_invite_cap` | platform | platform admin | — | 40_platform_control_plane.sql, 42_platform_read_apis.sql, 57_phase8_acceptance.sql, 60_platform_admin_blind.sql | — |
| `platform_set_tenant_status` | platform | platform admin | — | 40_platform_control_plane.sql | — |
| `platform_whoami` | platform | platform admin | — | 42_platform_read_apis.sql | — (app-facing) |
| `populate_planning_suggestions` | jwt | jwt/scope | — | 33_planning.sql, 38_phase4_acceptance.sql | — (app-facing) |
| `promote_to_finding` | jwt | jwt/scope | — | 39_findings_observations.sql, 54_phase5_acceptance.sql | — |
| `provio_org_guard` | jwt | jwt/scope | — | 82_rpc_authority.sql | — |
| `publish_sira_cycle` | jwt | jwt/scope | — | 27_sira_cycles.sql, 33_planning.sql, 38_phase4_acceptance.sql, 63_planning_reconciliation_detail.sql | — |
| `pull_exceptions` | jwt | jwt/scope | — | 43_conclusion.sql, 45_report_drafting.sql, 46_report_comments.sql, 47_cap_register.sql, 49_freeze_issuance.sql, 54_phase5_acceptance.sql | — |
| `queue_email` | p_org+guard | jwt/scope | — | 48_email_queue.sql, 55_phase6_acceptance.sql, 73_email_dispatch.sql, 82_rpc_authority.sql | fixed in 0073 |
| `raise_finding_from_result` | jwt | jwt/scope | — | NONE | — |
| `record_analysis_result` | jwt | jwt/scope | — | 37_analyst_engine.sql, 38_phase4_acceptance.sql | — |
| `record_sira_score` | jwt | jwt/scope | — | 27_sira_cycles.sql, 31_adversarial_phase3.sql | — |
| `record_tutorial_view` | n/a | jwt/scope | — | 64_acp_control_plane.sql | — |
| `record_workpaper_row` | jwt | jwt/scope | — | 36_row_testing.sql, 77_time_travel_patterns.sql, 79_time_travel_events_guard.sql | — |
| `remove_conclusion_exception` | jwt | jwt/scope | — | 43_conclusion.sql | — |
| `render_notification` | p_org+guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `reopen_engagement` | jwt | jwt/scope | — | 12_sealed_engagement.sql, 14_reopen.sql, 72_certificate.sql | — |
| `reopen_granted` | object->guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `reopen_workpaper` | jwt | jwt/scope | — | 36_row_testing.sql | — |
| `replace_locked_population` | jwt | jwt/scope | — | 34_population_gate.sql | — |
| `replace_sample` | jwt | jwt/scope | — | 35_sampling_engine.sql | — |
| `report_version_chain` | n/a | jwt/scope | — | NONE | — |
| `request_combined_deployment` | jwt | jwt/scope | — | 30_combined_approval.sql, 31_adversarial_phase3.sql | — |
| `request_extraction` | jwt | jwt/scope | — | 44_document_viewer.sql | — |
| `require_config_actor` | jwt | right | — | NONE | — |
| `resolve_report_comment` | jwt | jwt/scope | — | 46_report_comments.sql, 49_freeze_issuance.sql | — |
| `revert_prior_year_item` | jwt | jwt/scope | — | NONE | — (app-facing) |
| `revoke_support_access` | scope | jwt/scope | — | 57_phase8_acceptance.sql | — |
| `rls_auto_enable` | n/a | jwt/scope | — | NONE | — |
| `roles_config_log` | n/a | jwt/scope | — | NONE | — |
| `rule_loop_guard` | object->guard | jwt/scope | — | 66_secrets_email_automation.sql, 82_rpc_authority.sql | fixed in 0073 |
| `rule_recipients` | p_org+guard | jwt/scope | — | 82_rpc_authority.sql | fixed in 0073 |
| `save_planning_section` | jwt | jwt/scope | — | 33_planning.sql, 38_phase4_acceptance.sql, 53_prior_year_import.sql, 56_phase7_acceptance.sql, 63_planning_reconciliation_detail.sql | — |
| `search_documents` | jwt | jwt/scope | — | 44_document_viewer.sql, 54_phase5_acceptance.sql | — (app-facing) |
| `secret_display` | object->guard | jwt/scope | — | 66_secrets_email_automation.sql, 82_rpc_authority.sql | fixed in 0073 |
| `seed_engagement_gate_settings` | jwt | jwt/scope | — | NONE | — |
| `seed_org_sampling_table` | jwt | jwt/scope | — | 35_sampling_engine.sql | — |
| `seed_plan_approval_settings` | jwt | jwt/scope | — | NONE | — |
| `seed_severity_levels` | jwt | jwt/scope | — | NONE | — |
| `seed_sira_model` | jwt | jwt/scope | — | NONE | — |
| `select_sira_risk` | jwt | jwt/scope | — | 26_sira_model.sql | — |
| `set_user_preference` | n/a | jwt/scope | — | 32_user_preferences.sql | — |
| `setup_list` | jwt | jwt/scope | — | 64_acp_control_plane.sql | — (app-facing) |
| `setup_save_step` | jwt | jwt/scope | — | 64_acp_control_plane.sql | — |
| `sign_conclusion` | jwt | jwt/scope | — | 43_conclusion.sql, 45_report_drafting.sql, 46_report_comments.sql, 47_cap_register.sql, 49_freeze_issuance.sql, 54_phase5_acceptance.sql | — |
| `sign_off_workpaper` | jwt | jwt/scope | — | 36_row_testing.sql, 38_phase4_acceptance.sql, 77_time_travel_patterns.sql, 79_time_travel_events_guard.sql | — |
| `sign_planning` | jwt | jwt/scope | — | 33_planning.sql, 38_phase4_acceptance.sql, 53_prior_year_import.sql, 56_phase7_acceptance.sql | — |
| `sira_band_for` | p_org+guard | jwt/scope | — | 26_sira_model.sql, 82_rpc_authority.sql | fixed in 0073 |
| `sira_model_snapshot` | p_org+guard | jwt/scope | — | 26_sira_model.sql, 82_rpc_authority.sql | fixed in 0073 |
| `snapshot_plan_version` | jwt | jwt/scope | — | NONE | — |
| `start_import` | n/a | jwt/scope | — | 51_imports.sql, 56_phase7_acceptance.sql | — (app-facing) |
| `submit_emergent_risk` | jwt | jwt/scope | — | 27_sira_cycles.sql | — |
| `submit_entity` | jwt | jwt/scope | — | 25_universes_entities.sql, 31_adversarial_phase3.sql | — |
| `supersede_certificates_on_reopen` | n/a | jwt/scope | — | NONE | — |
| `testing_signed_off` | jwt | jwt/scope | — | 43_conclusion.sql | — (app-facing) |
| `unconfirmed_prior_year_imports` | jwt | jwt/scope | — | 53_prior_year_import.sql, 56_phase7_acceptance.sql | — (app-facing) |
| `update_cap` | jwt | jwt/scope | — | 47_cap_register.sql | — |
| `update_plan_item_dates` | n/a | jwt/scope | — | 61_plan_item_dates.sql | — |
| `validate_import` | jwt | jwt/scope | — | 51_imports.sql, 56_phase7_acceptance.sql | — (app-facing) |
| `verify_board_pack` | jwt | jwt/scope | — | 72_certificate.sql | — (app-facing) |
| `verify_certificate` | jwt | jwt/scope | — | 72_certificate.sql, 74_feature_gates.sql | — (app-facing) |
| `verify_ledger` | p_org+guard | jwt/scope | — | 09_ledger_chain.sql, 10_ledger_tamper.sql, 15_ledger_concurrency.sql, 25_universes_entities.sql, 31_adversarial_phase3.sql, 38_phase4_acceptance.sql, 82_rpc_authority.sql | fixed in 0073 |
| `verify_rate_ok` | jwt | jwt/scope | — | NONE | — |
| `work_queue_proposal_decide` | jwt | jwt/scope | — | 70_escalation.sql | — |
| `work_queue_proposal_list` | jwt | jwt/scope | — | 70_escalation.sql | — (app-facing) |

## Result

- 285 security-definer functions are executable by `authenticated`; 92 take an organisation argument
  and 150 take an object handle.
- 29 leaked another tenant's organisation or object handle and are patched in
  `supabase/migrations/0073_rpc_authority.sql`. They were found in two passes: a hand-written probe of
  the app-facing readers, then a mechanical probe of all 254 functions that take an argument (which
  found six the first pass had missed). Both passes are recorded in `docs/COMPLETION-DECISIONS.md`.
- Every function in the table now derives its organisation from the caller, from a guarded argument,
  or from the guarded row named by an id argument. No function trusts a body-supplied org.
- The anon surface is unchanged: `verify_certificate` and `verify_board_pack` only, enforced by guard
  `anonGrantAllowList`. `secret_reveal`, `graph_client_secret`, `email_dispatch_token` and
  `secret_vault_store` remain `service_role` only.
- `provio_org_guard` returns early when `request.jwt.claims` is unset, so internal callers (triggers,
  other definer functions, migrations and the test harness) are unaffected; a PostgREST request always
  carries the claim. That is D-C1.3-c.
