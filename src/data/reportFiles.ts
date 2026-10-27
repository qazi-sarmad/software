/**
 * The issued report's files (C2.7, spec §18 "Report | Frozen PDF, editable DOCX").
 *
 * One block model, two files: the frozen PDF and the editable DOCX are rendered from the same
 * DocumentModel, so they cannot disagree. Each file's bytes are hashed and the hash is recorded by
 * the database (store_report_file), which also writes the hash-chained ledger entry §18 requires.
 *
 * The bytes live in Storage (the platform's file store; the recorded decision is D-C2.7-storage). The
 * browser never holds a service key: the upload uses the signed-in session, and the database re-checks
 * the caller's approve_plan right and the report's frozen status before any row is written.
 */
import { getClient } from './db';
import { renderPdf } from '../lib/render/pdf';
import { renderDocx } from '../lib/render/docx';
import { documentFromReportBlocks, toPdfModel, footerLine, type DocumentModel, type ReportBlockInput } from '../lib/render/document';
import { DEFAULT_BRANDING, type BrandingSpec } from '../lib/render/branding';
import { DEFAULT_FORMAT_LAYOUT, toPdfTypography, type FormatLayout } from '../lib/writing/reportFormat';
import { sha256Hex } from '../lib/population';

export const REPORT_BUCKET = 'reports';

export interface ReportFileInput {
  reportVersionId: string;
  orgId: string;
  title: string;
  subtitle?: string;
  blocks: ReportBlockInput[];
  engagementLabel: string;
  userLabel: string;
  frozenAt?: string | null;
  branding?: BrandingSpec;
  /** The report format's print layout (WP-C3). Its resolved typography decides the PDF's printed
   *  sizes and line height, so the frozen PDF matches the live canvas. Absent means the defaults. */
  layout?: FormatLayout;
}

export interface StoredReportFiles {
  pdf: { path: string; sha256: string; bytes: number };
  docx: { path: string; sha256: string; bytes: number };
}

/** Build the one model the PDF and the DOCX both render. The footer carries engagement, time, user
 *  and hash (spec §18); for the frozen PDF the freeze date is added (spec §15.5). */
export function buildReportModel(input: ReportFileInput, contentHashForFooter: string, frozenLabel: string): DocumentModel {
  return documentFromReportBlocks(input.title, input.blocks, {
    engagement: input.engagementLabel,
    exportedAt: frozenLabel,
    user: input.userLabel,
    contentHash: contentHashForFooter,
  });
}

async function hashOf(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return sha256Hex(buf);
}

/**
 * Render, upload and record both files. Returns the paths and hashes. Throws on the first failure so
 * the caller shows a plain-language error; nothing is recorded until both files are uploaded.
 */
export async function renderAndStoreReportFiles(input: ReportFileInput): Promise<StoredReportFiles> {
  const sb = getClient();
  if (!sb) throw new Error('no database client');

  const spec: BrandingSpec = input.branding ?? { orgId: input.orgId, ...DEFAULT_BRANDING };
  const frozenLabel = input.frozenAt ?? new Date().toISOString();

  // The DOCX is rendered first (its hash is not in either footer); the PDF's footer carries the
  // freeze date and the DOCX's hash so an operator can match the two files from either side.
  const docxModel = buildReportModel(input, '', frozenLabel);
  const docxBytes = await renderDocx(docxModel);
  const docxHash = await hashOf(docxBytes);

  const pdfModel = buildReportModel(input, docxHash, frozenLabel);
  const pdfBytes = await renderPdf(spec, toPdfModel(pdfModel, undefined, toPdfTypography(input.layout ?? DEFAULT_FORMAT_LAYOUT)));
  const pdfHash = await hashOf(pdfBytes);

  const base = `${input.orgId}/reports/${input.reportVersionId}`;
  const pdfPath = `${base}.pdf`;
  const docxPath = `${base}.docx`;

  const up1 = await sb.storage.from(REPORT_BUCKET).upload(pdfPath, pdfBytes, {
    contentType: 'application/pdf', upsert: true,
  });
  if (up1.error) throw new Error(`the PDF could not be stored: ${up1.error.message}`);
  const up2 = await sb.storage.from(REPORT_BUCKET).upload(docxPath, docxBytes, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: true,
  });
  if (up2.error) throw new Error(`the DOCX could not be stored: ${up2.error.message}`);

  const r1 = await sb.rpc('store_report_file', {
    p_report_version_id: input.reportVersionId, p_kind: 'pdf',
    p_storage_path: pdfPath, p_sha256: pdfHash, p_byte_size: pdfBytes.length,
  });
  if (r1.error) throw new Error(r1.error.message);
  const r2 = await sb.rpc('store_report_file', {
    p_report_version_id: input.reportVersionId, p_kind: 'docx',
    p_storage_path: docxPath, p_sha256: docxHash, p_byte_size: docxBytes.length,
  });
  if (r2.error) throw new Error(r2.error.message);

  return {
    pdf: { path: pdfPath, sha256: pdfHash, bytes: pdfBytes.length },
    docx: { path: docxPath, sha256: docxHash, bytes: docxBytes.length },
  };
}

/** The footer line for the on-screen preview, so the screen and the file agree. */
export function reportFooterPreview(input: ReportFileInput, docxHash: string): string {
  return footerLine({ engagement: input.engagementLabel, exportedAt: input.frozenAt ?? '', user: input.userLabel, contentHash: docxHash });
}

export { documentFromReportBlocks, toPdfModel };
