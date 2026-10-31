/**
 * Keyboard shortcuts (U8; docs/SYSTELIGON.md §11.1c Tier 1 item 10).
 *
 * "Every action reachable without a mouse. `?` opens the shortcut sheet." This is the deterministic
 * half: the shortcut catalogue as data, the rights filter, the chord formatter and the pure matcher.
 * The component layer (`ShortcutSheet`, the shell binding) adds only the DOM event and the render.
 *
 * No clock, no client, no tenant read. A shortcut is offered only when the caller holds the right
 * its action needs, so the sheet never advertises a key that would be refused — the same rule the
 * command palette uses (`visibleCommands`).
 */
import type { Right } from './rights';
import { hasAnyAuditRight, hasRight } from './rights';
import type { User } from '../types';

export type ShortcutGroup = 'Navigate' | 'Actions' | 'Help';

/** A platform-agnostic chord. `mod` is Cmd on macOS and Ctrl elsewhere; the shell resolves it. */
export interface ShortcutChord {
  mod?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** The lowercase `KeyboardEvent.key` this chord expects (`k`, `?`, `escape`, …). */
  key: string;
}

export interface Shortcut {
  id: string;
  group: ShortcutGroup;
  label: string;
  hint: string;
  chord: ShortcutChord;
  /** A second key pressed AFTER the chord, for `g`-prefixed navigation (`g` then `d`). */
  sequenceKey?: string;
  /** When set, the shortcut is hidden from a caller who lacks the right. */
  minRight?: Right;
  /** When true, the shortcut needs the same access the nav strip does (any audit right). */
  requiresAuditRight?: boolean;
  /** Where it takes the user — the same target shape the command palette uses. */
  target: { tab?: string; inspector?: string; commandPalette?: boolean; shortcutSheet?: boolean };
}

/**
 * The catalogue. `mod+k` and `?` are global; the `g` sequences are the mouse-free way to reach the
 * seven screens (SPEC-v10 §5), so the nav strip is never the only door.
 */
export const SHORTCUTS: Shortcut[] = [
  {
    id: 'palette.open',
    group: 'Actions',
    label: 'Command palette',
    hint: 'Jump to a screen, a record, an action or an explanation',
    chord: { mod: true, key: 'k' },
    target: { commandPalette: true },
  },
  {
    id: 'help.shortcuts',
    group: 'Help',
    label: 'Keyboard shortcuts',
    hint: 'Open this sheet',
    chord: { key: '?' },
    target: { shortcutSheet: true },
  },
  {
    id: 'go.dashboard',
    group: 'Navigate',
    label: 'Dashboard',
    hint: 'Press g then d',
    chord: { key: 'g' },
    sequenceKey: 'd',
    requiresAuditRight: true,
    target: { tab: 'executive' },
  },
  {
    id: 'go.workqueue',
    group: 'Navigate',
    label: 'Work Queue',
    hint: 'Press g then w',
    chord: { key: 'g' },
    sequenceKey: 'w',
    requiresAuditRight: true,
    target: { tab: 'pending' },
  },
  {
    id: 'go.universe',
    group: 'Navigate',
    label: 'Audit Universe',
    hint: 'Press g then u',
    chord: { key: 'g' },
    sequenceKey: 'u',
    requiresAuditRight: true,
    target: { tab: 'universe' },
  },
  {
    id: 'go.plan',
    group: 'Navigate',
    label: 'Audit Plan',
    hint: 'Press g then p',
    chord: { key: 'g' },
    sequenceKey: 'p',
    requiresAuditRight: true,
    target: { tab: 'plan' },
  },
  {
    id: 'go.sira',
    group: 'Navigate',
    label: 'SIRA',
    hint: 'Press g then s',
    chord: { key: 'g' },
    sequenceKey: 's',
    requiresAuditRight: true,
    target: { tab: 'sira' },
  },
  {
    id: 'go.auditfiles',
    group: 'Navigate',
    label: 'Audit Files',
    hint: 'Press g then a',
    chord: { key: 'g' },
    sequenceKey: 'a',
    requiresAuditRight: true,
    target: { tab: 'audit_file' },
  },
  {
    id: 'go.issues',
    group: 'Navigate',
    label: 'Issues & CAP Register',
    hint: 'Press g then i',
    chord: { key: 'g' },
    sequenceKey: 'i',
    requiresAuditRight: true,
    target: { tab: 'issues' },
  },
  {
    id: 'view.standards',
    group: 'Help',
    label: 'IIA standards',
    hint: 'Open the standards catalogue',
    chord: { mod: true, key: 'i' },
    target: { inspector: 'standards' },
  },
];

