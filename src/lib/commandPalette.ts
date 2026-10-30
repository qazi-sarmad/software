/**
 * Command palette index and ranking (U2; SPEC-v10 §5, docs/SYSTELIGON.md §11.1c Tier 1 item 2).
 *
 * The palette is the single highest-leverage interaction in a product with this many screens: type
 * "benford" and go to the analyst engine, type an entity name and jump to it. This module is the
 * deterministic half — the command index (screens, actions, explain entries) and the ranking rule —
 * so it is unit-tested without a browser. The component supplies the one part that depends on the
 * live session: the records the caller may see, already scoped by `src/lib/access.ts`.
 *
 * Everything here is a pure function of its arguments: no clock, no client, no tenant read. The
 * ranking is a total order (score, then kind, then label, then id), so two runs over the same query
 * give the same list in the same order.
 */
import type { Right } from './rights';
import { hasRight } from './rights';
import type { User } from '../types';
import { EXPLAIN_ENTRIES } from './explain/catalogue';

export type CommandKind = 'screen' | 'action' | 'explain';

/** A record family the palette can jump to. Each opens an existing inspector or tab. */
export type RecordFamily = 'entity' | 'engagement' | 'workpaper' | 'issue' | 'cap' | 'observation';

/** Where a command takes the user. Exactly one of the fields is set. */
export interface CommandTarget {
  /** A primary navigation tab id (`executive`, `pending`, …). */
  tab?: string;
  /** An inspector type to open (`import_wizard`, `standards`, …). */
  inspector?: string;
  /** An explain catalogue id to open. */
  explainId?: string;
  /** A tenant record to open in the existing drilldown (RecordView / FloatingWindowManager). */
  record?: { family: RecordFamily; id: string };
}

/** One jumpable command. `keywords` are extra search terms the label does not carry. */
export interface CommandItem {
  kind: CommandKind;
  id: string;
  label: string;
  hint: string;
  keywords: string[];
  /** When set, the command is hidden from a caller who lacks the right. */
  minRight?: Right;
  target: CommandTarget;
}

/**
 * The seven primary screens (SPEC-v10 §5, "exactly these seven tabs, in this order"). The keywords
 * are the words a user would actually type to reach them, including the rule names the screen
 * implements (so "benford" reaches the analyst engine).
 */
export const SCREEN_COMMANDS: CommandItem[] = [
  {
    kind: 'screen',
    id: 'screen.executive',
    label: 'Dashboard',
    hint: 'Executive assurance cockpit',
    keywords: ['dashboard', 'executive', 'cockpit', 'overview', 'home', 'stats', 'kpi'],
    target: { tab: 'executive' },
  },
  {
    kind: 'screen',
    id: 'screen.pending',
    label: 'Work Queue',
    hint: 'What needs you today',
    keywords: ['work queue', 'todo', 'to do', 'my work', 'tasks', 'front door', 'needs you'],
    target: { tab: 'pending' },
  },
  {
    kind: 'screen',
    id: 'screen.universe',
    label: 'Audit Universe',
    hint: 'Universes and entities in scope',
    keywords: ['universe', 'universes', 'entities', 'entity', 'scope', 'risk rating'],
    target: { tab: 'universe' },
  },
  {
    kind: 'screen',
    id: 'screen.plan',
    label: 'Audit Plan',
    hint: 'Plan items, versions and approvals',
    keywords: ['plan', 'planning', 'schedule', 'prior year', 'suggestions'],
    target: { tab: 'plan' },
  },
  {
    kind: 'screen',
    id: 'screen.sira',
    label: 'SIRA',
    hint: 'Strategic internal risk assessment',
    keywords: ['sira', 'risk assessment', 'risk model', 'cycles', 'emergent risk', 'heatmap'],
    target: { tab: 'sira' },
  },
  {
    kind: 'screen',
    id: 'screen.audit_file',
    label: 'Audit Files',
    hint: 'Engagements and their working papers',
    keywords: [
      'audit files',
      'audit file',
      'engagement',
      'engagements',
      'fieldwork',
      'workpaper',
      'working paper',
      'benford',
      'analytics',
      'analyst engine',
      'forensic',
      'duplicates',
      'outliers',
      'sampling',
      'population',
    ],
    target: { tab: 'audit_file' },
  },
  {
    kind: 'screen',
    id: 'screen.issues',
    label: 'Issues & CAP Register',
    hint: 'Issues, corrective action plans and closure',
    keywords: ['issues', 'cap', 'caps', 'corrective action', 'findings', 'remediation', 'overdue'],
    target: { tab: 'issues' },
  },
];

/**
 * The actions the shell already offers (the profile menu and the standards view). Each opens an
 * existing inspector, so an action in the palette is never a new path — it is a keyboard route to
 * one that already exists. Rights gate them exactly as the menu does.
 */
