-- 0093: seed the report-builder tutorial registry row (WRITE-1, W12).
--
-- M1: grepped supabase/migrations and supabase/tests for `oa.report-builder` and `WK-11` - no hits.
--     The key exists in src/lib/tutorialKeys.json (80 keys) and 0092 seeded the two keys added after
--     0071. The report builder (WK-11) is a new screen added by this run, so its registry row is new.
-- M2: insert ... on conflict (key) do nothing, so re-applying changes no row (same shape as 0071 and
--     0092). A recorder-generated row (generated_at is not null) is never overwritten.
-- M3: tutorials keeps its shape; this only inserts a row.
-- M5: tutorials is platform-level and is reset by provio_test.seed()/reset_data(); a re-applying test
--     leaves no residue.

insert into tutorials (key, audience, title, steps, media_path)
values
  ('oa.report-builder', 'org_admin', 'Report builder',
   '[{"text":"Open WK-11 (report builder).","testid":"audit-file-view-builder"},{"text":"Choose the report model to compose.","testid":"wk-report-builder-model"},{"text":"Choose the formality level.","testid":"wk-report-builder-formality"},{"text":"Choose the tone level.","testid":"wk-report-builder-tone"},{"text":"Choose the voice.","testid":"wk-report-builder-voice"},{"text":"Read the first claim and open Why this sentence.","testid":"wk-report-builder-claim-c-scope-provenance"},{"text":"Open the coverage pane to see the reconciliation.","testid":"wk-report-builder-pane-coverage"},{"text":"Run the freeze and read every blocker it names.","testid":"wk-report-builder-freeze-run"}]'::jsonb,
   'tutorials/oa.report-builder.gif')
on conflict (key) do nothing;
