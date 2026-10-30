/**
 * Audit disciplines — the closed-but-extensible set (docs/AUDIT-DOMAINS-MODEL.md §3).
 *
 * "Never hard-code exactly three": the set is closed (a universe's discipline is one of these) but
 * extensible (a fourth is a data change, not a code change). This module is the one place that names
 * a discipline; every screen and rule pack keys off it.
 *
 * Pure (L4): data only, no clock, no client.
 */

export const DISCIPLINES = ['management', 'it', 'shariah', 'cross'] as const;

export type Discipline = (typeof DISCIPLINES)[number];

export interface DisciplineProfile {
  discipline: Discipline;
  label: string;
  /** The control-set standards the discipline cites, exactly as docs name them. */
  controlStandards: string[];
  /** The rule families the discipline's pack wraps (docs/AUDIT-DOMAINS-MODEL.md §3). */
  ruleFamilies: string[];
  /** The report models the discipline produces. */
  reports: string[];
  /** Whether a tenant may define a universe of this discipline freely (cross is a tag, not a universe). */
  selectable: boolean;
}

/**
 * The three disciplines (docs/AUDIT-DOMAINS-MODEL.md §3) plus `cross` — the tag a risk-library row
 * carries when it belongs to more than one discipline (docs/RISK-ASSESSMENT-MODEL.md §4).
 */
export const DISCIPLINE_PROFILES: DisciplineProfile[] = [
  {
    discipline: 'management', label: 'Management Audit',
    controlStandards: ['COSO ICIF-2013', 'PCAOB AS 2201', 'the IIA 2024 standards'],
    ruleFamilies: ['numeric', 'threshold', 'documents', 'patterns', 'minutes', 'policydiff'],
    reports: ['M1–M12 (the 12 writing-engine models)'],
    selectable: true,
  },
  {
    discipline: 'it', label: 'IT Audit',
    controlStandards: ['COBIT 2019', 'ISO/IEC 27001:2022 Annex A', 'NIST SP 800-53 Rev. 5'],
    ruleFamilies: ['it_controls'],
    reports: ['an IT assurance report', 'the IT findings pack'],
    selectable: true,
  },
  {
    discipline: 'shariah', label: "Shari'ah Audit",
    controlStandards: ['AAOIFI SS 1–54', 'SBP Compendium (31 Oct 2024)', 'SBP SGF (1 Jan 2025)'],
    ruleFamilies: ['shariah_structural'],
    reports: ['a Shari\'ah review report', 'the SSB reporting pack'],
    selectable: true,
  },
  {
    discipline: 'cross', label: 'Cross-discipline',
    controlStandards: [],
    ruleFamilies: [],
    reports: [],
    selectable: false,
  },
];

export function disciplineProfile(d: Discipline): DisciplineProfile {
  const p = DISCIPLINE_PROFILES.find((x) => x.discipline === d);
  if (!p) throw new Error(`discipline: ${d} is not in the closed set`);
  return p;
}

/** The disciplines a tenant may create a universe for (excludes the `cross` tag). */
export function selectableDisciplines(): DisciplineProfile[] {
  return DISCIPLINE_PROFILES.filter((p) => p.selectable);
}

/** True when a value is one of the named disciplines. */
export function isDiscipline(v: string): v is Discipline {
  return (DISCIPLINES as readonly string[]).includes(v);
}

/** Normalise a free-text universe domain onto the closed set; an unknown domain is `null`, never guessed. */
export function disciplineOf(domain: string | null | undefined): Discipline | null {
  if (!domain) return null;
  const key = domain.trim().toLowerCase();
  if (isDiscipline(key)) return key;
  if (key === 'management audit') return 'management';
  if (key === 'it audit' || key === 'it') return 'it';
  if (key === "shari'ah audit" || key === 'shariah audit' || key === 'shariah') return 'shariah';
  return null;
}
