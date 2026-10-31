/**
 * W3.1: the twelve report models. A model is a versioned template with its own document plan
 * (sections, order, rhetorical roles, which claim kinds appear, default register, allowed
 * registers, default locale). Models are data, so more can be added without code.
 */

import type { DocumentPlan, Locale, Register, RhetoricalRole, Section } from './types';

export interface ReportModel {
  modelId: string;
  version: number;
  title: string;
  /** The document plan: the ordered sections. */
  plan: DocumentPlan;
  /** The register used when the caller does not choose one. */
  defaultRegister: Register;
  /** The registers the model may be rendered in. Empty means any. */
  allowedRegisters: Register[];
  defaultLocale: Locale;
  /** A one-line description for the model viewer (W12). */
  description: string;
}

interface SectionSpec {
  id: string;
  heading: string;
  role: RhetoricalRole;
  /** The rhetorical roles (and so the claim families) that may appear in this section. */
  roles: RhetoricalRole[];
  /** True when the section is purely numeric and cannot differ across registers (W2.8). */
  registerInvariant?: boolean;
}

function sections(specs: SectionSpec[]): Section[] {
  return specs.map((s, i) => ({
    id: s.id,
    heading: s.heading,
    role: s.role,
    roles: s.roles,
    order: i + 1,
    registerInvariant: s.registerInvariant ?? false,
  }));
}

function plan(modelId: string, specs: SectionSpec[]): DocumentPlan {
  return {
    modelId,
    sections: sections(specs),
    claimKinds: ['calculated', 'derived', 'auditor'],
  };
}

const STD: Register = { formality: 3, tone: 2, voice: 'active' };

/**
 * The twelve models. Each names the sections it needs, in order, with the rhetorical role each
 * section plays. `role` is the section's own role; `roles` is the set of claim roles allowed in it.
 */
