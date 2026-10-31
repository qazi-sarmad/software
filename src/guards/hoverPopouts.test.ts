import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Hover-popout guard (integrator).
 *
 * Owner instruction 2026-10-30: *"i want hover popouts so don't remove them or else designer will
 * have to put them"*. The hover popouts are a settled part of the interface — the designer's spec
 * (docs/ACP-UI-CONTRACT.md §CH-06/§CH-07) documents them, the explain layer and the review-comment
 * trail depend on them, and a redesign would have to reintroduce them from scratch if they were
 * dropped. This guard is the integrator's proof that they stay: each popout component is present,
 * each is mounted by a live (non-test) importer, and each keeps its non-blocking chrome — a popover
 * is a portal or an in-place panel, never a blocking modal.
 *
 * It pins the surfaces the owner named, and nothing else. It does not assert how they look.
 */

const ROOT = resolve(process.cwd());

interface Popout {
  /** The component file that carries the popout. */
  file: string;
  /** The exported symbol the importers mount. */
  symbol: string;
  /** At least one live (non-test) file that imports the symbol — proof it is reachable. */
  mountedBy: string[];
  /** The non-blocking evidence: the chrome that keeps it from being a modal. */
  chrome: RegExp;
}

const POPOUTS: Popout[] = [
  {
    file: 'src/components/common/HoverPreview.tsx',
    symbol: 'HoverPreview',
    mountedBy: ['src/components/dashboard/CapTable.tsx', 'src/components/calendar/AuditCalendarTab.tsx'],
    // Rendered into a portal with pointer-events: none — it cannot block the panel behind it.
    chrome: /createPortal[\s\S]*pointerEvents:\s*'none'/,
  },
  {
    file: 'src/components/reviews/CommentPopout.tsx',
    symbol: 'CommentPopout',
    mountedBy: ['src/components/reviews/CommentHistoryPanel.tsx'],
    chrome: /HoverPreview/,
  },
  {
    file: 'src/components/explain/ExplainPopout.tsx',
    symbol: 'ExplainPopout',
    mountedBy: ['src/components/audit/AuditFileModal.tsx', 'src/components/audit/SamplingPanel.tsx'],
    chrome: /role="complementary"|HoverPreview/,
  },
  {
    file: 'src/components/calendar/HeaderCalendarPanel.tsx',
    symbol: 'HeaderCalendarPanel',
    mountedBy: ['src/components/common/HeaderBar.tsx'],
    chrome: /role="region"/,
  },
  {
    file: 'src/components/common/NotificationBell.tsx',
    symbol: 'NotificationBell',
    mountedBy: ['src/components/common/HeaderBar.tsx'],
    chrome: /role="complementary"/,
  },
];

const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf-8');

describe('the hover popouts are present, mounted and non-blocking', () => {
  it('finds every named popout component on disk', () => {
    for (const p of POPOUTS) {
      expect(existsSync(resolve(ROOT, p.file)), `${p.file} is missing`).toBe(true);
    }
  });

  it('exports the symbol each importer mounts', () => {
    for (const p of POPOUTS) {
      const src = read(p.file);
      expect(src, `${p.file} must export ${p.symbol}`).toMatch(
        new RegExp(`export (const|function|default).*${p.symbol}`),
      );
    }
  });

  it('is mounted by a live importer — never left orphaned', () => {
    for (const p of POPOUTS) {
      for (const importer of p.mountedBy) {
        expect(existsSync(resolve(ROOT, importer)), `${importer} is missing`).toBe(true);
        expect(read(importer), `${importer} must import ${p.symbol}`).toMatch(
          new RegExp(`from '[^']*${p.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
        );
      }
    }
  });

  it('keeps non-blocking chrome — a popover is never a modal', () => {
    for (const p of POPOUTS) {
      expect(read(p.file), `${p.file} lost its non-blocking chrome`).toMatch(p.chrome);
    }
  });

  it('is never rendered inside a blocking dialog', () => {
    for (const p of POPOUTS) {
      const src = read(p.file);
      expect(/aria-modal="true"/.test(src), `${p.file} must not be a modal`).toBe(false);
      expect(/(^|[^.\w])(alert|confirm|prompt)\s*\(/m.test(src), `${p.file} must not use a native dialog`).toBe(false);
    }
  });
});
