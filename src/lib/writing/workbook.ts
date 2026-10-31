/**
 * W2.9: the phrase review workbook.
 *
 * One row per phrase variant: model, section, formality, tone, voice, locale, the rendered sample
 * with fixture data, and the review status. A human reviewer reads the whole matrix and releases
 * each phrase from its row. A phrase cannot be released until its row is reviewed: the release RPC
 * refuses a phrase whose workbook row is not marked reviewed.
 *
 * The workbook is CSV, so a reviewer can open it in any spreadsheet. It is deterministic: the same
 * phrases and fixtures always produce the same rows in the same order.
 */

import { composeReport, type ComposerInput, type PhraseVariants } from './compose';
import { DEFAULT_LEAD_INS, DEFAULT_HIGH_CONSEQUENCE_WORDS } from './phrases';
import { modelById, REPORT_MODELS } from './models';
import { registerKey } from './registers';
import type { Claim, EngineVersion, Formality, Locale, Phrase, Tone } from './types';

export interface WorkbookRow {
  phraseId: string;
  phraseVersion: number;
  modelId: string;
  sectionId: string;
  formality: number;
  tone: number;
  voice: 'active' | 'passive';
  locale: Locale;
  status: 'draft' | 'reviewed' | 'released';
  /** The review status of this cell, which the release RPC requires before a release. */
  reviewStatus: 'unreviewed' | 'reviewed' | 'rejected';
  sample: string;
}

const FORMALITIES: Formality[] = [1, 2, 3, 4, 5];
const TONES: Tone[] = [1, 2, 3, 4, 5];
const VOICES: Array<'active' | 'passive'> = ['active', 'passive'];
const LOCALES: Locale[] = ['en-GB', 'en-US'];

/** The review status of a cell, keyed by phrase id and cell key. */
export type CellReviewStatus = Record<string, Record<string, WorkbookRow['reviewStatus']>>;

export function cellKey(formality: number, tone: number, voice: string, locale: Locale): string {
  return `f${formality}-t${tone}-${voice}-${locale}`;
}

/** Which models a phrase appears in. An empty model scope means every model. */
function modelsFor(phrase: Phrase): string[] {
  if (phrase.modelScope.length === 0) return REPORT_MODELS.map((m) => m.modelId);
  return phrase.modelScope.filter((id) => modelById(id) !== undefined);
}

export interface WorkbookInput {
  phrases: Phrase[];
  versions: EngineVersion;
  fixedTimestamp: string;
  format: ComposerInput['format'];
  /** The fixture claims used to render a sample for each cell. */
  claims: Claim[];
  variants?: Record<string, PhraseVariants>;
  /** The stored per-cell review status; absent means unreviewed. */
  reviews?: CellReviewStatus;
}

/**
 * Build the workbook rows. For each phrase, each model it appears in, each of the 100 cells, one
 * row. The sample depends only on the cell (formality, tone, voice, locale), not on the model, so
 * it is rendered once per cell and reused, which keeps the workbook fast. A cell whose sample
 * cannot be rendered still produces a row, with the gap named in the sample, so a reviewer sees the
 * hole rather than a silent omission.
 */
export async function buildWorkbook(input: WorkbookInput): Promise<WorkbookRow[]> {
  const rows: WorkbookRow[] = [];
  const ordered = [...input.phrases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.locale < b.locale ? -1 : 1));
  for (const phrase of ordered) {
    const claim = input.claims.find((c) => c.phraseId === phrase.id && c.kind !== 'auditor');
    if (!claim) continue;
    const models = modelsFor(phrase);
    const sectionId = claim.sectionId;
    // The phrase's variants in every locale, so a cell at either locale finds its own pack.
    const sameId = input.phrases.filter((p) => p.id === phrase.id);
    for (const formality of FORMALITIES) {
      for (const tone of TONES) {
        for (const voice of VOICES) {
          for (const locale of LOCALES) {
            const key = cellKey(formality, tone, voice, locale);
            const review = input.reviews?.[phrase.id]?.[key] ?? 'unreviewed';
            let sample: string;
            try {
              const composed = await composeReport({
                graph: {
                  modelId: models[0],
                  register: { formality, tone, voice },
                  locale,
                  claims: [{ ...claim, modelId: models[0], phraseVersion: phrase.version }],
                  versions: input.versions,
                },
                phrases: sameId,
                vocabulary: { leadIns: DEFAULT_LEAD_INS, highConsequence: DEFAULT_HIGH_CONSEQUENCE_WORDS },
                versions: input.versions,
                fixedTimestamp: input.fixedTimestamp,
                format: input.format,
                variants: input.variants,
              });
              sample = composed.rendered[0]?.text ?? '';
            } catch (e) {
              sample = `Missing: ${(e as Error).message}`;
            }
            for (const modelId of models) {
              rows.push({
                phraseId: phrase.id,
                phraseVersion: phrase.version,
                modelId,
                sectionId,
                formality,
                tone,
                voice,
                locale,
                status: phrase.status,
                reviewStatus: review,
                sample,
              });
            }
          }
        }
      }
    }
  }
  return rows;
}

function csvField(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The workbook as CSV, one row per phrase variant. */
export function workbookCsv(rows: WorkbookRow[]): string {
  const headers = ['phrase_id', 'phrase_version', 'model_id', 'section_id', 'formality', 'tone',
    'voice', 'locale', 'status', 'review_status', 'sample'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      r.phraseId, String(r.phraseVersion), r.modelId, r.sectionId, String(r.formality), String(r.tone),
      r.voice, r.locale, r.status, r.reviewStatus, r.sample,
    ].map(csvField).join(','));
  }
  return lines.join('\n');
}

/**
 * The release guard: a phrase may be released only when every cell of every model it appears in has
 * been reviewed. Returns the unreviewed cells, so the caller can list them precisely.
 */
export function unreviewedCells(rows: WorkbookRow[]): WorkbookRow[] {
  return rows.filter((r) => r.reviewStatus !== 'reviewed');
}

/** True when a phrase's every row is reviewed and none is rejected. */
export function canReleasePhrase(rows: WorkbookRow[]): boolean {
  const mine = rows;
  return mine.length > 0 && mine.every((r) => r.reviewStatus === 'reviewed');
}