export const REPORT_MODELS: ReportModel[] = [
  {
    modelId: 'M1',
    version: 1,
    title: 'Full engagement report',
    description: 'The complete report: scope, findings, coverage, limitation and appendices.',
    plan: plan('M1', [
      { id: 'cover', heading: 'Cover', role: 'lead_in', roles: ['lead_in'] },
      { id: 'scope', heading: 'Scope and period', role: 'scope', roles: ['scope', 'limitation'] },
      { id: 'exec', heading: 'Executive summary', role: 'summary', roles: ['summary', 'exception_summary', 'lead_in'] },
      { id: 'findings', heading: 'Findings', role: 'findings', roles: ['condition', 'criteria', 'cause', 'effect', 'recommendation', 'management_response', 'status'] },
      { id: 'coverage', heading: 'Coverage', role: 'coverage', roles: ['coverage'] },
      { id: 'appendices', heading: 'Appendices', role: 'appendices', roles: ['numeric_summary'], registerInvariant: true },
    ]),
    defaultRegister: STD,
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M2',
    version: 1,
    title: 'Audit committee and board report',
    description: 'A board-facing report: assurance, findings and coverage in board-register form.',
    plan: plan('M2', [
      { id: 'exec', heading: 'Assurance summary', role: 'summary', roles: ['summary', 'lead_in'] },
      { id: 'findings', heading: 'Findings and actions', role: 'findings', roles: ['condition', 'effect', 'recommendation', 'management_response', 'status'] },
      { id: 'coverage', heading: 'Coverage', role: 'coverage', roles: ['coverage'] },
      { id: 'appendices', heading: 'Appendices', role: 'appendices', roles: ['numeric_summary'], registerInvariant: true },
    ]),
    defaultRegister: { formality: 5, tone: 2, voice: 'active' },
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M3',
    version: 1,
    title: 'Executive summary',
    description: 'A one-page summary of the engagement outcome.',
    plan: plan('M3', [
      { id: 'exec', heading: 'Executive summary', role: 'summary', roles: ['summary', 'exception_summary', 'lead_in'] },
      { id: 'appendices', heading: 'Key figures', role: 'appendices', roles: ['numeric_summary'], registerInvariant: true },
    ]),
    defaultRegister: STD,
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M4',
    version: 1,
    title: 'Management letter',
    description: 'A letter to management: the observations, the effects and the actions agreed.',
    plan: plan('M4', [
      { id: 'cover', heading: 'Introduction', role: 'lead_in', roles: ['lead_in'] },
      { id: 'findings', heading: 'Observations', role: 'findings', roles: ['condition', 'criteria', 'cause', 'effect', 'recommendation', 'management_response', 'status'] },
      { id: 'coverage', heading: 'Coverage', role: 'coverage', roles: ['coverage'] },
    ]),
    defaultRegister: STD,
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M5',
    version: 1,
    title: 'Single finding memo',
    description: 'One finding in full: condition, criteria, cause, effect, recommendation and response.',
    plan: plan('M5', [
      { id: 'findings', heading: 'Finding', role: 'findings', roles: ['condition', 'criteria', 'cause', 'effect', 'recommendation', 'management_response', 'status'] },
      { id: 'appendices', heading: 'Figures', role: 'appendices', roles: ['numeric_summary'], registerInvariant: true },
    ]),
    defaultRegister: STD,
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M6',
    version: 1,
    title: 'CAP and follow-up status report',
    description: 'The corrective action plans and their current status.',
    plan: plan('M6', [
      { id: 'exec', heading: 'Summary', role: 'summary', roles: ['summary', 'exception_summary', 'lead_in'] },
      { id: 'findings', heading: 'Actions and status', role: 'findings', roles: ['recommendation', 'management_response', 'status'] },
      { id: 'coverage', heading: 'Coverage', role: 'coverage', roles: ['coverage'] },
      { id: 'appendices', heading: 'Counts', role: 'appendices', roles: ['numeric_summary'], registerInvariant: true },
    ]),
    defaultRegister: STD,
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M7',
    version: 1,
    title: 'Control deficiency evaluation report',
    description: 'Counts, ratings and evidence for control deficiencies. No opinion is expressed.',
    plan: plan('M7', [
      { id: 'findings', heading: 'Deficiencies', role: 'findings', roles: ['condition', 'criteria', 'cause', 'effect'] },
      { id: 'coverage', heading: 'Coverage', role: 'coverage', roles: ['coverage'] },
      { id: 'appendices', heading: 'Counts and ratings', role: 'appendices', roles: ['numeric_summary'], registerInvariant: true },
    ]),
    defaultRegister: STD,
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M8',
    version: 1,
    title: 'Compliance and regulatory submission report',
    description: 'A regulatory submission: scope, criteria, findings and coverage.',
    plan: plan('M8', [
      { id: 'scope', heading: 'Scope and criteria', role: 'scope', roles: ['scope', 'criteria', 'limitation'] },
      { id: 'findings', heading: 'Findings against the criteria', role: 'findings', roles: ['condition', 'criteria', 'cause', 'effect', 'recommendation'] },
      { id: 'coverage', heading: 'Coverage', role: 'coverage', roles: ['coverage'] },
    ]),
    defaultRegister: { formality: 5, tone: 2, voice: 'active' },
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M9',
    version: 1,
    title: 'Special review fact report',
    description: 'Facts and records only. No conclusions are expressed.',
    plan: plan('M9', [
      { id: 'scope', heading: 'Scope and period', role: 'scope', roles: ['scope', 'limitation'] },
      { id: 'findings', heading: 'Facts established', role: 'findings', roles: ['condition', 'criteria'] },
      { id: 'coverage', heading: 'Records examined', role: 'coverage', roles: ['coverage'] },
    ]),
    defaultRegister: { formality: 4, tone: 2, voice: 'active' },
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M10',
    version: 1,
    title: 'Annual audit plan and coverage report',
    description: 'The plan and the coverage achieved against it.',
    plan: plan('M10', [
      { id: 'exec', heading: 'Plan summary', role: 'summary', roles: ['summary', 'lead_in'] },
      { id: 'scope', heading: 'Scope and period', role: 'scope', roles: ['scope', 'limitation'] },
      { id: 'coverage', heading: 'Coverage against the plan', role: 'coverage', roles: ['coverage'] },
      { id: 'appendices', heading: 'Counts', role: 'appendices', roles: ['numeric_summary'], registerInvariant: true },
    ]),
    defaultRegister: STD,
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M11',
    version: 1,
    title: 'Quarterly activity and trend report',
    description: 'Activity and trends over the quarter, with the figures that support them.',
    plan: plan('M11', [
      { id: 'exec', heading: 'Quarter summary', role: 'summary', roles: ['summary', 'exception_summary', 'lead_in'] },
      { id: 'findings', heading: 'Activity', role: 'findings', roles: ['status', 'recommendation', 'management_response'] },
      { id: 'appendices', heading: 'Trend figures', role: 'appendices', roles: ['numeric_summary'], registerInvariant: true },
    ]),
    defaultRegister: STD,
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
  {
    modelId: 'M12',
    version: 1,
    title: 'Continuous-monitoring alert digest',
    description: 'A digest of alerts by rule, period, status and disposition (W11.4).',
    plan: plan('M12', [
      { id: 'exec', heading: 'Alert summary', role: 'summary', roles: ['alert_summary', 'lead_in'] },
      { id: 'findings', heading: 'Dispositions and escalations', role: 'findings', roles: ['condition', 'status', 'recommendation', 'management_response'] },
      { id: 'appendices', heading: 'Counts', role: 'appendices', roles: ['numeric_summary'], registerInvariant: true },
    ]),
    defaultRegister: STD,
    allowedRegisters: [],
    defaultLocale: 'en-GB',
  },
];

export function modelById(modelId: string): ReportModel | undefined {
  return REPORT_MODELS.find((m) => m.modelId === modelId);
}

/** The sections of a model, in order. */
export function modelSections(modelId: string): Section[] {
  return modelById(modelId)?.plan.sections ?? [];
}

/** True when a section is declared register-invariant (a purely numeric section). */
export function isRegisterInvariant(modelId: string, sectionId: string): boolean {
  return modelSections(modelId).find((s) => s.id === sectionId)?.registerInvariant ?? false;
}
