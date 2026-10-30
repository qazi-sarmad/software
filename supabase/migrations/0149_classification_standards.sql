-- 0149 (S3): D10 — client classification, the configurable framework/standard library, and the
-- derived risk library that feeds SIRA.
--
-- Owner instruction 2026-10-30: "make these libraries and standards configurable and wired to be
-- updatable for all orgs separately or together. The risks should also be derived from these
-- frameworks for relevant audits into SIRA."
--
-- What this migration adds:
--   1. org_classification            — the C1–C8 classification of a tenant, versioned and reason-stamped.
--   2. classification_obligations    — the obligations a classification creates, each citing its clause.
--   3. standards_library             — the frameworks/standards (COSO ICIF-2013, COBIT 2019, AAOIFI
--                                      SS 1–54 …) as DATA, each row scoped to one org or to the
--                                      platform (`org_id is null` = shipped default). Configurable.
--   4. standards_library_versions    — an append-only version per library row (L3/L5).
--   5. risk_derivations              — the risk a framework control requirement derives, per discipline.
--   6. `standards_update_scope`      — update the library for ONE org or ALL orgs in one action, one
--                                      version per affected org, one ledger entry per org (L2/L3).
--   7. `risk_library_derive`         — materialise a framework's derived risks into `risks_library`
--                                      for the disciplines the org's classification offers.
--
-- The auto-compute normalisation (factors + formula staying at 100) lives in migration 0150.
--
-- Laws honoured: L1 (no model; every derivation is a rule over configured data), L2 (an org reads only
-- its own rows — RLS + jwt_org_id(); a platform row is visible to all but writable only by the platform
-- admin), L3 (config is an append-only, versioned ledger; a derivation is idempotent, never a
-- duplicate), L5 (every change is reason-stamped and logged).
--
-- M1: grepped migrations and tests for every new name; all new, none redefined. `risks_library` is
-- ALTERed (0003), never recreated. M2: create table if not exists / add column if not exists.
-- M6: applied twice and every SQL test runs twice by the harness before the push.

-- ---------------------------------------------------------------------------
-- 1. The organisation's classification (D10). One row per org, versioned.
-- ---------------------------------------------------------------------------
create table if not exists org_classification (
  org_id uuid primary key references orgs(id) on delete cascade,
  classification text not null,
  is_islamic boolean not null default false,
  has_it_scope boolean not null default false,
  -- The derived switch set (docs/PAKISTAN-ASSURANCE-REGIMES.md §3), stored so a reader never re-derives.
  internal_audit_mandatory boolean not null default false,
  internal_audit_conditional boolean not null default false,
  icfr_mandatory boolean not null default false,
  icfr_rigour text not null default 'none',
  frameworks jsonb not null default '[]'::jsonb,
  artifacts jsonb not null default '[]'::jsonb,
  regulator_numbering text not null default '',
  offered_disciplines jsonb not null default '["management"]'::jsonb,
  version int not null default 1,
  set_by uuid null,
  set_at timestamptz not null default now()
);
alter table org_classification enable row level security;
drop policy if exists org_classification_select on org_classification;
create policy org_classification_select on org_classification for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists org_classification_pin_org on org_classification;
create trigger org_classification_pin_org before insert on org_classification
  for each row execute function public.pin_org_id();
-- No insert/update/delete policy: writes go through classification_set() only.

create table if not exists classification_obligations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  obligation_id text not null,
  source_clause text not null,
  subject text not null default '',
  created_at timestamptz not null default now(),
  unique (org_id, obligation_id)
);
alter table classification_obligations enable row level security;
drop policy if exists classification_obligations_select on classification_obligations;
create policy classification_obligations_select on classification_obligations for select to authenticated
  using (org_id = public.jwt_org_id() or public.is_platform_admin());
drop trigger if exists classification_obligations_pin_org on classification_obligations;
create trigger classification_obligations_pin_org before insert on classification_obligations
  for each row execute function public.pin_org_id();

