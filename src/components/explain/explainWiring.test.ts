import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * E4 wiring guard (docs/EXPLAIN-LAYER.md §5.4).
 *
 * The explain layer only earns its keep if it is on the surfaces where the work happens. A passing
 * unit test on `ExplainPopout` proves the component renders; it does NOT prove a screen mounts it.
 * This guard reads the real screen sources and asserts each carries its explain affordance, naming
 * the exact catalogue id, so deleting the wiring fails here rather than silently in production.
 */
const SRC = resolve(process.cwd(), 'src');

const read = (rel: string) => readFileSync(join(SRC, rel), 'utf-8');

/** Each screen and the catalogue ids it must expose. */
const EXPECTED: Array<{ file: string; ids: string[] }> = [
  {
    file: 'components/audit/SamplingPanel.tsx',
    ids: ['method.', 'term.coverage', 'term.exception'],
  },
  {
    file: 'components/audit/CapRegisterPanel.tsx',
    ids: ['status.cap.overdue', 'status.cap.closed', 'status.cap.open'],
  },
  {
    file: 'components/audit/AuditFileModal.tsx',
    ids: ['field.engagement.stage'],
  },
  {
    file: 'components/audit/EvidenceTab.tsx',
    ids: ['field.evidence.content_sha256'],
  },
];

describe('explain wiring (E4)', () => {
  it.each(EXPECTED)('$file carries its explain affordances', ({ file, ids }) => {
    const body = read(file);
    expect(body, `${file} must import ExplainPopout`).toMatch(/from ['"].*ExplainPopout['"]/);
    for (const id of ids) {
      expect(body, `${file} must reference explain id ${id}`).toContain(id);
    }
  });

  it('every wired explain id resolves to a catalogue entry', async () => {
    const { EXPLAIN_ENTRIES } = await import('../../lib/explain/catalogue');
    const known = new Set(EXPLAIN_ENTRIES.map((e) => e.id));
    for (const { file } of EXPECTED) {
      const body = read(file);
      for (const m of body.matchAll(/explainId=[{"']+([a-zA-Z0-9_.$-]+)/g)) {
        const id = m[1].replace(/\.$/, '');
        if (id.endsWith('.')) continue; // template prefix, e.g. `method.${...}`
        expect(known.has(id), `${file} references unknown explain id ${id}`).toBe(true);
      }
    }
  });
});