export const ACTION_COMMANDS: CommandItem[] = [
  {
    kind: 'action',
    id: 'action.standards_view',
    label: 'IIA Standards view',
    hint: 'Catalogue, implementation and evidence',
    keywords: ['iia', 'standards', 'compliance', 'conformance', 'catalogue'],
    target: { inspector: 'standards' },
  },
  {
    kind: 'action',
    id: 'action.import',
    label: 'Import data',
    hint: 'Import a population, plan or mapping',
    keywords: ['import', 'upload', 'csv', 'population', 'wizard'],
    minRight: 'manage_engagements',
    target: { inspector: 'import_wizard' },
  },
  {
    kind: 'action',
    id: 'action.activity_log',
    label: 'Activity log',
    hint: 'The tenant activity history',
    keywords: ['activity', 'activity log', 'audit trail', 'history', 'log'],
    minRight: 'manage_engagements',
    target: { inspector: 'activity_log' },
  },
  {
    kind: 'action',
    id: 'action.people_admin',
    label: 'People & Roles',
    hint: 'Members, invitations and role rights',
    keywords: ['people', 'users', 'members', 'roles', 'rights', 'invite', 'team'],
    minRight: 'manage_users',
    target: { inspector: 'people_admin' },
  },
  {
    kind: 'action',
    id: 'action.shared_with_me',
    label: 'Shared with you',
    hint: 'Records another party shared with you',
    keywords: ['shared', 'sharing', 'joint', 'grants', 'with me'],
    target: { inspector: 'shared_with_me' },
  },
  {
    kind: 'action',
    id: 'action.org_settings',
    label: 'Organisation settings',
    hint: 'Organisation profile and configuration',
    keywords: ['organisation', 'organization', 'settings', 'config', 'org'],
    minRight: 'edit_config',
    target: { inspector: 'org_settings' },
  },
  {
    kind: 'action',
    id: 'action.org_control',
    label: 'Assurance control plane',
    hint: 'Feature flags and platform control',
    keywords: ['control plane', 'features', 'flags', 'org control', 'assurance'],
    minRight: 'edit_config',
    target: { inspector: 'org_control' },
  },
  {
    kind: 'action',
    id: 'action.global_search',
    label: 'Search all documents',
    hint: 'Full-text search every document you may read',
    keywords: ['search documents', 'document search', 'full text', 'find in documents', 'global search'],
    target: { inspector: 'global_search' },
  },
  {
    kind: 'action',
    id: 'action.account_settings',
    label: 'Account settings',
    hint: 'Your profile and preferences',
    keywords: ['account', 'settings', 'profile', 'preferences', 'me'],
    target: { inspector: 'account_settings' },
  },
];

/** The static command index: screens, actions and the explain catalogue. */
export function staticCommands(): CommandItem[] {
  return [...SCREEN_COMMANDS, ...ACTION_COMMANDS, ...explainCommands()];
}

/**
 * The explain layer as commands: one per catalogue entry, so the palette can answer "what is
 * coverage?" as well as "where is coverage?". An entry whose `minRight` the user lacks is dropped,
 * so the palette never advertises detail the caller would only see redacted.
 */
export function explainCommands(): CommandItem[] {
  return EXPLAIN_ENTRIES.map((e) => ({
    kind: 'explain' as const,
    id: `explain.${e.id}`,
    label: e.title,
    hint: e.summary,
    keywords: [e.id, e.kind, ...(e.related ?? [])],
    minRight: e.minRight,
    target: { explainId: e.id },
  }));
}

/** Commands the caller may see: static commands filtered by the rights they hold. */
export function visibleCommands(user: User | null | undefined, items = staticCommands()): CommandItem[] {
  return items.filter((c) => !c.minRight || hasRight(user, c.minRight));
}

/** The kind order used as the first tie-break, so screens outrank actions outrank explain entries. */
const KIND_RANK: Record<CommandKind, number> = { screen: 1, action: 2, explain: 3 };

function scoreOf(item: CommandItem, q: string): number {
  const label = item.label.toLowerCase();
  const hint = item.hint.toLowerCase();
  const keywords = item.keywords.map((k) => k.toLowerCase());

  if (label === q) return 1000;
  if (label.startsWith(q)) return 800;
  // A word inside the label starting with the query ("queue" in "Work Queue").
  if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 700;
  if (label.includes(q)) return 600;

  if (keywords.some((k) => k === q)) return 500;
  if (keywords.some((k) => k.startsWith(q))) return 400;
  if (keywords.some((k) => k.split(/[^a-z0-9]+/).some((w) => w.startsWith(q)))) return 350;
  if (keywords.some((k) => k.includes(q))) return 300;

  if (hint.includes(q)) return 200;
  return 0;
}

/**
 * Rank commands against a query. Empty query returns the list in its natural order (the caller shows
 * a sensible default). Matching is case-insensitive and deterministic: ties break on kind, then
 * label, then id, so the same query always yields the same order.
 */
export function rankCommands(query: string, items: CommandItem[]): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  const scored = items
    .map((item) => ({ item, score: scoreOf(item, q) }))
    .filter((s) => s.score > 0);
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] ||
      a.item.label.localeCompare(b.item.label) ||
      a.item.id.localeCompare(b.item.id)
  );
  return scored.map((s) => s.item);
}

/**
 * Flatten the ranked groups into the single list the keyboard walks, so ArrowDown from the last
 * screen reaches the first action and Enter activates whatever is highlighted.
 */
export function flattenGroups<T>(groups: T[][]): T[] {
  return groups.flat();
}

// ---- records --------------------------------------------------------------------------------

export interface RecordCommandInput {
  id: string;
  family: RecordFamily;
  title: string;
  subtitle?: string;
  keywords?: string[];
}

/**
 * Turn the caller's ALREADY-SCOPED records into commands. The caller passes only rows the host
 * screen already filtered through `src/lib/access.ts`, so the palette can never surface a record the
 * screen behind it hid (Law L2). This module performs no filtering of its own.
 */
export function recordCommands(records: RecordCommandInput[]): CommandItem[] {
  return records.map((r) => ({
    kind: 'action' as const,
    id: `record.${r.family}.${r.id}`,
    label: r.title,
    hint: r.subtitle ?? '',
    keywords: [r.family, ...(r.keywords ?? [])],
    target: { record: { family: r.family, id: r.id } },
  }));
}
