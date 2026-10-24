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
 * Rule: no blocking modals (spec §27.5, §28). A blocking modal is a full-viewport scrim with a
 * modal dialog overlay that stops the user from reaching the application behind it. This guard
 * fails if any file under src (excluding tests) contains `aria-modal`, `role="dialog"` or
 * `fixed inset-0` outside the allow-list.
 *
 * The allow-list holds only non-blocking surfaces. Each entry is justified here so widening it is
 * a deliberate act, not an accident:
 *
 *   - common/FloatingWindow.tsx          MODE B floating record window (§17.1): floating,
 *                                        minimisable, draggable, pop-out; no scrim, non-blocking.
 *   - common/FloatingWindowManager.tsx   the manager for those windows; the Audit File window uses
 *                                        it (5C).
 *   - common/RecordView.tsx              the record-view wrapper that chooses full page vs floating
 *                                        window from the user preference (H3).
 *   - common/ConfirmPanel.tsx            hold-to-confirm panel: explicitly allowed by §27.5
 *                                        (may not exist yet).
 *
 * InspectorPanel.tsx was a genuine blocking modal; H3c deleted it and grep confirms zero remaining
 * imports. CommandPalette.tsx and HeaderCalendarPanel.tsx were non-blocking but used a full-screen
 * wrapper / a modal role; R4 made both plain non-blocking dropdowns, so neither is allow-listed.
 */
const ALLOWED = new Set([
  'components/common/FloatingWindow.tsx',
  'components/common/FloatingWindowManager.tsx',
  'components/common/RecordView.tsx',
  'components/common/ConfirmPanel.tsx',
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