-- ---------------------------------------------------------------------------
-- 2. The standards / frameworks library — configurable data, per org or platform-wide.
--    A row with org_id NULL is the platform-shipped default every org reads; a row with an org_id
--    overrides the default for that org only (the org's own copy). This is the switch that lets one
--    tenant diverge without changing the others.
-- ---------------------------------------------------------------------------
create table if not exists standards_library (
  id uuid primary key default gen_random_uuid(),
  -- NULL = the platform default; non-null = the org's own configuration of the same key.
  -- Deliberately NOT a foreign key to orgs (the 0191 standards_packs precedent): a platform
  -- catalogue must survive `truncate orgs cascade` in the test harness, and the platform default rows
  -- (org_id null) are shared by every org. RLS still confines a reader to its own org or the default.
  org_id uuid null,
  key text not null,
  discipline text not null default 'cross',
  kind text not null default 'framework',
  label text not null,
  citation text not null default '',
  source text not null default '',
  version int not null default 1,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- A key is unique per scope: one platform default, one override per org.
create unique index if not exists standards_library_scope_key_idx
  on standards_library (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create index if not exists standards_library_discipline_idx on standards_library (discipline);

alter table standards_library enable row level security;
drop policy if exists standards_library_select on standards_library;
create policy standards_library_select on standards_library for select to authenticated
  using (org_id is null or org_id = public.jwt_org_id() or public.is_platform_admin());
-- No write policy: writes go through standards_upsert() / standards_update_scope() only.

create table if not exists standards_library_versions (
  id uuid primary key default gen_random_uuid(),
  -- Not an FK to orgs, for the same reason as standards_library above.
  org_id uuid null,
  key text not null,
  version int not null,
  snapshot jsonb not null default '{}'::jsonb,
  actor_id uuid null,
  created_at timestamptz not null default now()
);
alter table standards_library_versions enable row level security;
drop policy if exists standards_library_versions_select on standards_library_versions;
create policy standards_library_versions_select on standards_library_versions for select to authenticated
  using (org_id is null or org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 3. The derived risks. Each framework control requirement derives a risk per discipline; this table
--    is the mapping the derivation reads. Seeded from the verified sources only.
-- ---------------------------------------------------------------------------
create table if not exists risk_derivations (
  id uuid primary key default gen_random_uuid(),
  -- Not an FK to orgs: the platform derivation set (org_id null) is shared and must survive the
  -- harness reset, exactly as standards_library does.
  org_id uuid null,
  standards_key text not null,
  discipline text not null,
  code text not null,
  name text not null,
  risk_type text not null default 'control',
  source text not null default '',
  is_emerging boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, standards_key, code)
);
create index if not exists risk_derivations_scope_idx on risk_derivations (standards_key, discipline);

alter table risk_derivations enable row level security;
drop policy if exists risk_derivations_select on risk_derivations;
create policy risk_derivations_select on risk_derivations for select to authenticated
  using (org_id is null or org_id = public.jwt_org_id() or public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- 4. risks_library gains the discipline/derivation columns the D14 library model names
--    (docs/RISK-ASSESSMENT-MODEL.md §4). ALTERs the existing table; never a second table.
-- ---------------------------------------------------------------------------
alter table risks_library add column if not exists code text null;
alter table risks_library add column if not exists category text null;
alter table risks_library add column if not exists discipline text null;
alter table risks_library add column if not exists source text null;
alter table risks_library add column if not exists risk_type text null;
alter table risks_library add column if not exists is_emerging boolean not null default false;
alter table risks_library add column if not exists is_universal boolean not null default false;
alter table risks_library add column if not exists derived_from text null;
-- One library row per (org, code): the derivation is idempotent on this key.
create unique index if not exists risks_library_org_code_idx
  on risks_library (org_id, code) where code is not null;

-- ---------------------------------------------------------------------------
-- 5. Seed the platform standards library (org_id NULL = shipped default for every org).
--    The citations are the verified ones from docs/ASSURANCE-RULEBOOKS.md and the domain model.
-- ---------------------------------------------------------------------------
insert into standards_library (org_id, key, discipline, kind, label, citation, source) values
  (null, 'coso.icif.2013', 'management', 'framework', 'COSO Internal Control — Integrated Framework (2013)',
   'COSO ICIF-2013: five components, 17 principles; a 2023 supplement extends it to internal control over sustainability reporting', 'docs/ASSURANCE-RULEBOOKS.md §1'),
  (null, 'pcaob.as.2201', 'management', 'framework', 'PCAOB AS 2201 — An Audit of Internal Control Over Financial Reporting',
   'PCAOB AS 2201, integrated with the financial-statement audit; statutory driver Sarbanes–Oxley Act 2002 §404', 'docs/ASSURANCE-RULEBOOKS.md §1'),
  (null, 'iia.2024', 'management', 'framework', 'IIA Global Internal Audit Standards (2024)',
   'IIA Global Internal Audit Standards (2024), condensed text', 'docs/iia-standards-reference.md'),
  (null, 'cobit.2019', 'it', 'framework', 'COBIT 2019 — governance and management objectives for enterprise IT',
   'COBIT 2019 (ISACA): governance and management objectives for enterprise IT', 'docs/ASSURANCE-RULEBOOKS.md §1'),
  (null, 'iso.27001.2022', 'it', 'framework', 'ISO/IEC 27001:2022 Annex A',
   'ISO/IEC 27001:2022, third edition October 2022; Annex A holds 93 information-security controls in four themes (organizational, people, physical, technological); the Statement of Applicability (SoA) is the artifact', 'docs/ASSURANCE-RULEBOOKS.md §1'),
  (null, 'nist.sp.800-53.r5', 'it', 'framework', 'NIST SP 800-53 Rev. 5 — Security and Privacy Controls',
   'NIST SP 800-53 Rev. 5, 2020-09-23; low/moderate/high baselines; SP 800-53A supplies the assessment procedures', 'docs/ASSURANCE-RULEBOOKS.md §1'),
  (null, 'aaoifi.ss', 'shariah', 'framework', 'AAOIFI Shari''ah Standards, SS 1–54',
   'AAOIFI Shari''ah Standards, English edition 2015, 54 standards; cite SS (n) with the standard''s title', 'docs/ASSURANCE-RULEBOOKS.md §5'),
  (null, 'sbp.compendium.2024', 'shariah', 'framework', 'SBP Shari''ah Compendium (31 Oct 2024)',
   'SBP Shari''ah Compendium, verified 31 Oct 2024 — the Pakistan amendment overlay on the adopted AAOIFI standards', 'docs/AUDIT-DOMAINS-MODEL.md §3'),
  (null, 'sbp.sgf.2025', 'shariah', 'framework', 'SBP Shari''ah Governance Framework (effective 1 Jan 2025)',
   'SBP Shari''ah Governance Framework, effective 1 Jan 2025 — the governance spine; §7 Internal Shariah Audit, §8 External Shariah Audit', 'docs/SHARIAH GOVERNANCE FRAMEWORK.pdf')
on conflict do nothing;

-- The platform derivation set: each framework control requirement derives a risk, per discipline.
-- Only the framework families the sources name are seeded; nothing is invented.
insert into risk_derivations (org_id, standards_key, discipline, code, name, risk_type, source) values
  (null, 'coso.icif.2013', 'management', 'R-COSO-01', 'Control environment is not tone-at-the-top evidenced', 'control', 'COSO ICIF-2013 component: Control Environment'),
  (null, 'coso.icif.2013', 'management', 'R-COSO-02', 'Risk assessment is not refreshed for change', 'control', 'COSO ICIF-2013 component: Risk Assessment'),
  (null, 'coso.icif.2013', 'management', 'R-COSO-03', 'Control activities do not address a stated risk', 'control', 'COSO ICIF-2013 component: Control Activities'),
  (null, 'coso.icif.2013', 'management', 'R-COSO-04', 'Information and communication fail to reach the decision-maker', 'control', 'COSO ICIF-2013 component: Information and Communication'),
  (null, 'coso.icif.2013', 'management', 'R-COSO-05', 'Monitoring activities do not detect a control failure', 'control', 'COSO ICIF-2013 component: Monitoring Activities'),
  (null, 'pcaob.as.2201', 'management', 'R-AS2201-01', 'A material misstatement risk is not covered by a tested control', 'financial', 'PCAOB AS 2201 assertion mapping: existence/occurrence, completeness, accuracy/valuation, cutoff, classification, presentation'),
  (null, 'cobit.2019', 'it', 'R-COBIT-01', 'IT governance objective has no owner', 'technology', 'COBIT 2019 governance and management objectives'),
  (null, 'iso.27001.2022', 'it', 'R-ISO-01', 'An Annex A control is not implemented or not in the SoA', 'technology', 'ISO/IEC 27001:2022 Annex A (93 controls, four themes); the SoA is the artifact'),
  (null, 'nist.sp.800-53.r5', 'it', 'R-NIST-01', 'A control family in the applicable baseline is not assessed', 'technology', 'NIST SP 800-53 Rev. 5 baselines; SP 800-53A assessment procedures'),
  (null, 'aaoifi.ss', 'shariah', 'R-SS-01', 'A transaction engages riba', 'shari''ah', 'AAOIFI SS 1/3/19 — prohibition of riba'),
  (null, 'aaoifi.ss', 'shariah', 'R-SS-02', 'A contract carries gharar beyond tolerance', 'shari''ah', 'AAOIFI SS 31 — controls on gharar'),
  (null, 'aaoifi.ss', 'shariah', 'R-SS-03', 'Maysir or a prohibited object is present', 'shari''ah', 'AAOIFI SS 18 — maysir / prohibited object'),
  (null, 'aaoifi.ss', 'shariah', 'R-SS-04', 'The sequence of contract and ownership is not observed', 'shari''ah', 'AAOIFI SS 8 — possession (qabd)'),
  (null, 'aaoifi.ss', 'shariah', 'R-SS-05', 'Profit-and-loss distribution is not Shari''ah-compliant', 'shari''ah', 'AAOIFI SS 12/13/40 — profit distribution integrity'),
  (null, 'aaoifi.ss', 'shariah', 'R-SS-06', 'Zakah is not computed or distributed correctly', 'shari''ah', 'AAOIFI SS 35 — zakah'),
  (null, 'sbp.sgf.2025', 'shariah', 'R-SGF-01', 'The Shari''ah governance framework is not observed (SSB, ISAU)', 'shari''ah', 'SBP Shari''ah Governance Framework, effective 1 Jan 2025 — §7 Internal Shariah Audit')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 6. classification_set: record a tenant's classification and materialise its obligations.
--    Requires edit_config. Versioned (config_versions) and logged.
-- ---------------------------------------------------------------------------
create or replace function public.classification_set(
  p_org uuid, p_classification text, p_is_islamic boolean default false, p_has_it_scope boolean default false
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
  v_version int;
  v_frameworks jsonb;
  v_artifacts jsonb;
  v_offered jsonb;
  v_mandatory boolean;
  v_conditional boolean;
  v_icfr boolean;
  v_rigour text;
  v_numbering text;
  v_obligations jsonb;
  v_row jsonb;
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not public.caller_has_right('edit_config') then
    raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
  end if;
  if p_classification not in ('C1','C2','C3','C4','C5','C6','C7','C8') then
    raise exception 'classification % is not one the matrix names', p_classification using errcode = 'P0001';
  end if;

  -- The switch set, exactly as docs/PAKISTAN-ASSURANCE-REGIMES.md §2 defines it.
  case p_classification
    when 'C1' then v_mandatory := true;  v_conditional := false; v_rigour := 'statement';
      v_frameworks := '["COSO ICIF-2013"]'; v_artifacts := '["directors'' statement on the adequacy of internal financial controls"]';
      v_numbering := 'SECP / Companies Act 2017 s.227 / COCG 2019';
    when 'C2' then v_mandatory := false; v_conditional := false; v_rigour := 'statement';
      v_frameworks := '["COSO ICIF-2013"]'; v_artifacts := '["board comment on the adequacy of internal financial controls"]';
      v_numbering := 'SECP / Companies Act 2017';
    when 'C3' then v_mandatory := false; v_conditional := false; v_rigour := 'basic';
      v_frameworks := '[]'; v_artifacts := '["statutory audit under ss.223/226"]';
      v_numbering := 'SECP / Companies Act 2017 ss.223/226';
    when 'C4' then v_mandatory := false; v_conditional := false; v_rigour := 'none';
      v_frameworks := '[]'; v_artifacts := '[]'; v_numbering := 'SECP / Companies Act 2017';
    when 'C5' then v_mandatory := false; v_conditional := false; v_rigour := 'none';
      v_frameworks := '[]'; v_artifacts := '[]'; v_numbering := 'SECP / Companies Act 2017';
    when 'C6' then v_mandatory := true;  v_conditional := false; v_rigour := 'highest';
      v_frameworks := '["COSO ICIF-2013","SBP ICFR Roadmap"]';
      v_artifacts := '["annual management assessment","board endorsement","Long Form Report (LFR) by the external auditor"]';
      v_numbering := 'SBP BSD Circular No. 7 of 2004; BSD Circular No. 5 of 2009';
    when 'C7' then v_mandatory := true;  v_conditional := false; v_rigour := 'full';
      v_frameworks := '["COSO ERM","ISO 31000","COBIT"]';
      v_artifacts := '["directors'' statement","LFR","ICFR annual assessment","SoA","board report"]';
      v_numbering := 'SOE Regulations 2024 (Finance Division) / AGP';
    when 'C8' then v_mandatory := false; v_conditional := true;  v_rigour := 'statement';
      v_frameworks := '["COSO ICIF-2013"]'; v_artifacts := '["AML internal financial controls"]';
      v_numbering := 'SECP / Companies Act 2017 s.42';
  end case;
  v_icfr := v_rigour in ('statement','full','highest');

  -- Offered disciplines (docs/AUDIT-DOMAINS-MODEL.md §4): never hard-code exactly three.
  v_offered := '["management"]'::jsonb;
  if p_has_it_scope then v_offered := v_offered || '["it"]'::jsonb; end if;
  if p_classification in ('C6','C7') or p_is_islamic then v_offered := v_offered || '["shariah"]'::jsonb; end if;

  insert into org_classification (org_id, classification, is_islamic, has_it_scope,
      internal_audit_mandatory, internal_audit_conditional, icfr_mandatory, icfr_rigour,
      frameworks, artifacts, regulator_numbering, offered_disciplines, version, set_by, set_at)
  values (v_org, p_classification, p_is_islamic, p_has_it_scope,
      v_mandatory, v_conditional, v_icfr, v_rigour, v_frameworks, v_artifacts, v_numbering,
      v_offered, 1, auth.uid(), now())
  on conflict (org_id) do update set
      classification = excluded.classification, is_islamic = excluded.is_islamic,
      has_it_scope = excluded.has_it_scope, internal_audit_mandatory = excluded.internal_audit_mandatory,
      internal_audit_conditional = excluded.internal_audit_conditional,
      icfr_mandatory = excluded.icfr_mandatory, icfr_rigour = excluded.icfr_rigour,
      frameworks = excluded.frameworks, artifacts = excluded.artifacts,
      regulator_numbering = excluded.regulator_numbering, offered_disciplines = excluded.offered_disciplines,
      version = org_classification.version + 1, set_by = auth.uid(), set_at = now()
  returning version into v_version;

  -- Materialise the obligations. Each names its clause; the source is the matrix.
  delete from classification_obligations where org_id = v_org;
  for v_row in select value from jsonb_array_elements(public.classification_obligation_set(p_classification)) loop
    insert into classification_obligations (org_id, obligation_id, source_clause, subject)
    values (v_org, v_row ->> 'obligationId', v_row ->> 'sourceClause', coalesce(v_row ->> 'subject', ''))
    on conflict (org_id, obligation_id) do update
      set source_clause = excluded.source_clause, subject = excluded.subject;
  end loop;

  perform public.admin_log_change(v_org, 'classification',
    jsonb_build_object('classification', p_classification, 'is_islamic', p_is_islamic,
                       'has_it_scope', p_has_it_scope, 'icfr_rigour', v_rigour, 'version', v_version),
    'classification_set', 'config', null);
  perform public.append_ledger_entry(v_org, 'classification_set',
    jsonb_build_object('classification', p_classification, 'version', v_version,
                       'offered_disciplines', v_offered), auth.uid());
  return v_version;
end $$;

comment on function public.classification_set(uuid, text, boolean, boolean) is
  'S3/D10: records a tenant''s C1–C8 classification, its ICFR trigger and the disciplines it offers, versioned and reason-stamped, and materialises its citation-bearing obligations.';

-- The obligation set for a classification, as data (mirrors src/lib/risk/classification.ts).
create or replace function public.classification_obligation_set(p_classification text)
returns jsonb language sql immutable as $$
  select case p_classification
    when 'C1' then '[
      {"obligationId":"IA-01","sourceClause":"COCG 2019 — dedicated independent IA function reporting to the Audit Committee","subject":"Maintain a dedicated independent internal-audit function"},
      {"obligationId":"IFCR-01","sourceClause":"Companies Act 2017 s.227","subject":"State the adequacy of internal financial controls in the directors'' report"}]'::jsonb
    when 'C2' then '[{"obligationId":"IFCR-01","sourceClause":"Companies Act 2017 — directors'' report comment","subject":"The board must comment on the adequacy of internal financial controls"}]'::jsonb
    when 'C3' then '[{"obligationId":"AUD-01","sourceClause":"Companies Act 2017 ss.223/226","subject":"Statutory audit (no formal ICFR declaration)"}]'::jsonb
    when 'C4' then '[]'::jsonb
    when 'C5' then '[]'::jsonb
    when 'C6' then '[
      {"obligationId":"IA-01","sourceClause":"SBP BSD Circular No. 7 of 2004 — Guidelines on Internal Controls","subject":"A specialised internal-audit function routing to the Board Audit Committee"},
      {"obligationId":"IFCR-02","sourceClause":"SBP BSD Circular No. 5 of 24 Feb 2009 — the ICFR roadmap (eight stages)","subject":"Annual management assessment, board endorsement and a Long Form Report (LFR) by the external auditor"}]'::jsonb
    when 'C7' then '[
      {"obligationId":"IA-01","sourceClause":"SOE (Governance and Operations) Act, 2023","subject":"An independent Chief Internal Auditor with reporting separation from executive management"},
      {"obligationId":"IFCR-02","sourceClause":"SOE (Audit Committee, Internal Control and Risk Management) Regulations, 2024","subject":"Implement COSO ERM, ISO 31000 and COBIT; be double-audited by external firms and the AGP"}]'::jsonb
    when 'C8' then '[{"obligationId":"IFCR-03","sourceClause":"Companies Act 2017 (s.42) — internal financial controls must address AML risk","subject":"Internal financial controls that address AML risk"}]'::jsonb
    else null
  end
$$;

-- ---------------------------------------------------------------------------
-- 7. standards_upsert: configure one library row for one org, or for the platform.
--    org_id NULL writes the platform default (platform admin only). Requires edit_config for an org row.
-- ---------------------------------------------------------------------------
create or replace function public.standards_upsert(
  p_org uuid, p_key text, p_discipline text, p_label text,
  p_citation text default '', p_kind text default 'framework',
  p_source text default '', p_metadata jsonb default '{}'::jsonb
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := p_org;
  v_version int;
begin
  if v_org is null then
    perform public.require_platform_admin();
  else
    perform public.provio_org_guard(v_org);
    if v_org <> public.jwt_org_id() and not public.is_platform_admin() then
      raise exception 'an organisation may only configure its own standards library' using errcode = 'P0001';
    end if;
    if not (public.caller_has_right('edit_config') or public.is_platform_admin()) then
      raise exception 'not allowed: caller lacks the edit_config right' using errcode = 'P0001';
    end if;
  end if;
  if coalesce(btrim(p_key), '') = '' then raise exception 'a standards key is required' using errcode = 'P0001'; end if;
  if p_discipline not in ('management','it','shariah','cross') then
    raise exception 'discipline % is not in the closed set', p_discipline using errcode = 'P0001';
  end if;

  -- An explicit update-then-insert: the scope key is an expression (coalesce of a nullable org_id),
  -- which ON CONFLICT cannot always infer. This is deterministic and never a duplicate.
  update standards_library
     set discipline = p_discipline, kind = coalesce(p_kind,'framework'), label = p_label,
         citation = coalesce(p_citation,''), source = coalesce(p_source,''), metadata = coalesce(p_metadata,'{}'::jsonb),
         version = version + 1, updated_at = now()
   where key = btrim(p_key)
     and coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(v_org, '00000000-0000-0000-0000-000000000000'::uuid)
   returning version into v_version;

  if v_version is null then
    insert into standards_library (org_id, key, discipline, kind, label, citation, source, metadata, version, updated_at)
    values (v_org, btrim(p_key), p_discipline, coalesce(p_kind,'framework'), p_label,
            coalesce(p_citation,''), coalesce(p_source,''), coalesce(p_metadata,'{}'::jsonb), 1, now())
    returning version into v_version;
  end if;

  insert into standards_library_versions (org_id, key, version, snapshot, actor_id)
  select v_org, l.key, l.version,
         jsonb_build_object('discipline', l.discipline, 'kind', l.kind, 'label', l.label,
                            'citation', l.citation, 'source', l.source, 'metadata', l.metadata),
         auth.uid()
  from standards_library l
  where l.key = btrim(p_key)
    and coalesce(l.org_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(v_org, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_org is not null then
    perform public.admin_log_change(v_org, 'standards_library',
      jsonb_build_object('key', btrim(p_key), 'version', v_version),
      'standards_updated', 'config', null);
  end if;
  return v_version;
end $$;

-- ---------------------------------------------------------------------------
-- 8. standards_update_scope: update a library row for ONE org or for ALL orgs in one action.
--    scope='platform' writes the platform default (every org that has no override reads it).
--    scope='org'      writes the named org's own override.
--    scope='all_orgs' writes an override for EVERY org, one version and one ledger entry per org,
--                     inside one transaction — a partial write is impossible (L3).
-- ---------------------------------------------------------------------------
create or replace function public.standards_update_scope(
  p_scope text, p_org uuid, p_key text, p_discipline text, p_label text,
  p_citation text default '', p_source text default ''
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_target uuid;
  v_count int := 0;
begin
  if p_scope not in ('platform','org','all_orgs') then
    raise exception 'scope % is not one of platform / org / all_orgs', p_scope using errcode = 'P0001';
  end if;

  if p_scope = 'platform' then
    perform public.standards_upsert(null, p_key, p_discipline, p_label, p_citation, 'framework', p_source);
    return 1;
  elsif p_scope = 'org' then
    if p_org is null then raise exception 'scope=org needs an organisation' using errcode = 'P0001'; end if;
    perform public.standards_upsert(p_org, p_key, p_discipline, p_label, p_citation, 'framework', p_source);
    return 1;
  else
    -- all_orgs: every org gets the same override; each write is versioned and logged separately.
    if not public.is_platform_admin() then
      raise exception 'scope=all_orgs is platform administrator only' using errcode = 'P0001';
    end if;
    for v_target in select id from orgs loop
      perform public.standards_upsert(v_target, p_key, p_discipline, p_label, p_citation, 'framework', p_source);
      v_count := v_count + 1;
    end loop;
    return v_count;
  end if;
end $$;

comment on function public.standards_update_scope(text, uuid, text, text, text, text, text) is
  'S3/D10: configures one standards-library row for a single org or for every org at once; each affected org gets its own version and ledger entry in the same transaction, so the update is all-or-nothing (L3).';

-- ---------------------------------------------------------------------------
-- 9. risk_library_derive: materialise a framework's derived risks into risks_library, for the
--    disciplines the org's classification offers. Idempotent on (org_id, code) — a re-run adds none.
-- ---------------------------------------------------------------------------
create or replace function public.risk_library_derive(p_org uuid, p_standards_key text default null)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(p_org, public.jwt_org_id());
  v_offered jsonb;
  v_added int := 0;
  d record;
begin
  if v_org is null then raise exception 'an organisation is required' using errcode = 'P0001'; end if;
  perform public.provio_org_guard(v_org);
  if not (public.caller_has_right('edit_config') or public.caller_has_right('manage_engagements')) then
    raise exception 'not permitted: edit_config or manage_engagements is required' using errcode = 'P0001';
  end if;

  select offered_disciplines into v_offered from org_classification where org_id = v_org;
  if v_offered is null then
    raise exception 'the organisation has no classification yet' using errcode = 'P0001';
  end if;

  for d in
    select r.code, r.name, r.risk_type, r.source, r.is_emerging, r.discipline, r.standards_key
    from risk_derivations r
    where r.active
      and (r.org_id is null or r.org_id = v_org)
      and (p_standards_key is null or r.standards_key = p_standards_key)
      and v_offered ? r.discipline
  loop
    insert into risks_library (org_id, name, description, code, category, discipline, source,
                               risk_type, is_emerging, is_universal, derived_from)
    values (v_org, d.name, d.name, d.code, d.discipline, d.discipline, d.source,
            d.risk_type, d.is_emerging, false, d.standards_key)
    on conflict (org_id, code) where code is not null do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;

  perform public.admin_log_change(v_org, 'risk_library_derive',
    jsonb_build_object('standards_key', p_standards_key, 'added', v_added),
    'risk_library_derived', 'config', null);
  return v_added;
end $$;

comment on function public.risk_library_derive(uuid, text) is
  'S3/D10+D14: derives the risks a framework''s control requirements imply into risks_library, for the disciplines the org''s classification offers. Idempotent on (org_id, code): a re-run adds nothing.';

-- ---------------------------------------------------------------------------
-- 10. RLS and grants. Application roles only; no writer is anon-reachable.
-- ---------------------------------------------------------------------------
revoke execute on function public.classification_set(uuid, text, boolean, boolean) from public, anon;
revoke execute on function public.classification_obligation_set(text) from public, anon;
revoke execute on function public.standards_upsert(uuid, text, text, text, text, text, text, jsonb) from public, anon;
revoke execute on function public.standards_update_scope(text, uuid, text, text, text, text, text) from public, anon;
revoke execute on function public.risk_library_derive(uuid, text) from public, anon;
revoke insert, update, delete on org_classification from public, anon, authenticated;
revoke insert, update, delete on classification_obligations from public, anon, authenticated;
revoke insert, update, delete on standards_library from public, anon, authenticated;
revoke insert, update, delete on risk_derivations from public, anon, authenticated;

grant execute on function public.classification_set(uuid, text, boolean, boolean) to authenticated;
grant execute on function public.classification_obligation_set(text) to authenticated;
grant execute on function public.standards_upsert(uuid, text, text, text, text, text, text, jsonb) to authenticated;
grant execute on function public.standards_update_scope(text, uuid, text, text, text, text, text) to authenticated;
grant execute on function public.risk_library_derive(uuid, text) to authenticated;
