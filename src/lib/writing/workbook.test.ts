import { describe, expect, it } from 'vitest';
import { buildWorkbook, canReleasePhrase, cellKey, unreviewedCells, workbookCsv, type CellReviewStatus } from './workbook';
import {
  ENGINE_VERSION, FIXED_TIMESTAMP, FIXTURE_FORMAT, fixtureClaims, fixtureVariants, releasedSeedPhrases,
} from './fixtures';

async function workbook() {
  return buildWorkbook({
    phrases: releasedSeedPhrases(),
    versions: ENGINE_VERSION,
    fixedTimestamp: FIXED_TIMESTAMP,
    format: FIXTURE_FORMAT,
    claims: fixtureClaims(),
    variants: fixtureVariants(),
  });
}

describe('W2.9 the phrase review workbook', () => {
  it('produces one row per phrase variant with a rendered sample', async () => {
    const rows = await workbook();
    expect(rows.length).toBeGreaterThan(0);
    // Every row carries a cell and a sample; no sample is an unhandled gap.
    for (const row of rows) {
      expect(row.sample.length).toBeGreaterThan(0);
      expect(row.sample.startsWith('Missing:')).toBe(false);
    }
  });

  it('is deterministic: the same input gives the same rows in the same order', async () => {
    const a = await workbook();
    const b = await workbook();
    expect(workbookCsv(a)).toBe(workbookCsv(b));
  });

  it('writes a CSV with a header and one line per row', async () => {
    const rows = await workbook();
    const csv = workbookCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('phrase_id');
    expect(lines[0]).toContain('review_status');
    expect(lines.length).toBe(rows.length + 1);
  });

  it('marks every cell unreviewed until a reviewer reviews it', async () => {
    const rows = await workbook();
    expect(unreviewedCells(rows).length).toBe(rows.length);
    expect(canReleasePhrase(rows)).toBe(false);
  });

  it('refuses a release until every cell of a phrase is reviewed', async () => {
    const rows = await workbook();
    const phraseId = rows[0].phraseId;
    const mine = rows.filter((r) => r.phraseId === phraseId);
    const reviews: CellReviewStatus = {
      [phraseId]: Object.fromEntries(mine.map((r) => [
        cellKey(r.formality, r.tone, r.voice, r.locale), 'reviewed' as const,
      ])),
    };
    const reviewed = await buildWorkbook({
      phrases: releasedSeedPhrases(),
      versions: ENGINE_VERSION,
      fixedTimestamp: FIXED_TIMESTAMP,
      format: FIXTURE_FORMAT,
      claims: fixtureClaims(),
      variants: fixtureVariants(),
      reviews,
    });
    const reviewedMine = reviewed.filter((r) => r.phraseId === phraseId);
    expect(canReleasePhrase(reviewedMine)).toBe(true);
    // A different phrase is still unreviewed, so its release is still refused.
    const other = reviewed.find((r) => r.phraseId !== phraseId);
    if (other) {
      expect(canReleasePhrase(reviewed.filter((r) => r.phraseId === other.phraseId))).toBe(false);
    }
  });
});
