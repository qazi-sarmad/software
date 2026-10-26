-- 0092: seed the two missing Appendix A tutorial registry rows (WRITE-1, W12).
--
-- M1: grepped supabase/migrations and supabase/tests for `oa.connectors` and `oa.formats` — no
--     hits. Both keys exist in src/lib/tutorialKeys.json (79 keys) and both GIFs exist under
--     public/tutorials, and check-tutorials passes because it compares the JSON key list against the
--     GIF files. The registry is a different artefact: 0071 seeded 77 rows and 0081 rewrote the
--     steps of rows that already existed. Neither carries a row for these two keys, so on a fresh
--     deployment `tutorials` has 77 rows while the app offers 79 tutorial keys and 90_tutorial_steps
--     asserts only `count >= 77`. The rows appear locally only because e2e/global-setup.ts upserts
--     the JSON for the recorder. This migration seeds the two rows so a fresh database matches the
--     JSON exactly, and extends test 90 to assert the registry equals the JSON key list.
--
-- M2: insert ... on conflict (key) do nothing, so re-applying changes no row (same shape as 0071).
--     The real ordered steps are carried here rather than left to 0081: 0081 was generated from the
--     contract before these two keys existed and has no row for them, so it would never fill them.
--     `on conflict do nothing` means a recorder-generated row (generated_at is not null) is never
--     overwritten.
-- M3: tutorials keeps its shape; this only inserts rows.
-- M5: tutorials is platform-level and is reset by provio_test.seed()/reset_data(); a re-applying
--     test leaves no residue.

insert into tutorials (key, audience, title, steps, media_path)
values
  ('oa.connectors', 'org_admin', 'Connectors and monitoring',
   '[{"text":"Open OA-23 (connectors and monitoring).","testid":"org-control-panel"},{"text":"Select the Connectors tab.","testid":"org-control-tab-connectors"},{"text":"Read the connector catalogue and pick the connector to add.","testid":"wk-connectors-catalogue"},{"text":"Enter a label and the stored credential reference, then save the instance.","testid":"wk-connectors-save"},{"text":"Open the run history to see row counts and health.","testid":"wk-connectors-tab-runs"},{"text":"Open the staged-record browser and drill into a record.","testid":"wk-connectors-tab-staged"},{"text":"Open the alert queue and triage an alert.","testid":"wk-connectors-tab-alerts"}]'::jsonb,
   'tutorials/oa.connectors.gif'),
  ('oa.formats', 'org_admin', 'Report format editor',
   '[{"text":"Open OA-24 (report format editor).","testid":"org-control-panel"},{"text":"Select the Report formats tab.","testid":"org-control-tab-formats"},{"text":"Pick the report format to edit.","testid":"wk-format-format-pick"},{"text":"Choose the report model the format is built for.","testid":"wk-format-model-pick"},{"text":"Reorder a block with Up or Down, or hide it.","testid":"wk-format-block-cover-up"},{"text":"Give a block its own register.","testid":"wk-format-block-findings-register"},{"text":"Change the print layout and watch the preview update.","testid":"wk-format-layout-page-size"},{"text":"Save the draft, then publish the version.","testid":"wk-format-save"}]'::jsonb,
   'tutorials/oa.formats.gif')
on conflict (key) do nothing;
