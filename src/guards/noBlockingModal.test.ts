import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * Rule: no blocking modals (spec §27.5, §28). A blocking modal is a full-viewport scrim with an
 * aria-modal dialog or `role="dialog"` overlay that stops the user from reaching the application
 * behind it. This guard fails if any file under src (excluding tests) contains `aria-modal`,
 * `role="dialog"` or `fixed inset-0` outside the allow-list.
 *
 * The allow-list holds only non-blocking surfaces plus the record-view / Audit File window chrome
 * that MODE B (H3b/H3c, §17.1) builds. Each entry is justified here so widening it is a deliberate
 * act, not an accident:
 *
 *   - audit/AuditFileModal.tsx          the Audit File window chrome (§17.1): floating, minimisable,
 *                                       non-blocking; the template for MODE B.
 *   - common/ConfirmPanel.tsx           hold-to-confirm panel: consequential-action confirmation,
 *                                       explicitly named by §27.5 as allowed (may be added later).
 *   - common/CommandPalette.tsx         the global command palette (§5, Ctrl/⌘ K): transient,
 *                                       keyboard-driven, dismissed with Esc or a click.
 *   - calendar/HeaderCalendarPanel.tsx  anchored calendar popover: role="dialog" but no scrim and
 *                                       no focus trap; the page behind it stays usable.
 *
 * InspectorPanel.tsx was a genuine blocking modal; H3c deleted it and grep confirms zero remaining
 * imports. The floating window chrome (common/FloatingWindow.tsx) and the record-view wrapper
 * (common/RecordView.tsx) are the non-blocking MODE B surfaces (§17.1) and are allowed.
 */
const ALLOWED = new Set([
  'components/audit/AuditFileModal.tsx',
  'components/common/ConfirmPanel.tsx',
  'components/common/CommandPalette.tsx',
  'components/calendar/HeaderCalendarPanel.tsx',
  'components/common/FloatingWindow.tsx',
  'components/common/RecordView.tsx',
  'components/common/FloatingWindowManager.tsx',
]);

// Empty after H3c: the blocking InspectorPanel is gone. Kept as a guard so a regression that
// reintroduces a temporary overlay file must be recorded here explicitly.
const TEMPORARY = new Set<string>([]);

const BANNED = [/aria-modal/, /role\s*=\s*["']dialog["']/, /fixed inset-0/];

describe('no blocking modals (spec §27.5)', () => {
  const files = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f));

  it('finds files to scan', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it('renders no blocking modal outside the allow-list', () => {
    const offenders = files
      .filter((f) => {
        const rel = relative(SRC, f).replace(/\\/g, '/');
        return !ALLOWED.has(rel) && !TEMPORARY.has(rel);
      })
      .filter((f) => {
        const body = readFileSync(f, 'utf-8');
        return BANNED.some((re) => re.test(body));
      })
      .map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('has an empty temporary allow-list (H3c removed the blocking InspectorPanel)', () => {
    expect([...TEMPORARY]).toEqual([]);
  });
});
