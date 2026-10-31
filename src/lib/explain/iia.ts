/**
 * IIA Global Internal Audit Standards (2024) as data (docs/EXPLAIN-LAYER.md §5; E3, E7).
 *
 * Numbering and titles come from docs/iia-standards-reference.md, verified against the IIA's own
 * condensed 2024 text. The IIA holds copyright, so every entry here PARAPHRASES the standard in our
 * own words and cites only the number — never the IIA's wording.
 *
 * Each standard points at the real screens and RPCs where Provio addresses it, and at the artifact
 * that proves it. A standard the product does not address is marked with a null `implementation` and
 * no surface — and that marking is shown honestly in the UI (G9).
 */
import type { ExplainEntry } from './types';

export type IiaDomain = 'I' | 'II' | 'III' | 'IV' | 'V';

export interface IiaStandard {
  /** The verified IIA 2024 number, e.g. `13.2`. */
  id: string;
  domain: IiaDomain;
  /** Our own short title (a title is structure, not the standard's text). */
  title: string;
  /** ONE sentence, our words. */
  paraphrase: string;
  /** What Provio does about it. `null` when the product does not address it. */
  implementation: string | null;
  /** Real screen ids (docs/ACP-UI-CONTRACT.md) where it is addressed. */
  implementedBy: string[];
  /** Real RPCs / tables that implement it. */
  rpcs: string[];
  /** The artifact that proves it (workpaper, report section, CAP, log). */
  evidence: string[];
  /** Catalogue entry ids that carry this standard. */
  explainIds: string[];
}

const S = (
  id: string,
  domain: IiaDomain,
  title: string,
  paraphrase: string,
  implementation: string | null,
  implementedBy: string[],
  rpcs: string[],
  evidence: string[],
  explainIds: string[]
): IiaStandard => ({ id, domain, title, paraphrase, implementation, implementedBy, rpcs, evidence, explainIds });

/**
 * The standards the product catalogue records, weighted to the domains the product serves. Domain V
 * (the engagement lifecycle) and Domain IV (managing the function) are complete; Domains II and III
 * are partial, as the spec allows, and the entries the product does not implement say so.
 */