/** The shortcuts a caller may use: those with no right requirement, or whose right they hold. */
export function shortcutsFor(user: User | null | undefined): Shortcut[] {
  return SHORTCUTS.filter((s) => {
    if (s.requiresAuditRight && !hasAnyAuditRight(user)) return false;
    if (s.minRight && !hasRight(user, s.minRight)) return false;
    return true;
  });
}

/** Group the shortcuts for the sheet, in a fixed order, dropping empty groups. */
const GROUP_ORDER: ShortcutGroup[] = ['Navigate', 'Actions', 'Help'];
export function groupedShortcuts(user: User | null | undefined): { group: ShortcutGroup; items: Shortcut[] }[] {
  const visible = shortcutsFor(user);
  return GROUP_ORDER.map((group) => ({ group, items: visible.filter((s) => s.group === group) })).filter(
    (g) => g.items.length > 0
  );
}

/** A chord as the keys a user reads, e.g. `⌘K` on macOS and `Ctrl K` elsewhere. */
export function formatChord(chord: ShortcutChord, isMac: boolean): string[] {
  const keys: string[] = [];
  if (chord.mod) keys.push(isMac ? '⌘' : 'Ctrl');
  if (chord.shift) keys.push(isMac ? '⇧' : 'Shift');
  if (chord.alt) keys.push(isMac ? '⌥' : 'Alt');
  keys.push(chord.key === 'escape' ? 'Esc' : chord.key.toUpperCase());
  return keys;
}

/** A shortcut's full key sequence for the sheet, e.g. `G` then `D`. */
export function formatSequence(s: Shortcut, isMac: boolean): string[] {
  const first = formatChord(s.chord, isMac);
  if (!s.sequenceKey) return first;
  return [...first, 'then', s.sequenceKey.toUpperCase()];
}

/** The minimal shape of a keydown the matcher needs. `KeyboardEvent` satisfies it. */
export interface KeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  /** True when the event target is a text field, so a bare-letter shortcut must not fire. */
  inEditable?: boolean;
}

/**
 * The shortcut a keydown matches, or null. `isMac` decides whether `mod` is Cmd or Ctrl. A bare-key
 * chord (no `mod`/`alt`) is suppressed inside a text field, so typing "g" in a search box never
 * navigates; a `mod`-chord still fires there, which is what makes Cmd-K work from anywhere.
 */
export function matchShortcut(e: KeyEventLike, isMac: boolean): Shortcut | null {
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const mod = isMac ? !!e.metaKey : !!e.ctrlKey;
  for (const s of SHORTCUTS) {
    if (s.chord.key !== key) continue;
    const wantsMod = !!s.chord.mod;
    const wantsAlt = !!s.chord.alt;
    const wantsShift = !!s.chord.shift;
    if (wantsMod !== mod) continue;
    if (wantsAlt !== !!e.altKey) continue;
    if (wantsShift !== !!e.shiftKey) continue;
    const isBare = !wantsMod && !wantsAlt;
    if (isBare && e.inEditable) continue;
    return s;
  }
  return null;
}

/** The second key of a `g`-sequence resolves to its shortcut, or null. */
export function matchSequence(leader: Shortcut, nextKey: string): Shortcut | null {
  if (!leader.sequenceKey) return null;
  return SHORTCUTS.find((s) => s.chord.key === leader.chord.key && s.sequenceKey === nextKey.toLowerCase()) ?? null;
}

/** True on an Apple platform, where `mod` is Cmd rather than Ctrl. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform ?? '');
}