export const IIA_STANDARDS: IiaStandard[] = [
  // Domain V — Performing Internal Audit Services (the engagement lifecycle).
  S('13.1', 'V', 'Engagement Communication',
    'The function keeps the engagement client informed through the engagement.',
    'Findings and observations record the client response alongside the matter they answer.',
    ['AF-10', 'IR-01'], ['observations', 'findings'],
    ['The finding record with its client response', 'The engagement communication log'],
    ['term.finding', 'term.observation']),
  S('13.2', 'V', 'Engagement Risk Assessment',
    'Each engagement assesses the risks relevant to it using the organisation’s risk framework.',
    'The engagement reads the entity’s risk ratings, controls and SIRA index, so the work is aimed at the real risks.',
    ['SR-01', 'SR-02', 'AP-04', 'AF-02'], ['risks', 'controls', 'entities'],
    ['The engagement risk assessment', 'The SIRA index and its factors'],
    ['term.inherent_risk', 'term.residual_risk', 'field.engagement.stage']),
  S('13.3', 'V', 'Engagement Objectives and Scope',
    'Each engagement states its objectives and its scope, including what is out of scope.',
    'Planning records objectives and scope, and the configured role signs it off before testing begins.',
    ['AF-02', 'AP-01'], ['engagements', 'plans'],
    ['The approved engagement plan', 'The planning sign-off in the ledger'],
    ['field.config.signoff_role_planning', 'step.planning_signoff']),
  S('13.4', 'V', 'Evaluation Criteria',
    'Each engagement states the criteria against which it evaluates what it finds.',
    'The methodology template states the criteria and the test steps that apply them.',
    ['OA-08', 'AF-06'], ['methodology_templates'],
    ['The methodology and test-step template'],
    ['standard.9.3']),
  S('13.5', 'V', 'Engagement Resources',
    'Each engagement has the resources — people, time and information — it needs.',
    'The engagement records its team, its period and its due date; the work queue surfaces shortfalls.',
    ['AF-01', 'WQ-01'], ['engagements', 'engagement_team'],
    ['The engagement team and period record'],
    ['field.engagement.stage']),
  S('13.6', 'V', 'Work Program',
    'Each engagement has a work program: the procedures that meet its objectives.',
    'The work program is the test steps on the workpaper, seeded from the methodology and worked row by row.',
    ['AF-06', 'AF-07', 'OA-08'], ['test_steps', 'workpapers'],
    ['The workpaper test steps'],
    ['term.sample', 'standard.9.3']),
  S('14.1', 'V', 'Gathering Information for Analyses and Evaluation',
    'The function gathers enough reliable information to support its analyses and conclusions.',
    'The population is confirmed and hashed, a sample is drawn by a named method, and coverage is reported.',
    ['AF-05', 'AF-06'], ['populations', 'population_rows', 'sampling_runs'],
    ['The confirmed population and its hash', 'The sampling run and its method'],
    ['term.population', 'term.sample', 'term.coverage', 'method.mus']),
  S('14.2', 'V', 'Analyses and Potential Engagement Findings',
    'The function analyses the information and identifies potential findings.',
    'Each tested row carries a remark and a decision; exceptions and the error limit are computed, and the forensic rules name the rows that warrant a finding.',
    ['AF-06', 'AF-07', 'AF-13'], ['population_rows', 'value_coverage'],
    ['The tested rows with their results', 'The exception count and the error limit'],
    ['term.exception', 'term.upper_error_limit', 'term.finding']),
  S('14.3', 'V', 'Evaluation of Findings',
    'The function evaluates findings: their significance and their root cause.',
    'A finding records its severity, its root cause and the rule and rows behind it, so its evaluation is reproducible.',
    ['AF-10', 'IR-01'], ['findings', 'observations'],
    ['The finding with its severity and root cause'],
    ['term.finding', 'term.root_cause', 'term.materiality']),
  S('14.4', 'V', 'Recommendations and Action Plans',
    'The function makes recommendations and agrees action plans with the client.',
    'A finding carries a corrective action plan with an owner and a due date, tracked to closure.',
    ['IR-01', 'IR-02', 'IR-05'], ['cap_items'],
    ['The corrective action plan and its closure evidence'],
    ['term.action_plan', 'status.cap.overdue']),
  S('14.5', 'V', 'Engagement Conclusions',
    'The function reaches a conclusion on the engagement as a whole.',
    'The conclusion panel records the conclusion and its basis, and the configured role signs it off before finalisation.',
    ['AF-08', 'AF-04'], ['engagements', 'conclusions'],
    ['The recorded conclusion and its sign-off'],
    ['term.coverage', 'step.conclusion_signoff']),
  S('14.6', 'V', 'Engagement Documentation',
    'The function documents the engagement so an experienced auditor with no prior connection can understand what was done and why.',
    'Workpapers, evidence and the audit file record the work; sealing commits a graph root so the output can be re-derived and verified.',
    ['AF-01', 'AF-03', 'AF-11'], ['workpapers', 'evidence_files', 'report_graph'],
    ['The audit file', 'The sealed graph root', 'The evidence hash'],
    ['term.sealed', 'term.graph_root', 'step.evidence_verify', 'field.evidence.content_sha256']),
  S('15.1', 'V', 'Final Engagement Communication',
    'The function issues a final communication that states the engagement’s results and its conclusion.',
    'The report editor composes the final communication from data and tokens and finalises it with a recorded root.',
    ['AF-14', 'WK-11'], ['report_versions', 'report_graph'],
    ['The finalised report and its root'],
    ['term.graph_root', 'step.seal']),
  S('15.2', 'V', 'Confirming the Implementation of Recommendations or Action Plans',
    'The function follows up to confirm that agreed recommendations or action plans were implemented.',
    'A corrective action plan is tracked to closure with evidence; past its due date it counts as overdue and escalates.',
    ['IR-01', 'IR-02', 'IR-05'], ['cap_items'],
    ['The CAP closure record and its evidence'],
    ['term.action_plan', 'status.cap.overdue']),

  // Domain IV — Managing the Internal Audit Function.
  S('9.1', 'IV', 'Understanding Governance, Risk Management, and Control Processes',
    'The function understands the organisation’s governance, risk and control processes.',
    'The universe, entity risk ratings and the risk/control mapping record that understanding and drive the plan.',
    ['AU-01', 'AU-02', 'SR-01'], ['universes', 'entities', 'risks', 'controls'],
    ['The universe and entity register', 'The risk and control mapping'],
    ['term.inherent_risk', 'term.residual_risk']),
  S('9.2', 'IV', 'Internal Audit Strategy',
    'The function has a strategy that aligns with the organisation’s objectives.',
    'The plan is built from the SIRA cycle, so the strategy is expressed as the risk-based plan.',
    ['AP-01', 'SR-01'], ['plans', 'plan_versions'],
    ['The approved plan and its versions'],
    ['standard.9.4']),
  S('9.3', 'IV', 'Methodologies',
    'The function uses defined methodologies and keeps them current.',
    'Methodology and test-step templates seed an engagement with a working rulebook, versioned so a change alters no fact.',
    ['OA-08', 'OA-22'], ['methodology_templates', 'test_step_templates'],
    ['The methodology template and its version'],
    ['standard.13.6']),
  S('9.4', 'IV', 'Internal Audit Plan',
    'The function builds an audit plan on risk and updates it as the risk picture changes.',
    'The plan is drawn from the latest published SIRA cycle; suggestions are accepted or rejected with a reason, and each plan version is recorded.',
    ['AP-01', 'AP-04', 'SR-01'], ['plans', 'plan_versions', 'populate_planning_suggestions', 'decide_planning_suggestion'],
    ['The plan and the suggestion decisions'],
    ['standard.9.2', 'standard.13.2']),
  S('9.5', 'IV', 'Coordination and Reliance',
    'The function coordinates with other assurance providers and may rely on their work.',
    'The prior-year import and the shared-work flags record what was relied upon and from where.',
    ['AP-05'], ['prior_year_imports'],
    ['The prior-year import record'],
    ['standard.9.4']),
  S('10.1', 'IV', 'Financial Resource Management',
    'The function manages the financial resources it is given.',
    null, [], [], [], []),
  S('10.2', 'IV', 'Human Resources Management',
    'The function manages the people it needs, with the right competence.',
    'The engagement team, the reviewer assignment and the reviewer-load view record who does what.',
    ['AF-01', 'WQ-01'], ['engagement_team'],
    ['The engagement team and reviewer assignment'],
    ['field.config.signoff_role_testing']),
  S('10.3', 'IV', 'Technological Resources',
    'The function has and manages the technology it needs.',
    'The hosting, database and connector settings record the technology the tenant runs on.',
    ['OA-15', 'OA-23'], ['org_settings_extra', 'connectors'],
    ['The hosting and connector configuration'],
    ['screen.OA-23']),
  S('11.1', 'IV', 'Building Relationships and Communicating with Stakeholders',
    'The function builds relationships and communicates with its stakeholders.',
    'Engagement communication and the notification and escalation rules record how the function communicates.',
    ['OA-12', 'OA-13'], ['notification_rules', 'escalation_rules'],
    ['The notification and escalation rules'],
    ['field.config.escalation_role']),
  S('11.2', 'IV', 'Effective Communication',
    'The function communicates effectively: clear, accurate and timely.',
    'The report format and the writing engine render the communication from data and tokens, so it is accurate and reproducible.',
    ['OA-24', 'WK-11'], ['report_formats', 'report_versions'],
    ['The report format and the rendered report'],
    ['standard.15.1']),
  S('11.3', 'IV', 'Communicating Results',
    'The function communicates its results to the right people, including the board.',
    'The Board Pack and the report communicate results, each figure linked to its source.',
    ['WK-01', 'WK-03', 'OA-09'], ['board_pack_sections', 'report_versions'],
    ['The Board Pack and the issued report'],
    ['screen.WK-03']),
  S('11.4', 'IV', 'Errors and Omissions',
    'When an error or omission is found in communicated work, the function corrects it and tells those who relied on it.',
    'The pre-flight check names each unmet condition, and an acknowledge-with-reason path records why work proceeded despite it.',
    ['AF-12', 'AF-07'], ['preflight_check'],
    ['The pre-flight result and the override reason'],
    ['term.override', 'standard.14.6']),
  S('11.5', 'IV', 'Communicating the Acceptance of Risks',
    'When management accepts a risk the function has raised, that acceptance is communicated and recorded.',
    'A CAP that management will not implement records the accepted risk and the reason, so the acceptance is visible.',
    ['IR-02', 'IR-05'], ['cap_items'],
    ['The accepted-risk record and its reason'],
    ['term.action_plan']),
  S('12.1', 'IV', 'Internal Quality Assessment',
    'The function assesses the quality of its own work on an ongoing basis.',
    'The review sign-off, the deployment gate and the pre-flight check are the ongoing quality assessment.',
    ['AF-12', 'OA-19'], ['preflight_check'],
    ['The review sign-offs and the health check'],
    ['standard.12.3']),
  S('12.2', 'IV', 'Performance Measurement',
    'The function measures its own performance against its objectives.',
    'The work queue, engagement health and reviewer-load views measure performance against consequence and time.',
    ['WQ-01', 'DB-01'], ['engagements', 'cap_items'],
    ['The engagement health and ageing views'],
    ['screen.WQ-01']),
  S('12.3', 'IV', 'Oversee and Improve Engagement Performance',
    'The function oversees and improves engagement performance through review and sign-off that carries authority.',
    'The configured sign-off roles, approval chain and SLA are enforced by the database, so a stage cannot advance without the required sign-off.',
    ['OA-22', 'AF-04'], ['lifecycle_settings_get', 'admin_save_lifecycle_settings', 'admin_save_workflow_settings'],
    ['The lifecycle and workflow settings', 'The recorded sign-offs'],
    ['field.config.signoff_role_testing', 'field.config.approval_chain', 'field.config.testing_mode']),

  // Domain III — Governing the Internal Audit Function (partial).
  S('6.1', 'III', 'Internal Audit Mandate',
    'The function has a mandate, from the board, that gives it its authority.',
    'The organisation is provisioned with an audit function and named roles that carry the mandate.',
    ['SA-16', 'OA-05'], ['orgs', 'roles'],
    ['The provisioned organisation and its roles'],
    ['term.access_right']),
  S('6.2', 'III', 'Internal Audit Charter',
    'The function has a charter that sets out its purpose, authority and responsibility.',
    'The governance settings record the function’s configured authority, though a formal charter document is not yet modelled.',
    ['OA-22'], ['org_settings_extra'],
    ['The governance settings'],
    ['screen.OA-22']),
  S('6.3', 'III', 'Board and Senior Management Support',
    'The function has the support of the board and senior management.',
    null, [], [], [], []),
  S('7.1', 'III', 'Organizational Independence',
    'The function is positioned so it can be independent of the activities it audits.',
    'Rights are separated so a preparer cannot also approve the work, and the head role is distinct.',
    ['OA-05'], ['roles', 'head_level', 'is_head'],
    ['The roles and rights configuration'],
    ['term.access_right']),
  S('7.2', 'III', 'Chief Audit Executive Qualifications',
    'The chief audit executive has the qualifications and competence the role needs.',
    null, [], [], [], []),
  S('8.1', 'III', 'Board Interaction',
    'The function interacts with the board, and the board is informed.',
    'The Board Pack is the product’s channel to the board, with every figure linked to its source.',
    ['WK-01', 'WK-03'], ['board_pack_sections'],
    ['The generated Board Pack'],
    ['standard.11.3']),
  S('8.2', 'III', 'Resources',
    'The function has the resources it needs, and reports any shortfall.',
    'The reviewer-load and engagement-health views surface a resource shortfall before it becomes a missed deadline.',
    ['WQ-01'], ['engagements'],
    ['The reviewer load and ageing views'],
    ['standard.12.2']),
  S('8.3', 'III', 'Quality',
    'The function maintains quality, assured through an ongoing programme.',
    'The internal quality assessment is the review sign-off and the health check.',
    ['OA-19', 'AF-12'], ['preflight_check'],
    ['The quality review records'],
    ['standard.12.1']),
  S('8.4', 'III', 'External Quality Assessment',
    'The function is assessed externally, at least once every five years.',
    null, [], [], [], []),

  // Domain II — Ethics and Professionalism (partial).
  S('1.1', 'II', 'Honesty and Professional Courage',
    'The function reports honestly and does not suppress uncomfortable findings.',
    'A finding cannot be deleted; it is recorded with its provenance and flows to the report.',
    ['AF-10', 'IR-01'], ['findings'],
    ['The finding record and its ledger entry'],
    ['term.finding']),
  S('1.2', 'II', "Organization's Ethical Expectations",
    'The function works to the organisation’s stated ethical expectations.',
    'The ethics panel records independence and any ethical matter for the engagement.',
    ['AF-09'], ['ethics_declarations'],
    ['The ethics declaration'],
    ['screen.AF-09']),
  S('1.3', 'II', 'Legal and Ethical Behavior',
    'The function acts lawfully and ethically.',
    null, [], [], [], []),
  S('2.1', 'II', 'Individual Objectivity',
    'Auditors are objective, and do not subordinate judgement to others.',
    'A preparer cannot approve their own work; the right model separates the roles.',
    ['OA-05'], ['roles'],
    ['The rights model and the review sign-offs'],
    ['term.access_right']),
  S('2.2', 'II', 'Safeguarding Objectivity',
    'The function safeguards objectivity against threats and conflicts.',
    'The ethics declaration and the separation of propose/approve roles guard objectivity.',
    ['AF-09', 'OA-05'], ['ethics_declarations', 'roles'],
    ['The ethics declaration and the roles'],
    ['screen.AF-09']),
  S('2.3', 'II', 'Disclosing Impairments to Objectivity',
    'An impairment to objectivity is disclosed and managed.',
    'The ethics panel records an impairment declaration and it is shown to the reviewer.',
    ['AF-09'], ['ethics_declarations'],
    ['The impairment declaration'],
    ['screen.AF-09']),
  S('3.1', 'II', 'Competency',
    'The function has the competence it needs, individually and collectively.',
    null, [], [], [], []),
  S('3.2', 'II', 'Continuing Professional Development',
    'Auditors keep their competence current.',
    null, [], [], [], []),
  S('4.1', 'II', 'Conformance with the Global Internal Audit Standards',
    'The function conforms with the Global Internal Audit Standards.',
    'The standards view states, per standard, where the product addresses it and where it does not.',
    ['OA-19'], ['preflight_check'],
    ['The standards mapping in the product'],
    ['standard.5.1']),
  S('4.2', 'II', 'Due Professional Care',
    'Auditors exercise the care a reasonable, competent auditor would.',
    'The pre-flight gate and the evidence check enforce the care the engagement requires.',
    ['AF-12', 'AF-07'], ['preflight_check'],
    ['The pre-flight result'],
    ['standard.11.4']),
  S('4.3', 'II', 'Professional Skepticism',
    'Auditors question information and do not accept it uncritically.',
    'The forensic rule engine surfaces what does not fit, naming the rule and the rows behind it.',
    ['AF-13'], ['analyst_runs'],
    ['The analyst run and its findings'],
    ['term.finding']),
  S('5.1', 'II', 'Use of Information',
    'The function uses information lawfully, only for its purpose, and within the rules on data about individuals.',
    'Every tenant read passes through the row-level rules keyed to the signed-in organisation, so information is used only within its tenant.',
    ['OA-05', 'OA-26', 'OA-28'], ['jwt_org_id', 'org_members'],
    ['The row-level security model'],
    ['term.access_right', 'term.redaction']),
  S('5.2', 'II', 'Protection of Information',
    'The function protects the information it holds: confidentiality, integrity and availability.',
    'Access is decided by a named right, evidence is hashed and re-derived, and the ledger is append-only, so information is protected and its integrity is provable.',
    ['OA-05', 'OA-26', 'AF-11'], ['caller_has_right', 'append_ledger_entry', 'evidence_files'],
    ['The ledger and the evidence hashes'],
    ['term.chain_of_custody', 'term.integrity_alert', 'status.alert.hash_mismatch']),
];

/** The standards the product implements (has a real implementation and a real surface). */
export function implementedStandards(): IiaStandard[] {
  return IIA_STANDARDS.filter((s) => s.implementation !== null && s.implementedBy.length > 0);
}

/** The standards the product records but does not yet implement. */
export function unimplementedStandards(): IiaStandard[] {
  return IIA_STANDARDS.filter((s) => s.implementation === null);
}

export function iiaStandard(id: string): IiaStandard | undefined {
  return IIA_STANDARDS.find((s) => s.id === id);
}

/** The title of a standard by number. */
export function iiaTitle(number: string): string | undefined {
  return IIA_STANDARDS.find((s) => s.id === number)?.title;
}

/** Derive the catalogue entries from the standards, so the two can never drift. */
export const STANDARD_ENTRIES: ExplainEntry[] = IIA_STANDARDS.map((s) => ({
  id: `standard.${s.id}`,
  kind: 'standard' as const,
  title: `${s.id} ${s.title}`,
  summary: s.paraphrase,
  effect:
    s.implementation ??
    'Not yet implemented: the product records this standard but does not yet address it.',
  iiaStandards: [s.id],
  related: s.explainIds,
  source: 'docs/iia-standards-reference.md',
}));
